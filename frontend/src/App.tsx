import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { LocaleProvider } from './i18n/LocaleContext'
import { AppearanceProvider } from './prefs/AppearanceContext'
import { HomePage } from './pages/HomePage'
import { EvalPage } from './pages/EvalPage'
import { HubPage } from './pages/HubPage'
import { ChatPage } from './pages/ChatPage'
import { RobotsPage } from './pages/RobotsPage'
import { PipelinePage } from './pages/PipelinePage'
import { ActPipelinePage } from './pages/ActPipelinePage'
import { ModelAnalysisPage } from './pages/ModelAnalysisPage'
import { SensorsPage } from './pages/SensorsPage'
import { LoginPage } from './pages/LoginPage'

function Protected({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>
}

/** Preserve query string when redirecting legacy eval URLs. */
function RedirectEvalLegacy() {
  const { search } = useLocation()
  return <Navigate to={{ pathname: '/eval', search }} replace />
}

/** Old bookmarks used `/?data=...` for eval; send those to /eval. */
function HomeOrEvalRedirect() {
  const { search } = useLocation()
  if (search && /(?:^|[?&])data=/.test(search)) {
    return <Navigate to={{ pathname: '/eval', search }} replace />
  }
  return (
    <Protected>
      <HomePage />
    </Protected>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <LocaleProvider>
        <AppearanceProvider>
        <AuthProvider>
          <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<HomeOrEvalRedirect />} />
          <Route
            path="/eval"
            element={
              <Protected>
                <EvalPage />
              </Protected>
            }
          />
          <Route
            path="/hub"
            element={
              <Protected>
                <HubPage />
              </Protected>
            }
          />
          <Route
            path="/pipeline"
            element={
              <Protected>
                <PipelinePage />
              </Protected>
            }
          />
          <Route
            path="/chat"
            element={
              <Protected>
                <ChatPage />
              </Protected>
            }
          />
          <Route
            path="/robots"
            element={
              <Protected>
                <RobotsPage />
              </Protected>
            }
          />
          <Route
            path="/act-pipeline"
            element={
              <Protected>
                <ActPipelinePage />
              </Protected>
            }
          />
          <Route
            path="/model-analysis"
            element={
              <Protected>
                <ModelAnalysisPage />
              </Protected>
            }
          />
          <Route
            path="/sensors"
            element={
              <Protected>
                <SensorsPage />
              </Protected>
            }
          />
          <Route path="/index.html" element={<RedirectEvalLegacy />} />
          <Route path="/hub.html" element={<Navigate to="/hub" replace />} />
          <Route path="/pipeline.html" element={<Navigate to="/pipeline" replace />} />
          <Route path="/chat.html" element={<Navigate to="/chat" replace />} />
          <Route path="/robots.html" element={<Navigate to="/robots" replace />} />
          <Route path="/act-pipeline.html" element={<Navigate to="/act-pipeline" replace />} />
          <Route path="/model-analysis.html" element={<Navigate to="/model-analysis" replace />} />
          <Route path="/sensors.html" element={<Navigate to="/sensors" replace />} />
          <Route path="/login.html" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AuthProvider>
        </AppearanceProvider>
      </LocaleProvider>
    </BrowserRouter>
  )
}
