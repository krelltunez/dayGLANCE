import React from 'react'
import ReactDOM from 'react-dom/client'
import './index.css'
import { isHeadlessRefresh } from './headless/headlessMode.js'
import i18n, { ready as i18nReady } from './i18n.js'
import { buildApplicationMenuLabels } from './utils/applicationMenuLabels.js'
import { installSubtleDigestShim } from './utils/sha256.js'
import { markMilestone, startLongTaskObserver } from './utils/perfTrace.js'

// The responsiveness trace (utils/perfTrace.js): watch for long tasks from
// here, the buffered ones from before included, and note when the bundle ran.
startLongTaskObserver()
markMilestone('bundle')

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

// crypto.subtle is gone in the same insecure contexts. The GLANCE integration
// hashes on every inbound create (createKey in @glance-apps/intents, then
// deterministicTaskId), so without it a chore from lastGLANCE lands in the
// activity log as "Cannot read properties of undefined (reading 'digest')"
// (#1968). The shim provides a SHA-256 digest that is bit-identical to
// WebCrypto's, so the ids it derives match a secure-context device's; nothing
// else (encryption, key derivation) is pretended. No-op when WebCrypto exists.
installSubtleDigestShim();

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

// The root is imported, not statically, so that each one's module graph is
// loaded only in its own mode: the headless refresh (src/headless/, an
// Activity-less WebView the Android shell runs for the launcher) must not
// evaluate App's modules, and the app does not carry the headless root.
async function mount() {
  const headless = isHeadlessRefresh()
  const { default: Root } = headless
    ? await import('./headless/HeadlessRefresh.jsx')
    : await import('./App.jsx')
  ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
      <ErrorBoundary>
        <Root />
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
