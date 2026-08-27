/** Escape HTML special chars (plain text segments only). */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Turn Markdown-style inline `` `code` `` into `<code>…</code>`.
 * Other text is HTML-escaped.
 */
export function formatInlineCode(text: string): string {
  if (!text || !text.includes('`')) return escapeHtml(text)
  const parts = text.split('`')
  let out = ''
  for (let i = 0; i < parts.length; i++) {
    const chunk = escapeHtml(parts[i])
    if (i % 2 === 1) out += `<code>${chunk}</code>`
    else out += chunk
  }
  return out
}
