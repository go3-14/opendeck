import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './site.css'
import { Site } from './Site'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Site />
  </StrictMode>,
)
