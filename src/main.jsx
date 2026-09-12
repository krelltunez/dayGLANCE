import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import i18n, { ready as i18nReady } from './i18n.js'
import { buildApplicationMenuLabels } from './utils/applicationMenuLabels.js'

function syncApplicationMenuLabels() {
  const setLabels = window.electronAPI?.setApplicationMenuLabels
  if (!setLabels) return
  setLabels(buildApplicationMenuLabels(i18n.t.bind(i18n)))
}

// crypto.randomUUID() requires a secure context (HTTPS or localhost).
// When accessed over HTTP on a LAN IP the API is absent and every call throws,
// silently breaking any action that creates a new task/id.
// crypto.getRandomValues() has no such restriction and is safe to use here.
if (typeof crypto.randomUUID !== 'function') {
  crypto.randomUUID = () => {
    const b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    return [b.slice(0,4),b.slice(4,6),b.slice(6,8),b.slice(8,10),b.slice(10,16)]
      .map(s => Array.from(s).map(x => x.toString(16).padStart(2,'0')).join('')).join('-');
  };
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    console.error('Day Planner crashed:', error, errorInfo)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          padding: '2rem',
          textAlign: 'center',
          background: '#f5f5f4',
          color: '#1c1917',
        }}>
          <div style={{ fontSize: '3rem', marginBottom: '1rem' }}>:(</div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '0.5rem' }}>
            Something went wrong
          </h1>
          <p style={{ color: '#78716c', marginBottom: '1.5rem', maxWidth: '24rem' }}>
            The app ran into an unexpected error. Your data is safe in local storage.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '0.625rem 1.5rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              color: '#fff',
              background: '#2563eb',
              border: 'none',
              borderRadius: '0.5rem',
              cursor: 'pointer',
            }}
          >
            Reload app
          </button>
        </div>
      )
    }

    return this.props.children
  }
}

// ── TEMPORARY: month view step 2 dev harness ────────────────────────────────
// Renders components/month/MonthCellDevHarness.jsx INSTEAD of the app when
// asked for explicitly: `?month-cells` in the URL, or localStorage
// 'day-planner-dev-month-cells' = '1' (the only route on a device build, where
// the URL is fixed). Lazy, so the main bundle carries only this gate. Delete
// this block and the harness file once the month grid (step 3) renders real
// cells.
const monthCellsDevRequested = (() => {
  try {
    return new URLSearchParams(window.location.search).has('month-cells')
      || window.localStorage.getItem('day-planner-dev-month-cells') === '1'
  } catch {
    return false
  }
})()
const MonthCellDevHarness = monthCellsDevRequested
  ? React.lazy(() => import('./components/month/MonthCellDevHarness.jsx'))
  : null
// ── end TEMPORARY ────────────────────────────────────────────────────────────

function mount() {
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        {MonthCellDevHarness
          ? <React.Suspense fallback={null}><MonthCellDevHarness /></React.Suspense>
          : <App />}
      </ErrorBoundary>
    </React.StrictMode>,
  )
}

function start() {
  syncApplicationMenuLabels()
  i18n.on('languageChanged', syncApplicationMenuLabels)
  mount()
}

// The active language is its own chunk now, so wait for it before the first
// paint — otherwise a non-English user watches the UI render in English and
// then swap. A failed fetch still mounts: i18next falls back to bundled en,
// and a missing translation is a better outcome than a blank screen.
i18nReady.then(start, (error) => {
  console.error('Translations failed to load; continuing in English:', error)
  start()
})
