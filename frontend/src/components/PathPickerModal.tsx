import { useCallback, useEffect, useState } from 'react'
import { fetchFsChildren, type FsEntry } from '../features/actPipeline/api'
import type { BrowseRoot, PathKind } from '../features/actPipeline/types'
import { t } from '../i18n/runtime'

export interface PathPickerModalProps {
  open: boolean
  title: string
  value: string
  browseRoot: BrowseRoot
  roots: Record<BrowseRoot, string>
  pathKind: PathKind
  browseAnchor?: string
  onClose: () => void
  onConfirm: (path: string) => void
}

function relParts(root: string, absPath: string): string[] {
  const r = root.replace(/\/+$/, '')
  const p = absPath.replace(/\/+$/, '')
  if (!p || p === r) return []
  if (!p.startsWith(r + '/') && p !== r) return []
  return p.slice(r.length + 1).split('/').filter(Boolean)
}

async function buildColumns(
  rootKey: BrowseRoot,
  root: string,
  targetPath: string,
): Promise<{ columns: FsEntry[][]; selectedPath: string }> {
  const rootRes = await fetchFsChildren(rootKey, root, root)
  const columns: FsEntry[][] = [rootRes.entries]
  let selectedPath = rootRes.path
  const parts = relParts(root, targetPath)

  for (const part of parts) {
    const parentCol = columns[columns.length - 1]
    const hit = parentCol.find((e) => e.name === part && e.isDir)
    if (!hit) break
    const childRes = await fetchFsChildren(rootKey, hit.path, root)
    columns.push(childRes.entries)
    selectedPath = childRes.path
  }

  if (targetPath && targetPath.startsWith(root)) {
    selectedPath = targetPath
  }
  return { columns, selectedPath }
}

export function PathPickerModal({
  open,
  title,
  value,
  browseRoot,
  roots,
  pathKind,
  browseAnchor,
  onClose,
  onConfirm,
}: PathPickerModalProps) {
  const rootPath = browseAnchor || roots[browseRoot] || roots.act
  const [columns, setColumns] = useState<FsEntry[][]>([])
  const [activePath, setActivePath] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')

  const init = useCallback(async () => {
    setLoading(true)
    setErr('')
    try {
      const seed = value || rootPath
      const { columns: cols, selectedPath } = await buildColumns(browseRoot, rootPath, seed)
      setColumns(cols)
      setActivePath(selectedPath)
      setDraft(value || selectedPath)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setColumns([])
      setActivePath(rootPath)
      setDraft(value || rootPath)
    } finally {
      setLoading(false)
    }
  }, [browseRoot, rootPath, value])

  useEffect(() => {
    if (open) void init()
  }, [open, init])

  const onPickEntry = async (colIndex: number, entry: FsEntry) => {
    setErr('')
    const nextCols = columns.slice(0, colIndex + 1)
    setActivePath(entry.path)
    setDraft(entry.path)

    if (entry.isDir) {
      try {
        const res = await fetchFsChildren(browseRoot, entry.path, rootPath)
        nextCols.push(res.entries)
        setColumns(nextCols)
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
        setColumns(nextCols)
      }
      return
    }

    if (pathKind === 'file') {
      setColumns(nextCols)
    }
  }

  const onConfirmClick = () => {
    onConfirm(draft.trim())
    onClose()
  }

  if (!open) return null

  return (
    <div className="path-picker-overlay" role="presentation" onClick={onClose}>
      <div
        className="path-picker-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="path-picker-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="path-picker-head">
          <h3 id="path-picker-title">{title}</h3>
          <button type="button" className="path-picker-close" onClick={onClose} aria-label={t("pathPicker.closeAria")}>
            ×
          </button>
        </header>

        <div className="path-picker-root">
          {t("pathPicker.root")}<code>{rootPath}</code>
        </div>

        {err ? <div className="path-picker-err">{err}</div> : null}

        <div className="path-picker-cascade" aria-label={t("pathPicker.cascade")}>
          {loading && columns.length === 0 ? (
            <div className="path-picker-loading">{t("pathPicker.loading")}</div>
          ) : (
            columns.map((col, colIndex) => (
              <ul key={colIndex} className="path-picker-col">
                {col.map((entry) => {
                  const active = entry.path === activePath || draft === entry.path
                  return (
                    <li key={entry.path}>
                      <button
                        type="button"
                        className={`path-picker-item${active ? ' active' : ''}${entry.isDir ? ' dir' : ' file'}`}
                        onClick={() => void onPickEntry(colIndex, entry)}
                      >
                        <span className="path-picker-icon">{entry.isDir ? '📁' : '📄'}</span>
                        <span className="path-picker-name">{entry.name}</span>
                      </button>
                    </li>
                  )
                })}
              </ul>
            ))
          )}
        </div>

        <label className="path-picker-edit">
          <span>{t("pathPicker.pathEdit")}</span>
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={pathKind === 'dir' ? t('pathPicker.dirPlaceholder') : t('pathPicker.filePlaceholder')}
          />
        </label>

        <footer className="path-picker-foot">
          <button type="button" className="path-picker-btn ghost" onClick={onClose}>
            {t("pathPicker.cancel")}
          </button>
          <button type="button" className="path-picker-btn primary" onClick={onConfirmClick}>
            {t("pathPicker.confirm")}
          </button>
        </footer>
      </div>
    </div>
  )
}
