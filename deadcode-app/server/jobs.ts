import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import path from 'node:path'
import { WORK_ROOT } from './config.js'
import { redact } from './redact.js'
import type { AppEvent, Finding, JobStatus } from './types.js'

const MAX_STORED_LOGS = 3000

interface StoredEvent { id: number, event: AppEvent }

export interface Job {
  id: string
  repoPath: string
  outDir: string
  status: JobStatus
  sessionId?: string
  findings: Finding[]
  warnings: string[]
  approvedIds: string[]
  prUrl?: string
  abort?: AbortController
  events: StoredEvent[]
  clients: Set<ServerResponse>
  nextEventId: number
  storedLogs: number
}

const jobs = new Map<string, Job>()

export const isJobId = (s: string): boolean => /^[0-9a-f-]{36}$/.test(s)
export const getJob = (id: string): Job | undefined => jobs.get(id)

export function activeJobFor (repo: string): Job | undefined {
  return [...jobs.values()].find((j) => j.repoPath === repo && (j.status === 'analyzing' || j.status === 'shipping'))
}

export async function createJob (repoPath: string): Promise<Job> {
  const id = randomUUID()
  const outDir = path.join(WORK_ROOT, id)
  await fs.mkdir(outDir, { recursive: true })
  const job: Job = {
    id, repoPath, outDir, status: 'analyzing', findings: [], warnings: [], approvedIds: [],
    events: [], clients: new Set(), nextEventId: 1, storedLogs: 0
  }
  jobs.set(id, job)
  return job
}

function sanitize (event: AppEvent): AppEvent {
  switch (event.type) {
    case 'log': return { ...event, text: redact(event.text) }
    case 'error': return { ...event, message: redact(event.message) }
    case 'status': return event.message ? { ...event, message: redact(event.message) } : event
    case 'findings': return { ...event, warnings: event.warnings.map(redact) }
    default: return event
  }
}

export function emit (job: Job, raw: AppEvent): void {
  const event = sanitize(raw)
  const stored: StoredEvent = { id: job.nextEventId++, event }
  if (event.type !== 'log' || job.storedLogs < MAX_STORED_LOGS) {
    if (event.type === 'log') job.storedLogs++
    job.events.push(stored)
  }
  for (const res of job.clients) send(res, stored)
}

function send (res: ServerResponse, e: StoredEvent): void {
  res.write(`id: ${e.id}\ndata: ${JSON.stringify(e.event)}\n\n`)
}

export function setStatus (job: Job, status: JobStatus, message?: string): void {
  job.status = status
  emit(job, { type: 'status', status, message })
}

export function attachClient (job: Job, res: ServerResponse, lastEventId: number): void {
  for (const e of job.events) if (e.id > lastEventId) send(res, e)
  job.clients.add(res)
  const beat = setInterval(() => res.write(': keep-alive\n\n'), 15_000)
  res.on('close', () => { clearInterval(beat); job.clients.delete(res) })
}
