import fs from 'node:fs/promises'
import path from 'node:path'
import { query } from '@anthropic-ai/claude-agent-sdk'
import { MAX_TURNS, MODEL, SKILL_PATH } from './config.js'
import { loadFindings } from './findings.js'
import { emit, setStatus, type Job } from './jobs.js'
import { logError, log } from './log.js'
import { makeCanUseTool, type Phase } from './policy.js'

// Minimal view of the SDK message stream; only the fields used here.
interface SdkMessage {
  type: string
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  message?: { content?: Array<{ type: string, text?: string, name?: string, input?: Record<string, unknown> }> }
}

async function loadSkill (): Promise<string> {
  const raw = await fs.readFile(SKILL_PATH, 'utf8')
  return raw.replace(/^---[\s\S]*?---\s*/, '') // drop the YAML front matter
}

async function* userInput (text: string) {
  // canUseTool requires streaming input mode, so the prompt is passed as an async iterable.
  yield { type: 'user' as const, message: { role: 'user' as const, content: text }, parent_tool_use_id: null, session_id: '' }
}

function describeTool (name: string, input: Record<string, unknown> = {}): string {
  const s = (v: unknown): string => (typeof v === 'string' ? v : '')
  const detail = name === 'Bash' ? `$ ${s(input.command)}`
    : name === 'Grep' ? `${name} ${s(input.pattern)}`
      : name === 'Glob' ? `${name} ${s(input.pattern)}`
        : `${name} ${s(input.file_path) || s(input.path)}`
  return detail.length > 300 ? `${detail.slice(0, 300)}…` : detail
}

async function runAgent (job: Job, phase: Phase, prompt: string): Promise<string> {
  const abort = new AbortController()
  job.abort = abort
  const skill = await loadSkill()

  const stream = query({
    prompt: userInput(prompt),
    options: {
      cwd: job.repoPath,
      abortController: abort,
      systemPrompt: { type: 'preset', preset: 'claude_code', append: `\n\n# Skill: dead-code-cleanup\n\n${skill}` },
      settingSources: [], // ignore user/project settings and hooks; this app defines the rules
      permissionMode: 'default',
      allowedTools: [], // nothing is pre-approved; every call is decided by canUseTool
      disallowedTools: ['AskUserQuestion', 'WebFetch', 'WebSearch', 'Task', 'NotebookEdit', 'Skill'],
      canUseTool: makeCanUseTool({ phase, repo: job.repoPath, outDir: job.outDir }),
      maxTurns: MAX_TURNS,
      resume: job.sessionId,
      model: MODEL
    } as never
  })

  let finalText = ''
  for await (const raw of stream) {
    const msg = raw as unknown as SdkMessage
    if (msg.session_id) job.sessionId = msg.session_id

    if (msg.type === 'assistant') {
      for (const block of msg.message?.content ?? []) {
        if (block.type === 'text' && block.text?.trim()) emit(job, { type: 'log', kind: 'text', text: block.text })
        if (block.type === 'tool_use' && block.name) emit(job, { type: 'log', kind: 'tool', text: describeTool(block.name, block.input) })
      }
    } else if (msg.type === 'result') {
      if (msg.subtype !== 'success' || msg.is_error) throw new Error(`The agent stopped early (${msg.subtype ?? 'error'}).`)
      finalText = msg.result ?? ''
    }
  }
  return finalText
}

export async function startAnalysis (job: Job): Promise<void> {
  try {
    emit(job, { type: 'log', kind: 'info', text: 'Analysing repository (phases 1-2)…' })
    const prompt = [
      '[APP MODE: ANALYZE]',
      `OUTPUT_DIR: ${job.outDir.replace(/\\/g, '/')}`,
      'Run the prerequisites and Phases 1-2 of the dead-code-cleanup skill on the repository in your working directory.',
      'Write dead-code-assessment.md and findings.json into OUTPUT_DIR, then stop.'
    ].join('\n')
    await runAgent(job, 'analyze', prompt)

    const { findings, warnings } = await loadFindings(job.repoPath, path.join(job.outDir, 'findings.json'))
    job.findings = findings
    job.warnings = warnings
    emit(job, { type: 'findings', findings, warnings })
    setStatus(job, 'awaiting_approval', findings.length ? undefined : 'No removable dead code was found.')
  } catch (err) {
    fail(job, err)
  }
}

export async function startShip (job: Job, ids: string[]): Promise<void> {
  try {
    job.approvedIds = ids
    await fs.writeFile(path.join(job.outDir, 'approved.json'), JSON.stringify(ids))
    emit(job, { type: 'log', kind: 'info', text: `Applying ${ids.length} approved item(s) (phase 4)…` })
    const prompt = [
      '[APP MODE: SHIP]',
      `OUTPUT_DIR: ${job.outDir.replace(/\\/g, '/')}`,
      `APPROVED_IDS: ${ids.join(', ')}`,
      'The user approved exactly these IDs in the web app. Run Phase 4 for them only, following "App mode" in the skill.'
    ].join('\n')
    const finalText = await runAgent(job, 'ship', prompt)

    const result = await readResult(job, finalText)
    if (result.error) throw new Error(result.error)
    if (!result.prUrl) throw new Error('The agent finished without reporting a pull request URL.')
    job.prUrl = result.prUrl
    emit(job, { type: 'pr', url: result.prUrl, branch: result.branch, draft: result.draft, removedIds: result.removedIds, skippedIds: result.skippedIds, verification: result.verification })
    setStatus(job, 'done')
  } catch (err) {
    fail(job, err)
  }
}

const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/

interface ShipResult { prUrl?: string, branch?: string, draft?: boolean, removedIds?: string[], skippedIds?: string[], verification?: string, error?: string }

async function readResult (job: Job, finalText: string): Promise<ShipResult> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(job.outDir, 'result.json'), 'utf8')) as ShipResult
    if (raw.error) return { error: String(raw.error) }
    if (raw.prUrl && PR_URL.test(raw.prUrl)) {
      const strings = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined)
      return {
        prUrl: raw.prUrl,
        branch: typeof raw.branch === 'string' ? raw.branch : undefined,
        draft: typeof raw.draft === 'boolean' ? raw.draft : undefined,
        removedIds: strings(raw.removedIds),
        skippedIds: strings(raw.skippedIds),
        verification: typeof raw.verification === 'string' ? raw.verification : undefined
      }
    }
  } catch { /* fall back to the agent's final message */ }
  const match = finalText.match(/https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+/)
  return match ? { prUrl: match[0] } : {}
}

function fail (job: Job, err: unknown): void {
  if (job.abort?.signal.aborted) {
    setStatus(job, 'cancelled')
    return
  }
  logError(`job ${job.id} failed`, err)
  emit(job, { type: 'error', message: err instanceof Error ? err.message : 'Unknown error' })
  setStatus(job, 'error')
}

export function cancel (job: Job): void {
  log(`job ${job.id} cancelled`)
  job.abort?.abort()
}
