import DOMPurify from 'dompurify'
import { marked } from 'marked'

marked.setOptions({ gfm: true, breaks: true })

export function renderMarkdownHtml(markdown: string): string {
  const raw = markdown.trim()
  if (!raw) return ''

  const parsed = marked.parse(raw, { async: false })
  const html = typeof parsed === 'string' ? parsed : String(parsed)

  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
  })
}
