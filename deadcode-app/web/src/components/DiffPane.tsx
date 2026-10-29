import { DiffEditor, type DiffOnMount } from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { useEffect, useRef, useState } from 'react'
import { fetchFile } from '../api'
import type { Finding } from '../types'

const LANGUAGES: Record<string, string> = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  json: 'json', py: 'python', go: 'go', java: 'java', kt: 'kotlin', cs: 'csharp', rb: 'ruby', rs: 'rust',
  md: 'markdown', html: 'html', css: 'css', yml: 'yaml', yaml: 'yaml', xml: 'xml', sh: 'shell', php: 'php'
}
const languageOf = (file: string): string => LANGUAGES[file.split('.').pop()?.toLowerCase() ?? ''] ?? 'plaintext'

/** The file as it would look after the finding's lines are removed. */
function withoutLines (text: string, start: number, end: number): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  lines.splice(start - 1, end - start + 1)
  return lines.join(eol)
}

export function DiffPane ({ jobId, finding }: { jobId: string, finding: Finding }) {
  const [original, setOriginal] = useState<string>()
  const [error, setError] = useState<string>()
  const cache = useRef(new Map<string, string>())
  const editor = useRef<monaco.editor.IStandaloneDiffEditor>()
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection>()

  useEffect(() => {
    let cancelled = false
    setError(undefined)
    const hit = cache.current.get(finding.file)
    if (hit !== undefined) { setOriginal(hit); return }
    setOriginal(undefined)
    fetchFile(jobId, finding.file)
      .then((text) => { cache.current.set(finding.file, text); if (!cancelled) setOriginal(text) })
      .catch((err: Error) => { if (!cancelled) setError(err.message) })
    return () => { cancelled = true }
  }, [jobId, finding.file])

  // Highlight the lines to be removed in the left (original) pane and scroll to them.
  const highlight = () => {
    const left = editor.current?.getOriginalEditor()
    if (!left) return
    decorations.current?.clear()
    decorations.current = left.createDecorationsCollection([{
      range: new monaco.Range(finding.startLine, 1, finding.endLine, 1),
      options: { isWholeLine: true, className: 'removal-line', linesDecorationsClassName: 'removal-gutter' }
    }])
    left.revealLineInCenter(finding.startLine)
  }

  useEffect(() => {
    if (original === undefined) return
    const frame = requestAnimationFrame(highlight)
    return () => cancelAnimationFrame(frame)
  }, [original, finding.id, finding.startLine, finding.endLine])

  const onMount: DiffOnMount = (e) => { editor.current = e; highlight() }

  if (error) return <div className="empty error">Cannot show {finding.file}: {error}</div>
  if (original === undefined) return <div className="empty">Loading {finding.file}…</div>

  return (
    <div className="diff">
      <div className="diff-head">
        <strong>{finding.id}</strong> {finding.file}:{finding.startLine}–{finding.endLine}
        <span className="diff-legend">left: current · right: after removal</span>
      </div>
      <DiffEditor
        height="100%"
        theme="vs-dark"
        language={languageOf(finding.file)}
        original={original}
        modified={withoutLines(original, finding.startLine, finding.endLine)}
        onMount={onMount}
        options={{ readOnly: true, originalEditable: false, renderSideBySide: true, automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, renderOverviewRuler: true }}
      />
    </div>
  )
}
