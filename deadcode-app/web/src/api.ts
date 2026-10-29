import type { AppEvent } from './types'

async function json<T> (res: Response): Promise<T> {
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(body.error ?? res.statusText)
  }
  return res.json() as Promise<T>
}

const post = (url: string, body: unknown): Promise<Response> =>
  fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export const createJob = (repoPath: string): Promise<{ id: string, warnings: string[] }> =>
  post('/api/jobs', { repoPath }).then((r) => json(r))

export const approve = (id: string, ids: string[]): Promise<{ ok: boolean }> =>
  post(`/api/jobs/${id}/approve`, { ids }).then((r) => json(r))

export const cancelJob = (id: string): Promise<unknown> =>
  fetch(`/api/jobs/${id}`, { method: 'DELETE' }).then((r) => json(r))

export const fetchFile = (id: string, path: string): Promise<string> =>
  fetch(`/api/jobs/${id}/file?path=${encodeURIComponent(path)}`).then(async (r) => {
    if (!r.ok) throw new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.statusText)
    return r.text()
  })

/** Subscribes to the job's SSE stream. The browser reconnects automatically and the server replays missed events. */
export function subscribe (id: string, onEvent: (e: AppEvent) => void): () => void {
  const source = new EventSource(`/api/jobs/${id}/events`)
  source.onmessage = (m) => onEvent(JSON.parse(m.data as string) as AppEvent)
  return () => source.close()
}
