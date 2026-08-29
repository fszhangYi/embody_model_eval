import { useEffect, useId, useState } from 'react'
import { t } from '../../i18n/runtime'
import type { Pi05ModelStructure, Pi05StructureNode, Pi05WeightStructure } from './api'

const ROLE_CLASS: Record<string, string> = {
  input: 'in',
  vision: 'vision',
  embed: 'embed',
  backbone: 'backbone',
  expert: 'expert',
  output: 'out',
}

/** Map structure node → weight module id when available. */
const NODE_WEIGHT: Record<string, string> = {
  paligemma: 'paligemma',
  siglip: 'paligemma',
  expert: 'gemma_expert',
  actions: 'action_proj',
}

function byColumn(nodes: Pi05StructureNode[]) {
  const map = new Map<number, Pi05StructureNode[]>()
  for (const n of nodes) {
    const col = n.column ?? 0
    const list = map.get(col) || []
    list.push(n)
    map.set(col, list)
  }
  for (const list of map.values()) {
    list.sort((a, b) => (a.row ?? 0) - (b.row ?? 0))
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0])
}

function formatElems(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`
  return String(n)
}

function NodeDetailPanel({
  node,
  weights,
  onClose,
}: {
  node: Pi05StructureNode
  weights?: Pi05WeightStructure | null
  onClose: () => void
}) {
  const titleId = useId()
  const bodyKey = `pi05Analysis.node.${node.id}.body`
  const roleKey = `pi05Analysis.role.${node.role}`
  const body = t(bodyKey)
  const roleLabel = t(roleKey)
  const weightId = NODE_WEIGHT[node.id]
  const weightMod = weights?.modules?.find((m) => m.id === weightId)
  const v = node.variant

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="pi05a-node-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      <button type="button" className="pi05a-node-sheet-backdrop" aria-label={t('pi05Analysis.detailClose')} onClick={onClose} />
      <div className="pi05a-node-sheet-panel">
        <header className="pi05a-node-sheet-head">
          <div>
            <p className="pi05a-kicker">{roleLabel !== roleKey ? roleLabel : node.role}</p>
            <h3 id={titleId}>{node.label}</h3>
          </div>
          <button type="button" className="pi05a-btn" onClick={onClose}>
            {t('pi05Analysis.detailClose')}
          </button>
        </header>

        <div className="pi05a-node-sheet-body">
          {node.detail ? <p className="pi05a-node-sheet-lead">{node.detail}</p> : null}

          <p className="pi05a-node-sheet-text">
            {body !== bodyKey ? body : t('pi05Analysis.node.fallback')}
          </p>

          {node.tags?.filter(Boolean).length ? (
            <div className="pi05a-struct-tags sheet">
              {node.tags.filter(Boolean).map((tag) => (
                <span key={tag}>{tag}</span>
              ))}
            </div>
          ) : null}

          {v ? (
            <dl className="pi05a-node-kv">
              <div>
                <dt>{t('pi05Analysis.detail.variant')}</dt>
                <dd>{v.variant || v.short || '—'}</dd>
              </div>
              <div>
                <dt>{t('pi05Analysis.detail.params')}</dt>
                <dd>{v.approxParams || '—'}</dd>
              </div>
              <div>
                <dt>{t('pi05Analysis.detail.width')}</dt>
                <dd>{v.width ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('pi05Analysis.detail.depth')}</dt>
                <dd>{v.depth ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('pi05Analysis.detail.mlp')}</dt>
                <dd>{v.mlpDim ?? '—'}</dd>
              </div>
              <div>
                <dt>{t('pi05Analysis.detail.lora')}</dt>
                <dd>
                  {v.lora
                    ? `${t('pi05Analysis.detail.loraYes')}${v.loraRank != null ? ` · rank ${v.loraRank}` : ''}`
                    : t('pi05Analysis.detail.loraNo')}
                </dd>
              </div>
            </dl>
          ) : null}

          {weightMod ? (
            <div className="pi05a-node-weight">
              <h4>{t('pi05Analysis.detail.weightMatch')}</h4>
              <p>
                {weightMod.label} · {weightMod.params} tensors · {formatElems(weightMod.elements)}
              </p>
              {weightMod.children?.length ? (
                <ul>
                  {weightMod.children.map((c) => (
                    <li key={c.id}>
                      <span>{c.label}</span>
                      <code>
                        {c.params} · {formatElems(c.elements)}
                      </code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function Pi05ModelStructureView({
  structure,
  title,
  empty,
  weights,
}: {
  structure: Pi05ModelStructure | null | undefined
  title: string
  empty: string
  weights?: Pi05WeightStructure | null
}) {
  const [detail, setDetail] = useState<Pi05StructureNode | null>(null)

  if (!structure?.nodes?.length) {
    return <div className="pi05a-struct-empty muted">{empty}</div>
  }

  const columns = byColumn(structure.nodes)
  const meta = structure.meta
  const pg = meta?.paligemma
  const ex = meta?.actionExpert

  return (
    <div className="pi05a-struct">
      <div className="pi05a-struct-top">
        <div>
          <h3 className="pi05a-struct-title">{title}</h3>
          <p className="pi05a-struct-lead">
            π0.5 · {pg?.short || 'PaliGemma'} → {ex?.short || 'Action Expert'}
            {meta?.actionHorizon != null ? ` · H=${meta.actionHorizon}` : ''}
          </p>
          <p className="pi05a-struct-hint muted">{t('pi05Analysis.structureHint')}</p>
        </div>
        <div className="pi05a-struct-badges">
          {pg ? (
            <span className={`pi05a-badge${pg.lora ? ' lora' : ''}`}>VLM {pg.approxParams}</span>
          ) : null}
          {ex ? (
            <span className={`pi05a-badge${ex.lora ? ' lora' : ''}`}>Expert {ex.approxParams}</span>
          ) : null}
          {meta?.cameras?.length ? (
            <span className="pi05a-badge quiet">{meta.cameras.join(' · ')}</span>
          ) : null}
        </div>
      </div>

      <div className="pi05a-struct-flow" role="list" aria-label={title}>
        {columns.map(([col, nodes], colIdx) => (
          <div key={col} className="pi05a-struct-col">
            <div className="pi05a-struct-stack">
              {nodes.map((node) => (
                <button
                  key={node.id}
                  type="button"
                  role="listitem"
                  className={`pi05a-struct-node role-${ROLE_CLASS[node.role] || 'other'}${
                    detail?.id === node.id ? ' focused' : ''
                  }`}
                  title={t('pi05Analysis.structureHint')}
                  onDoubleClick={() => setDetail(node)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) setDetail(node)
                  }}
                >
                  <div className="pi05a-struct-node-label">{node.label}</div>
                  {node.detail ? <div className="pi05a-struct-node-detail">{node.detail}</div> : null}
                  {node.tags?.length ? (
                    <div className="pi05a-struct-tags">
                      {node.tags.filter(Boolean).map((tag) => (
                        <span key={tag}>{tag}</span>
                      ))}
                    </div>
                  ) : null}
                </button>
              ))}
            </div>
            {colIdx < columns.length - 1 ? (
              <div className="pi05a-struct-arrow" aria-hidden="true">
                <span />
              </div>
            ) : null}
          </div>
        ))}
      </div>

      <div className="pi05a-struct-meta">
        <span>
          width {pg?.width ?? '—'} / {ex?.width ?? '—'}
        </span>
        <span className="dot">·</span>
        <span>
          depth {pg?.depth ?? '—'} / {ex?.depth ?? '—'}
        </span>
        {meta?.maxTokenLen != null ? (
          <>
            <span className="dot">·</span>
            <span>max_token {meta.maxTokenLen}</span>
          </>
        ) : null}
        {meta?.discreteStateInput != null ? (
          <>
            <span className="dot">·</span>
            <span>{meta.discreteStateInput ? 'discrete state' : 'continuous state'}</span>
          </>
        ) : null}
      </div>

      {detail ? <NodeDetailPanel node={detail} weights={weights} onClose={() => setDetail(null)} /> : null}
    </div>
  )
}
