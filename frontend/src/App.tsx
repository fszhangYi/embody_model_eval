import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { EvalPage } from './pages/EvalPage'
import { HubPage } from './pages/HubPage'
import { ChatPage } from './pages/ChatPage'
import { RobotsPage } from './pages/RobotsPage'
import { PipelinePage } from './pages/PipelinePage'
import { ActPipelinePage } from './pages/ActPipelinePage'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<EvalPage />} />
        <Route path="/hub" element={<HubPage />} />
        <Route path="/pipeline" element={<PipelinePage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/robots" element={<RobotsPage />} />
        <Route path="/act-pipeline" element={<ActPipelinePage />} />
        <Route path="/index.html" element={<Navigate to="/" replace />} />
        <Route path="/hub.html" element={<Navigate to="/hub" replace />} />
        <Route path="/pipeline.html" element={<Navigate to="/pipeline" replace />} />
        <Route path="/chat.html" element={<Navigate to="/chat" replace />} />
        <Route path="/robots.html" element={<Navigate to="/robots" replace />} />
        <Route path="/act-pipeline.html" element={<Navigate to="/act-pipeline" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}
