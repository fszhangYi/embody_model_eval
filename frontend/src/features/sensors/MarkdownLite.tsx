import type { ReactNode } from 'react'

/** 轻量 Markdown 渲染（构建说明页，无额外依赖）。 */
export function MarkdownLite({ source }: { source: string }) {
  const blocks = parseBlocks(source)
  return (
    <div className="sensors-md">
      {blocks.map((b, i) => renderBlock(b, i))}
    </div>
  )
}

type Block =
  | { type: 'h3'; text: string }
  | { type: 'h4'; text: string }
  | { type: 'p'; text: string }
  | { type: 'ul'; items: string[] }
  | { type: 'ol'; items: string[] }
  | { type: 'code'; text: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | { type: 'hr' }

function parseBlocks(md: string): Block[] {
  const lines = md.split('\n')
  const out: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (line.trim() === '---') {
      out.push({ type: 'hr' })
      i += 1
      continue
    }
    if (line.startsWith('### ')) {
      out.push({ type: 'h3', text: line.slice(4).trim() })
      i += 1
      continue
    }
    if (line.startsWith('#### ')) {
      out.push({ type: 'h4', text: line.slice(5).trim() })
      i += 1
      continue
    }
    if (line.startsWith('```')) {
      const buf: string[] = []
      i += 1
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i])
        i += 1
      }
      if (i < lines.length) i += 1
      out.push({ type: 'code', text: buf.join('\n') })
      continue
    }
    if (line.startsWith('|') && line.includes('|')) {
      const tableLines: string[] = []
      while (i < lines.length && lines[i].startsWith('|')) {
        tableLines.push(lines[i])
        i += 1
      }
      const rows = tableLines
        .filter((l) => !reSeparator.test(l))
        .map((l) =>
          l
            .split('|')
            .slice(1, -1)
            .map((c) => c.trim()),
        )
      if (rows.length >= 1) {
        out.push({ type: 'table', headers: rows[0], rows: rows.slice(1) })
      }
      continue
    }
    if (/^[-*]\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^[-*]\s/.test(lines[i])) {
        items.push(lines[i].replace(/^[-*]\s+/, '').trim())
        i += 1
      }
      out.push({ type: 'ul', items })
      continue
    }
    if (/^\d+\.\s/.test(line)) {
      const items: string[] = []
      while (i < lines.length && /^\d+\.\s/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, '').trim())
        i += 1
      }
      out.push({ type: 'ol', items })
      continue
    }
    if (line.trim() === '') {
      i += 1
      continue
    }
    const para: string[] = [line]
    i += 1
    while (i < lines.length && lines[i].trim() !== '' && !isBlockStart(lines[i])) {
      para.push(lines[i])
      i += 1
    }
    out.push({ type: 'p', text: para.join('\n') })
  }
  return out
}

const reSeparator = /^\|[\s\-:|]+\|$/

function isBlockStart(line: string): boolean {
  return (
    line.startsWith('#') ||
    line.startsWith('```') ||
    line.startsWith('|') ||
    /^[-*]\s/.test(line) ||
    /^\d+\.\s/.test(line) ||
    line.trim() === '---'
  )
}

function inline(text: string): ReactNode {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((p, i) => {
    if (p.startsWith('`') && p.endsWith('`')) {
      return <code key={i}>{p.slice(1, -1)}</code>
    }
    if (p.startsWith('**') && p.endsWith('**')) {
      return <strong key={i}>{p.slice(2, -2)}</strong>
    }
    return <span key={i}>{p}</span>
  })
}

function renderBlock(block: Block, key: number): ReactNode {
  switch (block.type) {
    case 'h3':
      return <h4 className="sensors-md-h3" key={key}>{block.text}</h4>
    case 'h4':
      return <h5 className="sensors-md-h4" key={key}>{block.text}</h5>
    case 'p':
      return (
        <p className="sensors-md-p" key={key}>
          {inline(block.text)}
        </p>
      )
    case 'ul':
      return (
        <ul className="sensors-md-ul" key={key}>
          {block.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ul>
      )
    case 'ol':
      return (
        <ol className="sensors-md-ol" key={key}>
          {block.items.map((it, j) => (
            <li key={j}>{inline(it)}</li>
          ))}
        </ol>
      )
    case 'code':
      return (
        <pre className="sensors-md-pre" key={key}>
          <code>{block.text}</code>
        </pre>
      )
    case 'table':
      return (
        <div className="sensors-md-table-wrap" key={key}>
          <table className="sensors-md-table">
            <thead>
              <tr>
                {block.headers.map((h) => (
                  <th key={h}>{inline(h)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((cell, ci) => (
                    <td key={ci}>{inline(cell)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case 'hr':
      return <hr className="sensors-md-hr" key={key} />
    default:
      return null
  }
}
