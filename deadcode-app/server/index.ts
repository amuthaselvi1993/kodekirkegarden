import fs from 'node:fs'
import path from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { cancel, startAnalysis, startShip } from './agent.js'
import { HOST, PORT, WEB_DEV_PORT, WEB_DIST } from './config.js'
import { readRepoFile } from './findings.js'
import { activeJobFor, attachClient, createJob, getJob, isJobId, setStatus, type Job } from './jobs.js'
import { log, logError } from './log.js'
import { redact } from './redact.js'
import { canShip, preflight, resolveRepo } from './repo.js'
import { HttpError } from './types.js'

const app = express()
app.disable('x-powered-by')

// Only loopback hosts/origins may talk to the API. This blocks DNS-rebinding and cross-site requests.
const allowedHosts = new Set([PORT, WEB_DEV_PORT].flatMap((p) => [`127.0.0.1:${p}`, `localhost:${p}`]))
const allowedOrigins = new Set([...allowedHosts].map((h) => `http://${h}`))

app.use((req, res, next) => {
  if (!allowedHosts.has(req.headers.host ?? '')) return void res.status(403).json({ error: 'Forbidden host' })
  const origin = req.headers.origin
  if (origin && !allowedOrigins.has(origin)) return void res.status(403).json({ error: 'Forbidden origin' })
  if (req.method !== 'GET' && req.method !== 'HEAD' && !origin) return void res.status(403).json({ error: 'Origin header required' })
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Referrer-Policy', 'no-referrer')
  res.setHeader('Cache-Control', 'no-store')
  next()
})
app.use(express.json({ limit: '50kb' })) // only parses application/json, which a cross-site form cannot send

const wrap = (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction): void => {
    Promise.resolve(fn(req, res)).catch(next)
  }

function jobFrom (req: Request): Job {
  const id = String(req.params.id)
  const job = isJobId(id) ? getJob(id) : undefined
  if (!job) throw new HttpError(404, 'Unknown job')
  return job
}

const summary = (job: Job) => ({
  id: job.id, repoPath: job.repoPath, status: job.status, findings: job.findings,
  warnings: job.warnings, prUrl: job.prUrl
})

app.get('/api/health', (_req, res) => { res.json({ ok: true }) })

app.post('/api/jobs', wrap(async (req, res) => {
  const repo = await resolveRepo((req.body as { repoPath?: unknown })?.repoPath)
  if (activeJobFor(repo)) throw new HttpError(409, 'A job is already running for this repository')
  const pre = await preflight(repo)
  if (!pre.clean) throw new HttpError(409, 'Working tree is not clean. Commit or stash your changes first.')

  const job = await createJob(repo)
  log(`job ${job.id} created`)
  void startAnalysis(job)
  res.status(201).json({ id: job.id, warnings: pre.warnings })
}))

app.get('/api/jobs/:id', wrap((req, res) => { res.json(summary(jobFrom(req))) }))

app.get('/api/jobs/:id/events', wrap((req, res) => {
  const job = jobFrom(req)
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' })
  res.write('retry: 3000\n\n')
  attachClient(job, res, Number(req.headers['last-event-id']) || 0)
}))

app.get('/api/jobs/:id/file', wrap(async (req, res) => {
  const job = jobFrom(req)
  const rel = typeof req.query.path === 'string' ? req.query.path : ''
  // Only files that appear in the findings can be fetched.
  if (!job.findings.some((f) => f.file === rel)) throw new HttpError(404, 'Unknown file')
  try {
    res.type('text/plain').send(await readRepoFile(job.repoPath, rel))
  } catch (err) {
    throw new HttpError(422, (err as Error).message)
  }
}))

const ApproveBody = z.object({ ids: z.array(z.string()).min(1).max(500) })

app.post('/api/jobs/:id/approve', wrap(async (req, res) => {
  const job = jobFrom(req)
  const parsed = ApproveBody.safeParse(req.body)
  if (!parsed.success) throw new HttpError(400, 'ids must be a non-empty array of finding IDs')
  if (job.status !== 'awaiting_approval') throw new HttpError(409, `Job is ${job.status}, not awaiting approval`)

  const ids = [...new Set(parsed.data.ids)]
  const known = new Set(job.findings.map((f) => f.id))
  const unknown = ids.filter((id) => !known.has(id))
  if (unknown.length) throw new HttpError(400, `Unknown finding IDs: ${unknown.join(', ')}`)

  const block = canShip(await preflight(job.repoPath))
  if (block) throw new HttpError(409, `Cannot push yet: ${block}`)

  setStatus(job, 'shipping')
  log(`job ${job.id} approved ${ids.length} item(s)`)
  void startShip(job, ids)
  res.status(202).json({ ok: true })
}))

app.delete('/api/jobs/:id', wrap((req, res) => {
  const job = jobFrom(req)
  cancel(job)
  res.status(202).json({ ok: true })
}))

if (fs.existsSync(WEB_DIST)) {
  app.use((_req, res, next) => {
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'")
    next()
  })
  app.use(express.static(WEB_DIST))
  app.get('*', (_req, res) => { res.sendFile(path.join(WEB_DIST, 'index.html')) })
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof HttpError) return void res.status(err.status).json({ error: redact(err.message) })
  logError('request failed', err)
  res.status(500).json({ error: 'Internal error' })
})

// Bound to loopback only.
app.listen(PORT, HOST, () => {
  log(`deadcode-app listening on http://${HOST}:${PORT}`)
})
