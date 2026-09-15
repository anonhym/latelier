import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './fonts.css'
import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import '@mantine/spotlight/styles.css'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
