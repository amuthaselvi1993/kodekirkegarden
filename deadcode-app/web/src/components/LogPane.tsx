import { useEffect, useRef } from 'react'

export interface LogLine { kind: 'text' | 'tool' | 'info', text: string }

export function LogPane ({ lines, busy }: { lines: LogLine[], busy: boolean }) {
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'nearest' }) }, [lines.length])
  if (lines.length === 0 && !busy) return null
  return (
    <section className="log" aria-label="Progress">
      <h2>Progress {busy && <span className="spinner" aria-hidden />}</h2>
      <div className="log-lines">
        {lines.map((l, i) => <div key={i} className={`log-${l.kind}`}>{l.text}</div>)}
        <div ref={end} />
      </div>
    </section>
  )
}
