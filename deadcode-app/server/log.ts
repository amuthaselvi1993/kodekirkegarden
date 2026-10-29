import { redact } from './redact.js'

// Operational logging only: job ids, status changes, error messages. Never request bodies,
// prompts, environment variables or command output.
export function log (message: string): void {
  console.log(`${new Date().toISOString()} ${redact(message)}`)
}

export function logError (message: string, err?: unknown): void {
  const detail = err instanceof Error ? err.message : err === undefined ? '' : String(err)
  console.error(`${new Date().toISOString()} ${redact(detail ? `${message}: ${detail}` : message)}`)
}
