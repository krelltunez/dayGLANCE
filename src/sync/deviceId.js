// Stable per-device id that scopes the GLANCEvault cursor server-side (mirrors
// lastGLANCE src/sync/deviceId.ts). The engine owns the high-water mark; this is
// the only piece the app persists for the DB transport.

const DEVICE_ID_KEY = 'dayglance-device-id';

export function getDeviceId() {
  let id = null;
  try {
    id = localStorage.getItem(DEVICE_ID_KEY);
  } catch { /* storage unavailable */ }
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    try { localStorage.setItem(DEVICE_ID_KEY, id); } catch { /* ignore */ }
  }
  return id;
}

export { DEVICE_ID_KEY };
