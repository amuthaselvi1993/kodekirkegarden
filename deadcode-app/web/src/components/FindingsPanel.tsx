import { useMemo, useState } from 'react'
import type { Confidence, Finding, Risk } from '../types'

const CONFIDENCE: Confidence[] = ['High', 'Medium', 'Low']
const RISK: Risk[] = ['Low', 'Medium', 'High']

interface Props {
  findings: Finding[]
  activeId?: string
  selected: Set<string>
  onActivate: (id: string) => void
  onSelectedChange: (next: Set<string>) => void
  onApprove: () => void
  canApprove: boolean
  repoPath: string
}

export function FindingsPanel ({ findings, activeId, selected, onActivate, onSelectedChange, onApprove, canApprove, repoPath }: Props) {
  const [conf, setConf] = useState<Set<Confidence>>(new Set(CONFIDENCE))
  const [risk, setRisk] = useState<Set<Risk>>(new Set(RISK))
  const [confirming, setConfirming] = useState(false)

  const visible = useMemo(() => findings.filter((f) => conf.has(f.confidence) && risk.has(f.risk)), [findings, conf, risk])
  const chosen = findings.filter((f) => selected.has(f.id))
  const lines = chosen.reduce((n, f) => n + (f.endLine - f.startLine + 1), 0)
  const files = new Set(chosen.map((f) => f.file)).size

  const toggle = <T,>(set: Set<T>, value: T, apply: (s: Set<T>) => void) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value); else next.add(value)
    apply(next)
  }
  const setSel = (ids: string[]) => { setConfirming(false); onSelectedChange(new Set(ids)) }
  const flip = (id: string) => {
    setConfirming(false)
    const next = new Set(selected)
    if (next.has(id)) next.delete(id); else next.add(id)
    onSelectedChange(next)
  }

  return (
    <aside className="findings">
      <h2>Findings <span className="count">{visible.length}/{findings.length}</span></h2>

      <div className="filters">
        <fieldset>
          <legend>Confidence</legend>
          {CONFIDENCE.map((c) => (
            <label key={c}><input type="checkbox" checked={conf.has(c)} onChange={() => toggle(conf, c, setConf)} /> {c}</label>
          ))}
        </fieldset>
        <fieldset>
          <legend>Risk</legend>
          {RISK.map((r) => (
            <label key={r}><input type="checkbox" checked={risk.has(r)} onChange={() => toggle(risk, r, setRisk)} /> {r}</label>
          ))}
        </fieldset>
      </div>

      <div className="bulk">
        <button type="button" className="link" onClick={() => setSel([...selected, ...visible.map((f) => f.id)])}>Select visible</button>
        <button type="button" className="link" onClick={() => setSel(findings.filter((f) => f.confidence === 'High' && f.risk === 'Low').map((f) => f.id))}>High confidence + low risk</button>
        <button type="button" className="link" onClick={() => setSel([])}>Clear</button>
      </div>

      <ul>
        {visible.map((f) => (
          <li key={f.id} className={f.id === activeId ? 'active' : ''}>
            <input type="checkbox" checked={selected.has(f.id)} onChange={() => flip(f.id)} aria-label={`Select ${f.id}`} disabled={!canApprove} />
            <button type="button" className="row" onClick={() => onActivate(f.id)}>
              <span className="id">{f.id}</span>
              <span className="where">{f.file}:{f.startLine}{f.endLine > f.startLine ? `–${f.endLine}` : ''}</span>
              <span className="badges">
                <span className={`badge conf-${f.confidence}`}>{f.confidence}</span>
                <span className={`badge risk-${f.risk}`}>risk {f.risk}</span>
              </span>
              <span className="evidence">{f.evidence}</span>
              {f.warning && <span className="warning">{f.warning}</span>}
            </button>
          </li>
        ))}
        {visible.length === 0 && <li className="none">No findings match the filters.</li>}
      </ul>

      <div className="approve">
        {!confirming && (
          <button type="button" className="primary" disabled={!canApprove || chosen.length === 0} onClick={() => setConfirming(true)}>
            Approve {chosen.length > 0 ? `${chosen.length} item${chosen.length > 1 ? 's' : ''}` : ''}
          </button>
        )}
        {confirming && (
          <div className="confirm">
            <p>
              Remove {chosen.length} item{chosen.length > 1 ? 's' : ''} ({lines} lines in {files} file{files > 1 ? 's' : ''}) from <code>{repoPath}</code>?
              This creates a branch, commits, <strong>pushes it to GitHub</strong> and opens a pull request.
            </p>
            <button type="button" className="primary" onClick={() => { setConfirming(false); onApprove() }}>Yes, push and open PR</button>
            <button type="button" className="secondary" onClick={() => setConfirming(false)}>Back</button>
          </div>
        )}
      </div>
    </aside>
  )
}
