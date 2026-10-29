import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'
import { HttpError } from './types.js'

const run = promisify(execFile)

async function git (repo: string, args: string[]): Promise<string> {
  const { stdout } = await run('git', ['-C', repo, ...args], { timeout: 20_000, windowsHide: true })
  return stdout.trim()
}

const sameDir = (a: string, b: string): boolean =>
  process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

/** Validates the user-supplied path and returns the canonical repository root. */
export async function resolveRepo (input: unknown): Promise<string> {
  if (typeof input !== 'string' || !input.trim() || input.includes('\0')) throw new HttpError(400, 'repoPath is required')
  if (!path.isAbsolute(input)) throw new HttpError(400, 'repoPath must be an absolute path')

  let real: string
  try {
    real = await fs.realpath(input)
    if (!(await fs.stat(real)).isDirectory()) throw new Error('not a directory')
  } catch {
    throw new HttpError(404, 'repoPath does not exist or is not a directory')
  }

  let top: string
  try {
    top = await fs.realpath(await git(real, ['rev-parse', '--show-toplevel']))
  } catch {
    throw new HttpError(400, 'repoPath is not a git repository')
  }
  if (!sameDir(path.resolve(top), path.resolve(real))) {
    throw new HttpError(400, `repoPath must be the repository root (${top})`)
  }
  return real
}

export interface Preflight {
  clean: boolean
  originOnGithub: boolean
  ghInstalled: boolean
  ghAuthenticated: boolean
  branch: string
  warnings: string[]
}

async function ghAuthenticated (): Promise<{ installed: boolean, authed: boolean }> {
  try {
    // Only the exit code is used; the output is never read or logged.
    await run('gh', ['auth', 'status'], { timeout: 20_000, windowsHide: true })
    return { installed: true, authed: true }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code
    return { installed: code !== 'ENOENT', authed: false }
  }
}

export async function preflight (repo: string): Promise<Preflight> {
  const warnings: string[] = []
  const clean = (await git(repo, ['status', '--porcelain'])) === ''
  if (!clean) warnings.push('Working tree is not clean. Commit or stash your changes first.')

  let originOnGithub = false
  try {
    originOnGithub = (await git(repo, ['remote', 'get-url', 'origin'])).includes('github.com')
  } catch { /* no origin remote */ }
  if (!originOnGithub) warnings.push('Remote "origin" is missing or does not point to GitHub; the PR step will fail.')

  const gh = await ghAuthenticated()
  if (!gh.installed) warnings.push('GitHub CLI (gh) is not installed; the PR step will fail.')
  else if (!gh.authed) warnings.push('GitHub CLI (gh) is not authenticated; run "gh auth login" before approving.')

  let branch = ''
  try { branch = await git(repo, ['branch', '--show-current']) } catch { /* detached HEAD */ }

  return { clean, originOnGithub, ghInstalled: gh.installed, ghAuthenticated: gh.authed, branch, warnings }
}

export function canShip (p: Preflight): string | null {
  if (!p.clean) return 'Working tree is not clean.'
  if (!p.originOnGithub) return 'Remote "origin" does not point to GitHub.'
  if (!p.ghInstalled) return 'GitHub CLI (gh) is not installed.'
  if (!p.ghAuthenticated) return 'GitHub CLI (gh) is not authenticated.'
  return null
}
