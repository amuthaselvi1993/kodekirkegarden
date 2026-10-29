import fs from 'node:fs'
import path from 'node:path'

// Tool permission policy for the agent. Every tool call goes through canUseTool (nothing is
// auto-approved), so the agent can only do what is listed here.
//   analyze: read the repo, write only into the job's output folder, read-only shell commands.
//   ship:    additionally edit the repo and run git/gh/verification commands for the Phase 4 flow.
export type Phase = 'analyze' | 'ship'

export interface PolicyContext {
  phase: Phase
  repo: string
  outDir: string
}

type Decision = { behavior: 'allow', updatedInput: Record<string, unknown> } | { behavior: 'deny', message: string }

const BRANCH = /^chore\/[A-Za-z0-9._/-]{1,80}$/
// Shell metacharacters are rejected everywhere, so a command is always one simple command.
const SHELL_META = /[;&|`<>$\\\n\r]/

function resolveReal (p: string): string {
  let current = path.resolve(p)
  const tail: string[] = []
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) break
    tail.unshift(path.basename(current))
    current = parent
  }
  try { current = fs.realpathSync(current) } catch { /* keep as is */ }
  return path.join(current, ...tail)
}

function isInside (target: string, base: string): boolean {
  const rel = path.relative(resolveReal(base), resolveReal(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function tokenize (command: string): string[] | null {
  const tokens: string[] = []
  let cur = ''
  let inQuote = false
  let has = false
  for (const ch of command.trim()) {
    if (ch === '"') { inQuote = !inQuote; has = true; continue }
    if (!inQuote && /\s/.test(ch)) {
      if (has) { tokens.push(cur); cur = ''; has = false }
      continue
    }
    cur += ch
    has = true
  }
  if (inQuote) return null
  if (has) tokens.push(cur)
  return tokens
}

const READ_ONLY_GIT = new Set(['rev-parse', 'status', 'remote', 'log', 'ls-files', 'grep', 'show', 'diff', 'blame', 'shortlog'])
const VERIFY: RegExp[] = [
  /^npm (test|ci --ignore-scripts)$/,
  /^npm run (test|build|lint|typecheck|type-check|check)$/,
  /^npx tsc --noEmit$/,
  /^(python -m )?pytest( -q)?$/,
  /^go (build|test|vet) \.\/\.\.\.$/,
  /^dotnet (build|test)$/,
  /^mvn (-q )?(test|verify)$/,
  /^make (test|build|lint)$/
]

export function makeCanUseTool (ctx: PolicyContext) {
  const bases = [ctx.repo, ctx.outDir]
  const underAny = (p: string, list: string[]): boolean => list.some((b) => isInside(path.resolve(ctx.repo, p), b))

  function checkBash (command: string): string | null {
    if (SHELL_META.test(command)) return 'Only single simple commands are allowed (no pipes, redirects, ;, &&, $, backticks or backslashes).'
    const t = tokenize(command)
    if (!t || t.length === 0) return 'Could not parse the command.'
    const [cmd, sub, ...rest] = t as [string, ...string[]]
    const args = t.slice(1)

    if (cmd === 'git') {
      if (sub === undefined) return 'Missing git subcommand.'
      if (rest.some((a) => a.startsWith('--output') || a === '-O' || a.startsWith('--open-files-in-pager') || a === '--no-verify')) return 'That git option is not allowed.'
      if (READ_ONLY_GIT.has(sub)) return null
      if (sub === 'branch' && rest.every((a) => ['--show-current', '-a', '-r', '--list'].includes(a))) return null
      if (sub === 'config' && rest[0] === '--get' && rest.length === 2) return null
      if (ctx.phase !== 'ship') return 'Only read-only git commands are allowed in the analysis run.'
      if (sub === 'switch' && rest[0] === '-c' && rest.length === 2 && BRANCH.test(rest[1]!)) return null
      if (sub === 'add') {
        const paths = rest.filter((a) => a !== '--' && a !== '-u')
        const bad = paths.some((p) => p.startsWith('-') || p.split('/').includes('..') || path.isAbsolute(p) || !underAny(p, [ctx.repo]))
        return paths.length > 0 && !bad ? null : 'git add needs explicit repo-relative paths.'
      }
      if (sub === 'commit') {
        const [flag, file, ...more] = rest
        if ((flag === '-F' || flag === '--file') && file && more.length === 0 && underAny(file, [ctx.outDir])) return null
        return 'Commit with: git commit -F <message file in the output folder>.'
      }
      if (sub === 'push') {
        const ok = rest.length === 3 && (rest[0] === '-u' || rest[0] === '--set-upstream') && rest[1] === 'origin' && BRANCH.test(rest[2]!)
        return ok ? null : 'Push is only allowed as: git push -u origin chore/<branch>'
      }
      return `git ${sub} is not allowed.`
    }

    if (cmd === 'gh') {
      if (sub === 'auth' && rest[0] === 'status') return null
      if (sub === 'repo' && rest[0] === 'view') return null
      if (ctx.phase !== 'ship') return 'Only read-only gh commands are allowed in the analysis run.'
      if (sub === 'pr' && rest[0] === 'view') return null
      if (sub === 'pr' && rest[0] === 'create') {
        const flags = new Map<string, string>()
        const a = rest.slice(1)
        for (let i = 0; i < a.length; i++) {
          const f = a[i]!
          if (f === '--draft') continue
          if (['--base', '--head', '--title', '--body-file'].includes(f) && a[i + 1] !== undefined) { flags.set(f, a[++i]!); continue }
          return `gh pr create: option ${f} is not allowed.`
        }
        const body = flags.get('--body-file')
        if (!flags.get('--base') || !flags.get('--title')) return 'gh pr create needs --base and --title.'
        if (!BRANCH.test(flags.get('--head') ?? '')) return 'gh pr create --head must be a chore/ branch.'
        if (!body || !underAny(body, [ctx.outDir])) return 'gh pr create --body-file must be a file in the output folder.'
        return null
      }
      return `gh ${sub ?? ''} is not allowed.`
    }

    if (['ls', 'wc', 'pwd', 'head', 'tail'].includes(cmd)) {
      const paths = args.filter((a) => !a.startsWith('-'))
      return paths.every((p) => underAny(p, bases)) ? null : 'Path is outside the repository.'
    }

    if (ctx.phase === 'ship' && VERIFY.some((re) => re.test(t.join(' ')))) return null
    return `${cmd} is not allowed. Use Read, Grep and Glob for reading and searching.`
  }

  return async (toolName: string, input: Record<string, unknown>): Promise<Decision> => {
    const allow = (): Decision => ({ behavior: 'allow', updatedInput: input })
    const deny = (message: string): Decision => ({ behavior: 'deny', message })
    const str = (k: string): string | undefined => (typeof input[k] === 'string' ? (input[k] as string) : undefined)

    switch (toolName) {
      case 'Read':
      case 'Grep':
      case 'Glob': {
        const p = str('file_path') ?? str('path')
        const pattern = str('pattern')
        if (toolName === 'Glob' && pattern && (path.isAbsolute(pattern) || pattern.split(/[\\/]/).includes('..'))) return deny('Glob pattern must stay inside the repository.')
        if (p !== undefined && !underAny(p, bases)) return deny('Path is outside the repository.')
        return allow()
      }
      case 'Write':
      case 'Edit':
      case 'MultiEdit': {
        const p = str('file_path')
        if (!p) return deny('file_path is required.')
        const allowedBases = ctx.phase === 'ship' ? bases : [ctx.outDir]
        if (!underAny(p, allowedBases)) return deny(ctx.phase === 'ship' ? 'Writes are limited to the repository and the output folder.' : 'In the analysis run you may only write into the output folder.')
        const abs = path.resolve(ctx.repo, p)
        if (abs.split(path.sep).includes('.git') || path.basename(abs).startsWith('.env')) return deny('That file may not be modified.')
        return allow()
      }
      case 'Bash': {
        const command = str('command')
        if (!command) return deny('command is required.')
        const problem = checkBash(command)
        return problem ? deny(problem) : allow()
      }
      case 'TodoWrite':
        return allow()
      default:
        return deny(`Tool ${toolName} is not available in this app.`)
    }
  }
}
