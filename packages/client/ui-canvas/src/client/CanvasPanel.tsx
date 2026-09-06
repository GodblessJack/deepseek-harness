/**
 * Canvas conversation view: artifact tabs plus the selected artifact's
 * viewer, as one 'conversation.view' tab beside Chat and Trajectory.
 * @module @deepseek-ai/dsh-client-ui-canvas/client/CanvasPanel
 */

import { useEffect, useState, type ReactNode } from 'react'
import type { CanvasArtifact } from '@deepseek-ai/dsh-host-canvas/types'
import type { CanvasView } from './controller.ts'
import { downloadArtifactBody } from './controller.ts'
import type { CanvasPanelProps } from './slots.ts'
import css from './CanvasPanel.module.css'

/** One artifact rendered by kind. */
function renderStage(artifact: CanvasArtifact): ReactNode {
  if (artifact.kind === 'html') {
    return (
      <iframe
        className={css.frame}
        sandbox="allow-scripts"
        srcDoc={artifact.content}
        title={artifact.title}
      />
    )
  }
  if (artifact.kind === 'markdown') {
    return (
      <div
        className={css.md}
        dangerouslySetInnerHTML={{ __html: mdToHtml(artifact.content) }}
      />
    )
  }
  return <pre className={css.pre}>{artifact.content}</pre>
}

/**
 * Print-view document for one artifact. HTML artifacts open verbatim so a
 * self-contained report prints exactly as authored; markdown and text are
 * wrapped in a print stylesheet whose values match the md2html.py report
 * deliverable (to be folded into the shared theme source with its ticket).
 * @param artifact - the artifact to print.
 * @returns a complete HTML document string for a new tab.
 */
function printDocument(artifact: CanvasArtifact): string {
  if (artifact.kind === 'html') return artifact.content
  const body = artifact.kind === 'markdown'
    ? mdToHtml(artifact.content)
    : `<pre>${esc(artifact.content)}</pre>`
  return [
    '<!doctype html><html lang="zh"><head><meta charset="utf-8">',
    `<title>${esc(artifact.title)}</title>`,
    '<style>',
    'body { margin: 0 auto; padding: 32px 40px; max-width: 820px;',
    '  font-family: "Noto Sans CJK SC", "Source Han Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif;',
    '  font-size: 14px; line-height: 1.75; color: #1f2937; background: #fff }',
    'table { border-collapse: collapse; width: 100%; font-size: 13px }',
    'th, td { border: 1px solid #b9c4cf; padding: 6px 10px; text-align: left }',
    'th { background: #eef2f6 }',
    'pre { background: #f3f4f6; padding: 12px 14px; overflow: auto }',
    '@media print { body { padding: 0; max-width: none } }',
    '</style></head><body>',
    body,
    '</body></html>',
  ].join('')
}

/**
 * View header: the view-level actions live here — download, copy, and print
 * for the selected artifact, plus the back-to-chat navigation that replaces
 * the details-column close button of the panel's earlier form.
 */
function PanelHeader({ backToChat, selected, content }: {
  backToChat: () => void
  selected: { id: string } | null
  content: CanvasArtifact | null
}): ReactNode {
  const copyContent = () => {
    if (content === null) return
    void navigator.clipboard?.writeText(content.content).catch(() => {})
  }
  const openPrintView = () => {
    if (content === null) return
    const blob = new Blob([printDocument(content)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const view = window.open(url, '_blank')
    // The blob URL is same-origin, so printing can be triggered directly; when
    // a popup blocker returns null the new tab is still the printable surface.
    view?.print()
    setTimeout(() => { URL.revokeObjectURL(url) }, 60_000)
  }
  return (
    <div className={css.header}>
      <span className={css.headerTitle}>画布</span>
      <div className={css.actions}>
        {selected !== null
          ? (
            <>
              <button
                type="button"
                className={css.action}
                title="下载作品本体"
                onClick={() => { if (content !== null) downloadArtifactBody(content) }}
                disabled={content === null}
              >
                下载
              </button>
              {content !== null
                ? (
                  <>
                    <button type="button" className={css.action} title="复制全文" onClick={copyContent}>复制</button>
                    <button type="button" className={css.action} title="在新标签打开并打印" onClick={openPrintView}>打印</button>
                  </>
                )
                : null}
            </>
          )
          : null}
        <button
          type="button"
          className={css.action}
          title="回到对话"
          aria-label="回到对话"
          onClick={backToChat}
        >
          ✕
        </button>
      </div>
    </div>
  )
}

/** Canvas conversation view component. */
export function CanvasPanel({
  canvas, sessionId, viewRequest, completeViewRequest, openView,
}: CanvasPanelProps): ReactNode {
  const controller = canvas
  const [view, setView] = useState<CanvasView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localSelected, setLocalSelected] = useState<string | null>(null)
  const [content, setContent] = useState<CanvasArtifact | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const res = await controller.poll()
      if (!alive) return
      if (res.ok) {
        setView(res.view)
        setError(null)
      } else {
        setError(res.message)
      }
    }
    void load()
    const timer = setInterval(load, 1000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [controller, sessionId])

  const pick = (id: string) => {
    setLocalSelected(id)
    void controller.openArtifact(id)
  }
  const fillDemo = async () => {
    await controller.fillDemo()
    const res = await controller.poll()
    if (res.ok) {
      setView(res.view)
      setLocalSelected(null)
    }
  }
  const backToChat = () => { openView('chat', '') }

  // One-shot focus request from outside (a future opener): select the addressed
  // artifact, then acknowledge so the request does not replay on re-renders.
  useEffect(() => {
    if (viewRequest === null || viewRequest.view !== 'canvas') return
    if (viewRequest.focus !== '') {
      setLocalSelected(viewRequest.focus)
      void controller.openArtifact(viewRequest.focus)
    }
    completeViewRequest()
  }, [viewRequest, completeViewRequest, controller])

  // Selected id is derived before the early returns so the content effect can
  // run unconditionally above them (hooks may not follow a conditional return).
  const selectedId = view !== null
    ? (localSelected !== null ? localSelected : view.selected)
    : null

  // The polled view carries summaries only; the selected artifact's content is
  // fetched when the selection or the revision changes, not on every poll.
  useEffect(() => {
    let alive = true
    if (selectedId === null) {
      setContent(null)
      return
    }
    void controller.loadContent(selectedId).then((res) => {
      if (!alive) return
      if (res.ok) setContent(res.artifact)
    })
    return () => { alive = false }
  }, [controller, selectedId, view?.rev])

  if (error !== null) {
    return (
      <div className={css.panel}>
        <PanelHeader backToChat={backToChat} selected={null} content={null} />
        <div className={css.empty}>画布加载失败: {error}</div>
      </div>
    )
  }
  if (view === null) {
    return (
      <div className={css.panel}>
        <PanelHeader backToChat={backToChat} selected={null} content={null} />
        <div className={css.empty}>加载中…</div>
      </div>
    )
  }

  const artifacts = view.artifacts
  const selected = artifacts.find(artifact => artifact.id === selectedId) ?? null

  if (artifacts.length === 0) {
    return (
      <div className={css.panel}>
        <PanelHeader backToChat={backToChat} selected={null} content={null} />
        <div className={css.empty}>
          <div>画布还是空的。</div>
          <div>切回「对话」页说「在画布上写一个 …」, 或者点下面的按钮填入示例。</div>
          <button type="button" className={css.demo} onClick={() => void fillDemo()}>填入示例</button>
        </div>
      </div>
    )
  }

  return (
    <div className={css.panel}>
      <PanelHeader backToChat={backToChat} selected={selected} content={content} />
      <div className={css.tabs}>
        {artifacts.map(artifact => (
          <button
            key={artifact.id}
            type="button"
            className={artifact.id === selectedId ? `${css.chip} ${css.chipOn}` : css.chip}
            onClick={() => { pick(artifact.id) }}
            title={artifact.title}
          >
            {artifact.title}
            <span className={css.kind}>{artifact.kind}</span>
          </button>
        ))}
      </div>
      <div className={css.body}>
        <div className={css.meta}>
          {selected !== null
            ? `${selected.title} · ${selected.kind}${content !== null ? ` · ${content.content.length} 字符` : ''}`
            : ''}
          {selected?.attachments?.map(attachment => (
            <span key={attachment.name} className={css.download} title={`附件 ${attachment.name} (${attachment.bytes} 字节)`}>
              {`附件 ${attachment.name}`}
            </span>
          ))}
        </div>
        <div className={css.stage}>
          {selected === null
            ? <div className={css.empty}>选一个作品查看</div>
            : content === null
              ? <div className={css.empty}>加载内容…</div>
              : renderStage(content)}
        </div>
      </div>
    </div>
  )
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>')
}

/** One pipe-table row split into trimmed, already-escaped cells. */
function tableCells(row: string): string[] {
  return row.replace(/^\|/, '').replace(/\|$/, '').split('|').map(cell => cell.trim())
}

/** A separator row consists only of pipes, colons, hyphens, and spaces. */
function isSeparatorRow(row: string): boolean {
  return /^[\s|:-]+$/.test(row)
}

/**
 * Render the panel's markdown subset to HTML: headings, paragraphs,
 * unordered/ordered lists, blockquotes, rules, fenced code, inline
 * code/bold/emphasis/links, and pipe tables. A pipe-led block renders as a
 * table only when its second row is a separator row; otherwise the rows stay
 * paragraph text, so prose or shell pipelines that merely start with a pipe
 * are not misread as tables. The first data row is the header row.
 * @param src - raw markdown source of a markdown-kind artifact.
 * @returns the rendered HTML string (unescaped input is escaped here).
 */
export function mdToHtml(src: string): string {
  const lines = src.split(/\r?\n/)
  const out: string[] = []
  let inCode = false
  let codeBuf: string[] = []
  let list: 'ul' | 'ol' | null = null
  let para: string[] = []
  const flushPara = () => {
    if (para.length > 0) {
      out.push(`<p>${inline(para.join(' '))}</p>`)
      para = []
    }
  }
  const flushList = () => {
    if (list !== null) {
      out.push(`</${list}>`)
      list = null
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const t = line.trim()
    if (t.startsWith('```')) {
      flushPara()
      flushList()
      if (!inCode) {
        inCode = true
        codeBuf = []
      } else {
        inCode = false
        out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`)
      }
      continue
    }
    if (inCode) {
      codeBuf.push(line)
      continue
    }
    const e = esc(t)
    if (e === '') {
      flushPara()
      flushList()
      continue
    }
    if (e.startsWith('|')) {
      const block: string[] = []
      let j = i
      while (j < lines.length) {
        const candidate = esc((lines[j] ?? '').trim())
        if (!candidate.startsWith('|')) break
        block.push(candidate)
        j++
      }
      const hasHeader = block.length >= 2 && isSeparatorRow(block[1] ?? '')
      const dataRows = block.filter(row => !isSeparatorRow(row)).map(tableCells)
      const [head, ...body] = dataRows
      if (hasHeader && head !== undefined) {
        flushPara()
        flushList()
        out.push(
          `<table><thead><tr>${head.map(cell => `<th>${inline(cell)}</th>`).join('')}</tr></thead>`
          + `<tbody>${body.map(row => `<tr>${row.map(cell => `<td>${inline(cell)}</td>`).join('')}</tr>`).join('')}</tbody></table>`,
        )
        i = j - 1
        continue
      }
      para.push(e)
      continue
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(e)
    if (h !== null) {
      flushPara()
      flushList()
      const n = h[1]?.length ?? 0
      out.push(`<h${n}>${inline(h[2] ?? '')}</h${n}>`)
      continue
    }
    if (/^-{3,}$/.test(e)) {
      flushPara()
      flushList()
      out.push('<hr/>')
      continue
    }
    const bq = /^&gt;\s?(.*)$/.exec(e)
    if (bq !== null) {
      flushPara()
      flushList()
      out.push(`<blockquote>${inline(bq[1] ?? '')}</blockquote>`)
      continue
    }
    const ul = /^[-*+]\s+(.*)$/.exec(e)
    if (ul !== null) {
      flushPara()
      if (list !== 'ul') {
        flushList()
        list = 'ul'
        out.push('<ul>')
      }
      out.push(`<li>${inline(ul[1] ?? '')}</li>`)
      continue
    }
    const ol = /^\d+\.\s+(.*)$/.exec(e)
    if (ol !== null) {
      flushPara()
      if (list !== 'ol') {
        flushList()
        list = 'ol'
        out.push('<ol>')
      }
      out.push(`<li>${inline(ol[1] ?? '')}</li>`)
      continue
    }
    para.push(e)
  }
  flushPara()
  flushList()
  if (inCode) out.push(`<pre><code>${esc(codeBuf.join('\n'))}</code></pre>`)
  return out.join('\n')
}
