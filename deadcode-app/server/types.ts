export type Confidence = 'High' | 'Medium' | 'Low'
export type Risk = 'Low' | 'Medium' | 'High'

export interface Finding {
  id: string
  file: string
  startLine: number
  endLine: number
  snippet: string
  evidence: string
  confidence: Confidence
  risk: Risk
  // Set by the server when the snippet in findings.json does not match the file on disk.
  warning?: string
}

export type JobStatus = 'analyzing' | 'awaiting_approval' | 'shipping' | 'done' | 'error' | 'cancelled'

export type AppEvent =
  | { type: 'status'; status: JobStatus; message?: string }
  | { type: 'log'; kind: 'text' | 'tool' | 'info'; text: string }
  | { type: 'findings'; findings: Finding[]; warnings: string[] }
  | { type: 'pr'; url: string; branch?: string; draft?: boolean; removedIds?: string[]; skippedIds?: string[]; verification?: string }
  | { type: 'error'; message: string }

export class HttpError extends Error {
  constructor (public status: number, message: string) {
    super(message)
  }
}
