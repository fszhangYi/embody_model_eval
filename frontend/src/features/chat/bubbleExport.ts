import { marked } from 'marked'
import html2pdf from 'html2pdf.js'

marked.setOptions({ gfm: true, breaks: true })

const PDF_STYLES = `
  *, *::before, *::after { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #ffffff;
    color: #111827;
  }
  body {
    padding: 28px 32px;
    font-family: "IBM Plex Sans", "Segoe UI", "PingFang SC", "Noto Sans SC", sans-serif;
    font-size: 13px;
    line-height: 1.55;
  }
  h1 { font-size: 18px; margin: 0 0 12px; color: #111827; }
  h2 { font-size: 15px; margin: 14px 0 8px; color: #111827; }
  h3 { font-size: 13px; margin: 12px 0 6px; color: #111827; }
  p { margin: 0 0 8px; color: #111827; }
  em { color: #4b5563; }
  strong { color: #111827; }
  a { color: #2563eb; text-decoration: none; }
  pre, code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    color: #111827;
  }
  pre {
    white-space: pre-wrap;
    word-break: break-word;
    background: #f3f4f6;
    padding: 8px;
    border-radius: 6px;
    margin: 0 0 8px;
  }
  code { background: #f3f4f6; padding: 1px 4px; border-radius: 4px; }
  pre code { background: transparent; padding: 0; }
  ul, ol { margin: 0 0 8px; padding-left: 20px; color: #111827; }
  li { margin: 0 0 4px; }
  blockquote {
    margin: 0 0 8px;
    padding: 4px 12px;
    border-left: 3px solid #d1d5db;
    color: #374151;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 10px;
    font-size: 11px;
  }
  th, td {
    border: 1px solid #d1d5db;
    padding: 4px 6px;
    text-align: left;
    color: #111827;
  }
  hr { border: 0; border-top: 1px solid #e5e7eb; margin: 12px 0; }
`

export function bubbleMarkdown(title: string, text: string, meta?: string): string {
  const lines = [`# ${title}`, '']
  if (meta?.trim()) {
    lines.push(`_${meta.trim()}_`, '')
  }
  lines.push(text.trim(), '')
  return lines.join('\n')
}

export function downloadMarkdown(filename: string, markdown: string): void {
  const blob = new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

function waitForPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

function parseMarkdownHtml(markdown: string): string {
  const parsed = marked.parse(markdown, { async: false })
  return typeof parsed === 'string' ? parsed : String(parsed)
}

function createPdfFrame(html: string): { iframe: HTMLIFrameElement; body: HTMLElement } {
  const iframe = document.createElement('iframe')
  iframe.setAttribute('aria-hidden', 'true')
  iframe.setAttribute('title', 'pdf-export')
  iframe.style.cssText = [
    'position: fixed',
    'left: 0',
    'top: 0',
    'width: 794px',
    'height: 1px',
    'border: 0',
    'margin: 0',
    'padding: 0',
    'opacity: 0',
    'pointer-events: none',
    'z-index: 99999',
    'background: #ffffff',
  ].join(';')

  document.body.appendChild(iframe)

  const doc = iframe.contentDocument
  if (!doc) {
    throw new Error('PDF iframe unavailable')
  }

  doc.open()
  doc.write(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<style>${PDF_STYLES}</style>
</head>
<body>${html}</body>
</html>`)
  doc.close()

  const body = doc.body
  iframe.style.height = `${Math.max(body.scrollHeight, 1)}px`

  return { iframe, body }
}

export async function downloadMarkdownAsPdf(filename: string, markdown: string): Promise<void> {
  const html = parseMarkdownHtml(markdown)
  const { iframe, body } = createPdfFrame(html)

  try {
    const frameFonts = iframe.contentDocument?.fonts
    if (frameFonts?.ready) {
      await frameFonts.ready
    }
    await waitForPaint()
    iframe.style.height = `${Math.max(body.scrollHeight, 1)}px`

    await html2pdf()
      .set({
        margin: [10, 10, 10, 10],
        filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: {
          scale: 2,
          useCORS: true,
          logging: false,
          backgroundColor: '#ffffff',
          scrollX: 0,
          scrollY: 0,
          windowWidth: body.scrollWidth,
          windowHeight: body.scrollHeight,
        },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      })
      .from(body)
      .save()
  } finally {
    iframe.remove()
  }
}
