// Everything that leaves the server (SSE events, log lines) goes through redact().
const SECRET_ENV_NAME = /(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)/i

const PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, '[redacted]'],
  [/\bsk-ant-[A-Za-z0-9_-]{10,}/g, '[redacted]'],
  [/\bsk-[A-Za-z0-9]{20,}\b/g, '[redacted]'],
  [/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{10,}/gi, 'Bearer [redacted]'],
  [/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/g, '$1[redacted]@'],
  [/\b(authorization|api[_-]?key|access[_-]?token|auth[_-]?token|token|password|passwd|secret)(["']?\s*[:=]\s*["']?)[^\s"',;]{6,}/gi, '$1$2[redacted]']
]

function envSecrets (): string[] {
  const values: string[] = []
  for (const [name, value] of Object.entries(process.env)) {
    if (value && value.length >= 8 && SECRET_ENV_NAME.test(name)) values.push(value)
  }
  return values
}

export function redact (text: string): string {
  let out = text
  for (const secret of envSecrets()) out = out.split(secret).join('[redacted]')
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement)
  return out
}
