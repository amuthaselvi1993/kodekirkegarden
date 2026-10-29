import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { approve, cancelJob, createJob, subscribe } from './api'
import { DiffPane } from './components/DiffPane'
import { FindingsPanel } from './components/FindingsPanel'
import { LogPane, type LogLine } from './components/LogPane'
import type { AppEvent, Finding, JobStatus } from './types'

interface PrResult { url: string, branch?: string, draft?: boolean, removedIds?: string[], skippedIds?: string[], verification?: string }

export function App () {
  const [repoPath, setRepoPath] = useState('')
  const [jobId, setJobId] = useState<string>()
  const [status, setStatus] = useState<JobStatus>()
  const [logs, setLogs] = useState<LogLine[]>([])
  const [findings, setFindings] = useState<Finding[]>([])
  const [warnings, setWarnings] = useState<string[]>([])
  const [pr, setPr] = useState<PrResult>()
  const [error, setError] = useState<string>()
  const [activeId, setActiveId] = useState<string>()
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const unsubscribe = useRef<() => void>()

  const onEvent = useCallback((e: AppEvent) => {
    switch (e.type) {
      case 'status':
        setStatus(e.status)
        if (e.message) setLogs((l) => [...l, { kind: 'info', text: e.message! }])
        break
      case 'log': setLogs((l) => [...l, { kind: e.kind, text: e.text }]); break
      case 'findings': setFindings(e.findings); setWarnings(e.warnings); setActiveId(e.findings[0]?.id); break
      case 'pr': setPr(e); break
      case 'error': setError(e.message); break
    }
  }, [])

  useEffect(() => () => unsubscribe.current?.(), [])
  useEffect(() => {
    if (status === 'done' || status === 'error' || status === 'cancelled') unsubscribe.current?.()
  }, [status])

  async function start (ev: React.FormEvent) {
    ev.preventDefault()
    unsubscribe.current?.()
    setError(undefined); setPr(undefined); setFindings([]); setWarnings([]); setLogs([]); setSelected(new Set()); setActiveId(undefined)
    try {
      const { id, warnings: pre } = await createJob(repoPath.trim())
      setJobId(id)
      setStatus('analyzing')
      if (pre.length) setLogs(pre.map((text) => ({ kind: 'info' as const, text })))
      unsubscribe.current = subscribe(id, onEvent)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function doApprove () {
    if (!jobId) return
    setError(undefined)
    try {
      await approve(jobId, [...selected])
    } catch (err) {
      setError((err as Error).message)
    }
  }

  const active = useMemo(() => findings.find((f) => f.id === activeId), [findings, activeId])
  const busy = status === 'analyzing' || status === 'shipping'
  const showReview = findings.length > 0 && status !== 'analyzing'

  return (
    <div className="app">
      <header>
        <h1>Dead code cleanup</h1>
        <form onSubmit={start} className="repo-form">
          <input
            value={repoPath}
            onChange={(e) => setRepoPath(e.target.value)}
            placeholder="Absolute path to a git repository, e.g. C:\Users\me\repos\project"
            aria-label="Repository path"
            disabled={busy}
          />
          <button type="submit" disabled={busy || !repoPath.trim()}>Analyse</button>
          {busy && jobId && <button type="button" className="secondary" onClick={() => void cancelJob(jobId)}>Cancel</button>}
        </form>
        {status && <span className={`status status-${status}`}>{status.replace('_', ' ')}</span>}
      </header>

      {error && <div className="banner error" role="alert">{error}</div>}
      {warnings.map((w) => <div className="banner warn" key={w}>{w}</div>)}

      {pr && (
        <div className="banner success" role="status">
          <strong>Pull request created{pr.draft ? ' (draft)' : ''}:</strong>{' '}
          <a href={pr.url} target="_blank" rel="noopener noreferrer">{pr.url}</a>
          {pr.verification && <div>Verification: {pr.verification}</div>}
          {pr.skippedIds && pr.skippedIds.length > 0 && <div>Skipped by the agent: {pr.skippedIds.join(', ')}</div>}
          <div className="hint">Please review the PR before sharing it with others.</div>
        </div>
      )}

      {status === 'awaiting_approval' && findings.length === 0 && <div className="banner">No removable dead code was found.</div>}

      <main className={showReview ? 'review' : 'single'}>
        {showReview && (
          <>
            <FindingsPanel
              findings={findings}
              activeId={activeId}
              selected={selected}
              onActivate={setActiveId}
              onSelectedChange={setSelected}
              onApprove={() => void doApprove()}
              canApprove={status === 'awaiting_approval'}
              repoPath={repoPath}
            />
            <section className="diff-section">
              {active && jobId ? <DiffPane jobId={jobId} finding={active} /> : <div className="empty">Select a finding</div>}
            </section>
          </>
        )}
        <LogPane lines={logs} busy={busy} />
      </main>
    </div>
  )
}
