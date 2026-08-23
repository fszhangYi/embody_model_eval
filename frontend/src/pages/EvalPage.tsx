import { useEffect } from 'react'
import { Chart, registerables } from 'chart.js'
import evalShell from '../features/eval/evalShell.html?raw'
import { bootstrapEval } from '../features/eval/runEval'
import { PageNav } from '../components/PageNav'
import '../styles/eval.css'

Chart.register(...registerables)
;(globalThis as typeof globalThis & { Chart: typeof Chart }).Chart = Chart

export function EvalPage() {
  useEffect(() => {
    bootstrapEval().catch((err: Error) => {
      const sub = document.getElementById('subtitle')
      if (sub) sub.textContent = `加载失败: ${err.message}`
      console.error(err)
    })
  }, [])

  return (
    <div className="eval-page">
      <div dangerouslySetInnerHTML={{ __html: evalShell }} />
      <div className="eval-page-nav">
        <PageNav />
      </div>
    </div>
  )
}
