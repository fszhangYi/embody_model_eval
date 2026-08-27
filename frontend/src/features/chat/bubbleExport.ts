import { marked } from 'marked'
import html2pdf from 'html2pdf.js'

marked.setOptions({ gfm: true, breaks: true })

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

export async function downloadMarkdownAsPdf(filename: string, markdown: string): Promise<void> {
  const html = marked.parse(markdown)
  const host = document.createElement('div')
  host.className = 'chat-pdf-export'
  host.innerHTML = typeof html === 'string' ? html : String(html)
  host.style.position = 'fixed'
  host.style.left = '-10000px'
  host.style.top = '0'
  host.style.width = '720px'
  document.body.appendChild(host)

  try {
    await html2pdf()
      .set({
        margin: [12, 14, 12, 14],
        filename,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, logging: false },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] },
      })
      .from(host)
      .save()
  } finally {
    host.remove()
  }
}
