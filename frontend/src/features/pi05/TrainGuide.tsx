import { useState } from 'react'
import { t } from '../../i18n/runtime'
import type { Pi05RouteMode } from './routeMode'

/** Mode-aware tips: Tl full FT primary vs LoRA smoke secondary. */
export function Pi05TrainGuide({
  configName,
  printOnly,
  route = 'full_ft',
}: {
  configName?: string
  printOnly?: boolean
  route?: Pi05RouteMode
}) {
  const [open, setOpen] = useState(true)
  const fullFt = route === 'full_ft'
  const smoke = (configName || '').includes('smoke')
  const tonglu = (configName || '').includes('full_ft') || (configName || '').includes('tonglu')

  return (
    <section className="act-train-mem pi05-train-guide">
      <button
        type="button"
        className="act-train-mem-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <span className="act-train-mem-title">
          {fullFt ? t('pi05.guide.titleFullFt') : t('pi05.guide.title')}
        </span>
        <span className="act-train-mem-badges">
          {fullFt ? <span className="act-train-mem-pill warn">{t('pi05.guide.pillFullFt')}</span> : null}
          {fullFt ? <span className="act-train-mem-pill">{t('pi05.guide.pill8gpu')}</span> : null}
          {!fullFt && smoke ? <span className="act-train-mem-pill">{t('pi05.guide.pillSmoke')}</span> : null}
          {!fullFt ? <span className="act-train-mem-pill warn">{t('pi05.guide.pill32g')}</span> : null}
          {tonglu && fullFt ? <span className="act-train-mem-pill">{t('pi05.guide.pillTonglu')}</span> : null}
          {printOnly ? <span className="act-train-mem-pill">{t('pi05.guide.pillPrint')}</span> : null}
        </span>
        <span className="act-train-mem-chevron" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? (
        <div className="act-train-mem-body">
          <p className="act-train-mem-lead muted">
            {fullFt ? t('pi05.guide.leadFullFt') : t('pi05.guide.lead')}
          </p>
          <div className="act-train-mem-live">
            <h4>{t('pi05.guide.checklist')}</h4>
            <dl className="act-train-mem-stats">
              {fullFt ? (
                <>
                  <div>
                    <dt>{t('pi05.guide.row.adapt')}</dt>
                    <dd>{t('pi05.guide.row.adaptFull')}</dd>
                  </div>
                  <div>
                    <dt>{t('pi05.guide.row.batch')}</dt>
                    <dd>{t('pi05.guide.row.batchFull')}</dd>
                  </div>
                  <div>
                    <dt>{t('pi05.guide.row.base')}</dt>
                    <dd>{t('pi05.guide.row.basePytorch')}</dd>
                  </div>
                  <div>
                    <dt>{t('pi05.guide.row.hw')}</dt>
                    <dd className="warn">{t('pi05.guide.row.hwFull')}</dd>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <dt>{t('pi05.guide.row.lora')}</dt>
                    <dd>{t('pi05.guide.row.loraVal')}</dd>
                  </div>
                  <div>
                    <dt>{t('pi05.guide.row.batch')}</dt>
                    <dd className={smoke ? undefined : 'warn'}>{t('pi05.guide.row.batchVal')}</dd>
                  </div>
                  <div>
                    <dt>{t('pi05.guide.row.norm')}</dt>
                    <dd>{t('pi05.guide.row.normVal')}</dd>
                  </div>
                  <div>
                    <dt>{t('pi05.guide.row.cache')}</dt>
                    <dd>{t('pi05.guide.row.cacheVal')}</dd>
                  </div>
                </>
              )}
            </dl>
          </div>
          <p className="act-train-mem-foot muted">
            {fullFt ? t('pi05.guide.footFullFt') : t('pi05.guide.foot')}
          </p>
        </div>
      ) : null}
    </section>
  )
}
