import type { ReactNode } from 'react'

export function VectorGroupCollapse({
  title,
  subtitle,
  badge,
  defaultOpen = false,
  highlight = false,
  children,
}: {
  title: string
  subtitle?: ReactNode
  badge?: ReactNode
  defaultOpen?: boolean
  highlight?: boolean
  children: ReactNode
}) {
  return (
    <details
      className={`ma-vector-collapse card${highlight ? ' highlight' : ''}`}
      open={defaultOpen || undefined}
    >
      <summary className="ma-vector-collapse-head">
        <span className="ma-vector-collapse-chevron" aria-hidden="true" />
        <span className="ma-vector-collapse-titles">
          <span className="ma-vector-collapse-title">{title}</span>
          {subtitle ? <span className="ma-vector-collapse-sub">{subtitle}</span> : null}
        </span>
        {badge ? <span className="ma-vector-collapse-badge">{badge}</span> : null}
      </summary>
      <div className="ma-vector-collapse-body">{children}</div>
    </details>
  )
}
