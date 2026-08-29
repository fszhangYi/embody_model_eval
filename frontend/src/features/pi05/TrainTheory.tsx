import { useState } from 'react'
import { t } from '../../i18n/runtime'
import type { Pi05RouteMode } from './routeMode'

const SECTIONS = [
  'overview',
  'condition',
  'expert',
  'flow',
  'norm',
  'adapt',
  'optim',
] as const

/** Collapsible detailed explanation of π0.5 training principles (step 3). */
export function Pi05TrainTheory({ route = 'full_ft' }: { route?: Pi05RouteMode }) {
  const [open, setOpen] = useState(false)
  const fullFt = route === 'full_ft'

  return (
    <section className="act-train-mem pi05-train-theory">
      <button
        type="button"
        className="act-train-mem-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="act-train-mem-title">{t('pi05.theory.title')}</span>
        <span className="act-train-mem-badges">
          <span className="act-train-mem-pill">{t('pi05.theory.pill.vla')}</span>
          <span className="act-train-mem-pill">{t('pi05.theory.pill.flow')}</span>
          {fullFt ? (
            <span className="act-train-mem-pill warn">{t('pi05.theory.pill.fullFt')}</span>
          ) : (
            <span className="act-train-mem-pill">{t('pi05.theory.pill.lora')}</span>
          )}
        </span>
        <span className="act-train-mem-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="act-train-mem-body pi05-train-theory-body">
          <p className="act-train-mem-lead muted">
            {fullFt ? t('pi05.theory.leadFullFt') : t('pi05.theory.leadSmoke')}
          </p>
          {SECTIONS.map((id) => (
            <div key={id} className="pi05-train-theory-sec">
              <h4>{t(`pi05.theory.${id}.title`)}</h4>
              <p className="pi05-train-theory-text">{t(`pi05.theory.${id}.body`)}</p>
            </div>
          ))}
          <p className="act-train-mem-foot muted">{t('pi05.theory.foot')}</p>
        </div>
      ) : null}
    </section>
  )
}
