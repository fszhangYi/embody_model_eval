import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthContext'
import { RequireAuth } from './auth/RequireAuth'
import { EvalPage } from './pages/EvalPage'
import { HubPage } from './pages/HubPage'
import { ChatPage } from './pages/ChatPage'
import { RobotsPage } from './pages/RobotsPage'
import { PipelinePage } from './pages/PipelinePage'
import { ActPipelinePage } from './pages/ActPipelinePage'
import { SensorsPage } from './pages/SensorsPage'
import { LoginPage } from './pages/LoginPage'

function Protected({ children }: { children: ReactNode }) {
  return <RequireAuth>{children}</RequireAuth>
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route
            path="/"
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
            path="/sensors"
            element={
              <Protected>
                <SensorsPage />
              </Protected>
            }
          />
          <Route path="/index.html" element={<Navigate to="/" replace />} />
          <Route path="/hub.html" element={<Navigate to="/hub" replace />} />
          <Route path="/pipeline.html" element={<Navigate to="/pipeline" replace />} />
          <Route path="/chat.html" element={<Navigate to="/chat" replace />} />
          <Route path="/robots.html" element={<Navigate to="/robots" replace />} />
          <Route path="/act-pipeline.html" element={<Navigate to="/act-pipeline" replace />} />
          <Route path="/sensors.html" element={<Navigate to="/sensors" replace />} />
          <Route path="/login.html" element={<Navigate to="/login" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
