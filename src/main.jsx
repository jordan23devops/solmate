import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { initCesiumIon } from './cesium/init'
import './index.css'
import App from './App.jsx'

initCesiumIon()

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
