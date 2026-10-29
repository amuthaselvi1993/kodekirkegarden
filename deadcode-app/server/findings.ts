import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import { MAX_FILE_BYTES } from './config.js'
import type { Finding } from './types.js'

const FindingSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/),
  file: z.string().min(1).max(500),
  startLine: z.number().int().min(1),
  endLine: z.number().int().min(1),
  snippet: z.string().max(20_000),
  evidence: z.string().max(4_000),
  confidence: z.enum(['High', 'Medium', 'Low']),
  risk: z.enum(['Low', 'Medium', 'High'])
}).refine((f) => f.endLine >= f.startLine, { message: 'endLine must be >= startLine' })

const normalize = (s: string): string => s.replace(/\r\n/g, '\n').split('\n').map((l) => l.trimEnd()).join('\n').trim()

/** Resolves a repo-relative path and refuses anything that escapes the repo (including via symlinks). */
export async function resolveInRepo (repo: string, rel: string): Promise<string> {
  const clean = rel.replace(/\\/g, '/')
  if (path.isAbsolute(clean) || clean.split('/').includes('..')) throw new Error('path escapes the repository')
  const real = await fs.realpath(path.join(repo, clean))
  const back = path.relative(repo, real)
  if (back.startsWith('..') || path.isAbsolute(back)) throw new Error('path escapes the repository')
  return real
}

export async function readRepoFile (repo: string, rel: string): Promise<string> {
  const real = await resolveInRepo(repo, rel)
  const stat = await fs.stat(real)
  if (!stat.isFile()) throw new Error('not a file')
  if (stat.size > MAX_FILE_BYTES) throw new Error('file too large to display')
  return fs.readFile(real, 'utf8')
}

/** Parses and validates findings.json. Invalid entries are dropped and reported as warnings. */
export async function loadFindings (repo: string, jsonPath: string): Promise<{ findings: Finding[], warnings: string[] }> {
  const warnings: string[] = []
  let raw: unknown
  try {
    raw = JSON.parse(await fs.readFile(jsonPath, 'utf8'))
  } catch {
    throw new Error('The agent did not produce a valid findings.json')
  }
  const list = Array.isArray(raw) ? raw : (raw as { findings?: unknown })?.findings
  if (!Array.isArray(list)) throw new Error('findings.json must be a JSON array')

  const findings: Finding[] = []
  const seen = new Set<string>()
  for (const entry of list) {
    const parsed = FindingSchema.safeParse(entry)
    if (!parsed.success) {
      const id = typeof (entry as { id?: unknown })?.id === 'string' ? (entry as { id: string }).id : '?'
      warnings.push(`Dropped finding ${id}: invalid shape`)
      continue
    }
    const f: Finding = { ...parsed.data, file: parsed.data.file.replace(/\\/g, '/').replace(/^\.\//, '') }
    if (seen.has(f.id)) { warnings.push(`Dropped duplicate id ${f.id}`); continue }

    let text: string
    try {
      text = await readRepoFile(repo, f.file)
    } catch (err) {
      warnings.push(`Dropped ${f.id}: ${f.file} cannot be read (${(err as Error).message})`)
      continue
    }
    const lines = text.split(/\r?\n/)
    if (lines.at(-1) === '') lines.pop()
    if (f.endLine > lines.length) { warnings.push(`Dropped ${f.id}: line range is outside ${f.file}`); continue }

    const actual = lines.slice(f.startLine - 1, f.endLine).join('\n')
    if (normalize(actual) !== normalize(f.snippet)) {
      f.warning = 'Snippet in findings.json differs from the file on disk. The diff shows the file.'
    }
    seen.add(f.id)
    findings.push(f)
  }

  // Overlapping ranges in one file would make removal ambiguous.
  const byFile = new Map<string, Finding[]>()
  for (const f of findings) byFile.set(f.file, [...(byFile.get(f.file) ?? []), f])
  for (const group of byFile.values()) {
    group.sort((a, b) => a.startLine - b.startLine)
    for (let i = 1; i < group.length; i++) {
      const prev = group[i - 1]!
      const cur = group[i]!
      if (cur.startLine <= prev.endLine) warnings.push(`${prev.id} and ${cur.id} overlap in ${cur.file}; do not approve both.`)
    }
  }
  return { findings, warnings }
}
