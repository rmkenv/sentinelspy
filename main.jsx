import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import SentinelSRViewer from './SentinelSRViewer'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <SentinelSRViewer />
  </StrictMode>
)
