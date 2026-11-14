import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Renderer-free harness, as in useDayWindows.test.js: useState slots by call
// order (the hook calls it three times), one ref, effects skipped, callbacks
// bare.
let slots = [];
let idx = 0;
let ref = null;
vi.mock('react', () => ({
  useState: (init) => {
    const i = idx++;
    if (!(i in slots)) slots[i] = typeof init === 'function' ? init() : init;
    return [slots[i], (up) => { slots[i] = typeof up === 'function' ? up(slots[i]) : up; }];
  },
  useRef: (init) => (ref ??= { current: init }),
  useEffect: () => {},
  useCallback: (fn) => fn,
}));
vi.mock('../utils/trayMode.js', () => ({ isTrayMode: false }));
const storeWeatherCoords = vi.fn();
vi.mock('../utils/solar.js', () => ({ storeWeatherCoords: (...a) => storeWeatherCoords(...a) }));
vi.mock('../utils/localeFormatting.js', () => ({ formatLocalizedDate: () => 'Mon' }));
let nativeApp = false;
vi.mock('../native.js', () => ({ isNativeApp: () => nativeApp }));

const { default: useWeather } = await import('./useWeather.js');

const WEATHER_SLOT = 2; // zip, unit, weather

const forecastBody = {
  current: { temperature_2m: 61.2, weather_code: 0 },
  daily: {
    time: ['2026-09-21', '2026-09-22', '2026-09-23', '2026-09-24', '2026-09-25', '2026-09-26'],
    temperature_2m_max: [70, 71, 72, 73, 74, 75],
    temperature_2m_min: [50, 51, 52, 53, 54, 55],
    weather_code: [0, 1, 2, 3, 0, 1],
  },
  hourly: { time: ['2026-09-21T12:00'], temperature_2m: [65.4], weather_code: [0], uv_index: [6.1] },
};

describe('useWeather.fetchWeather: the location outlives the header toggle', () => {
  let store;
  let urls;

  beforeEach(() => {
    slots = []; idx = 0; ref = null;
    store = new Map();
    urls = [];
    storeWeatherCoords.mockClear();
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.fetch = vi.fn(async (url) => {
      urls.push(url);
      if (url.includes('zippopotam')) {
        return { ok: true, status: 200, json: async () => ({ places: [{ latitude: '39.7392', longitude: '-104.9903' }] }) };
      }
      if (url.includes('api.open-meteo.com/v1/forecast')) {
        return { ok: true, status: 200, json: async () => forecastBody };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
  });

  afterEach(() => {
    delete globalThis.localStorage;
    delete globalThis.fetch;
  });

  const useHook = () => { idx = 0; return useWeather(); };
  const forecastCalls = () => urls.filter((u) => u.includes('/v1/forecast'));

  it('header weather OFF: still geocodes and stores the coords, skips the forecast', async () => {
    store.set('day-planner-weather-enabled', 'false');
    store.set('day-planner-weather-zip', '80202');
    await useHook().fetchWeather();

    expect(storeWeatherCoords).toHaveBeenCalledWith({ lat: 39.7392, lon: -104.9903 });
    expect(forecastCalls()).toHaveLength(0);
    expect(slots[WEATHER_SLOT]).toBeNull();
  });

  it('header weather OFF on a native app: the forecast is fetched anyway (dial, widget and launcher read it)', async () => {
    nativeApp = true;
    try {
      store.set('day-planner-weather-enabled', 'false');
      store.set('day-planner-weather-zip', '80202');
      await useHook().fetchWeather();
      expect(forecastCalls()).toHaveLength(1);
      expect(slots[WEATHER_SLOT]?.hourlyByDate?.['2026-09-21']?.[12]?.temp).toBe(65);
    } finally {
      nativeApp = false;
    }
  });

  it('header weather ON (the default): geocodes and fetches the forecast', async () => {
    store.set('day-planner-weather-zip', '80202');
    await useHook().fetchWeather();

    expect(storeWeatherCoords).toHaveBeenCalledWith({ lat: 39.7392, lon: -104.9903 });
    expect(forecastCalls()).toHaveLength(1);
    expect(forecastCalls()[0]).toContain('temperature_unit=fahrenheit');
    expect(slots[WEATHER_SLOT]?.hourlyByDate?.['2026-09-21']?.[12]?.temp).toBe(65);
  });

  it('the unit setting reaches the forecast request', async () => {
    store.set('day-planner-weather-zip', '80202');
    store.set('day-planner-weather-temp-unit', 'celsius');
    await useHook().fetchWeather();
    expect(forecastCalls()[0]).toContain('temperature_unit=celsius');
  });

  it('no location: clears the coords and calls nothing', async () => {
    store.set('day-planner-weather-enabled', 'false');
    await useHook().fetchWeather();
    expect(storeWeatherCoords).toHaveBeenCalledWith(null);
    expect(urls).toHaveLength(0);
  });
});

// The desktop app stays open for days. A refresh that fails (the machine wakes
// before its network; a service has a bad minute) used to replace a good
// forecast with "--" for an hour, and a reload started from nothing.
describe('useWeather.fetchWeather: a failed refresh, and a reload', () => {
  let store;
  let urls;
  let respond; // (url) => response | throws
  let errorSpy;

  const ok = (body) => ({ ok: true, status: 200, json: async () => body });
  const answered = (status, body) => ({ ok: false, status, json: async () => body });
  const zipOk = () => ok({ places: [{ latitude: '39.7392', longitude: '-104.9903' }] });
  const offline = () => { throw new TypeError('Failed to fetch'); };
  const healthy = (url) => {
    if (url.includes('zippopotam')) return zipOk();
    if (url.includes('geocoding-api')) return ok({ results: [{ latitude: 52.52, longitude: 13.41, timezone: 'Europe/Berlin' }] });
    if (url.includes('/v1/forecast')) return ok(forecastBody);
    throw new Error(`unexpected fetch ${url}`);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 21, 9, 0, 0));
    slots = []; idx = 0; ref = null;
    store = new Map();
    urls = [];
    respond = healthy;
    storeWeatherCoords.mockClear();
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.localStorage = {
      getItem: (k) => (store.has(k) ? store.get(k) : null),
      setItem: (k, v) => store.set(k, String(v)),
      removeItem: (k) => store.delete(k),
    };
    globalThis.fetch = vi.fn(async (url) => { urls.push(url); return respond(url); });
    store.set('day-planner-weather-zip', '80202');
  });

  afterEach(() => {
    errorSpy.mockRestore();
    vi.useRealTimers();
    delete globalThis.localStorage;
    delete globalThis.fetch;
  });

  const useHook = () => { idx = 0; return useWeather(); };
  // A reload: React state is gone, localStorage is not.
  const useReloaded = () => { slots = []; ref = null; return useHook(); };
  const weather = () => slots[WEATHER_SLOT];
  const calls = (part) => urls.filter((u) => u.includes(part));

  it('a refresh that cannot reach the network keeps the forecast it could not replace', async () => {
    expect(await useHook().fetchWeather()).toBe('ok');
    const good = weather();
    expect(good.temp).toBe(61);

    vi.advanceTimersByTime(60 * 60 * 1000);
    respond = offline;
    expect(await useHook().fetchWeather()).toBe('failed');
    expect(weather()).toBe(good);
  });

  it('with nothing fresh to keep, a failed refresh says so and reports the failure', async () => {
    respond = offline;
    expect(await useHook().fetchWeather()).toBe('failed');
    expect(weather()).toMatchObject({ temp: '--', condition: 'Unable to load' });
  });

  it('a forecast is not kept past three hours, or into the next day', async () => {
    await useHook().fetchWeather();
    respond = offline;

    vi.advanceTimersByTime(3 * 60 * 60 * 1000 + 1);
    await useHook().fetchWeather();
    expect(weather().temp).toBe('--');

    // 23:30 → 00:30: an hour old, but its "today" is yesterday.
    vi.setSystemTime(new Date(2026, 8, 21, 23, 30, 0));
    respond = healthy;
    await useHook().fetchWeather();
    expect(weather().temp).toBe(61);
    vi.setSystemTime(new Date(2026, 8, 22, 0, 30, 0));
    respond = offline;
    await useHook().fetchWeather();
    expect(weather().temp).toBe('--');
  });

  it('a reload starts from the last good forecast instead of from nothing', async () => {
    await useHook().fetchWeather();
    vi.advanceTimersByTime(20 * 60 * 1000);
    useReloaded();
    expect(weather()?.temp).toBe(61);
    expect(weather()?.hourlyByDate?.['2026-09-21']?.[12]?.temp).toBe(65);
  });

  it('a reload does not start from a forecast for another location or unit', async () => {
    await useHook().fetchWeather();
    store.set('day-planner-weather-zip', '10001');
    useReloaded();
    expect(weather()).toBeNull();

    store.set('day-planner-weather-zip', '80202');
    store.set('day-planner-weather-temp-unit', 'celsius');
    useReloaded();
    expect(weather()).toBeNull();
  });

  it('a reload with the header weather off does not bring a forecast back', async () => {
    await useHook().fetchWeather();
    store.set('day-planner-weather-enabled', 'false');
    useReloaded();
    expect(weather()).toBeNull();
  });

  it('an error answer from the forecast is a failure, not silence', async () => {
    respond = (url) => (url.includes('/v1/forecast')
      ? answered(429, { error: true, reason: 'Minutely API request limit exceeded.' })
      : healthy(url));
    expect(await useHook().fetchWeather()).toBe('failed');
    expect(weather()).toMatchObject({ temp: '--', condition: 'Unable to load' });
    expect(String(errorSpy.mock.calls[0][1])).toContain('Minutely API request limit exceeded.');
  });

  it('a forecast answer that is not JSON is a failure', async () => {
    respond = (url) => (url.includes('/v1/forecast')
      ? { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token <'); } }
      : healthy(url));
    expect(await useHook().fetchWeather()).toBe('failed');
  });

  it('the location is resolved once: a refresh is the forecast request alone', async () => {
    await useHook().fetchWeather();
    await useHook().fetchWeather();
    expect(calls('zippopotam')).toHaveLength(1);
    expect(calls('/v1/forecast')).toHaveLength(2);
    // The dial's coords are stored either way.
    expect(storeWeatherCoords).toHaveBeenCalledTimes(2);
  });

  it('a geocoder that cannot be reached later does not blank a location already resolved', async () => {
    await useHook().fetchWeather();
    respond = (url) => (url.includes('/v1/forecast') ? ok(forecastBody) : offline());
    vi.advanceTimersByTime(60 * 60 * 1000);
    expect(await useHook().fetchWeather()).toBe('ok');
    expect(weather().temp).toBe(61);
  });

  it('a changed location is geocoded again', async () => {
    await useHook().fetchWeather();
    store.set('day-planner-weather-zip', 'Berlin');
    await useHook().fetchWeather();
    expect(calls('geocoding-api')).toHaveLength(1);
    expect(storeWeatherCoords).toHaveBeenLastCalledWith({ lat: 52.52, lon: 13.41 });
    expect(calls('/v1/forecast')[1]).toContain('timezone=Europe%2FBerlin');
  });

  it('no geocoder reachable is a failed request, not an unknown location', async () => {
    respond = offline;
    expect(await useHook().fetchWeather()).toBe('failed');
    expect(weather().condition).toBe('Unable to load');
    expect(storeWeatherCoords).not.toHaveBeenCalled();
  });

  it('a geocoder that answers with an error is a failed request, not an unknown location', async () => {
    store.set('day-planner-weather-zip', 'Berlin');
    respond = (url) => (url.includes('geocoding-api') ? answered(503, { error: true }) : healthy(url));
    expect(await useHook().fetchWeather()).toBe('failed');
    expect(weather().condition).toBe('Unable to load');
  });

  it('a place the geocoder does not know is "Location not found", and is not retried as a failure', async () => {
    store.set('day-planner-weather-zip', 'Nowhereville');
    respond = (url) => (url.includes('geocoding-api') ? ok({}) : healthy(url));
    expect(await useHook().fetchWeather()).toBe('idle');
    expect(weather().condition).toBe('Location not found');
  });

  it('a ZIP both services answered they do not know is "Location not found"', async () => {
    respond = (url) => {
      if (url.includes('zippopotam')) return answered(404, {});
      if (url.includes('geocoding-api')) return ok({});
      return healthy(url);
    };
    expect(await useHook().fetchWeather()).toBe('idle');
    expect(weather().condition).toBe('Location not found');
  });

  it('a ZIP the fallback cannot find while the ZIP service is down is a failure', async () => {
    respond = (url) => {
      if (url.includes('zippopotam')) return offline();
      if (url.includes('geocoding-api')) return ok({});
      return healthy(url);
    };
    expect(await useHook().fetchWeather()).toBe('failed');
    expect(weather().condition).toBe('Unable to load');
  });

  it('a ZIP resolved by the fallback while the ZIP service is down is used once, not remembered', async () => {
    respond = (url) => (url.includes('zippopotam') ? offline() : healthy(url));
    expect(await useHook().fetchWeather()).toBe('ok');
    expect(storeWeatherCoords).toHaveBeenLastCalledWith({ lat: 52.52, lon: 13.41 });

    respond = healthy;
    await useHook().fetchWeather();
    expect(storeWeatherCoords).toHaveBeenLastCalledWith({ lat: 39.7392, lon: -104.9903 });
    expect(calls('zippopotam')).toHaveLength(2);
  });

  it('a request that never answers is given up on, and counts as a failure', async () => {
    globalThis.fetch = vi.fn((url, init) => new Promise((_resolve, reject) => {
      urls.push(url);
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    const pending = useHook().fetchWeather();
    await vi.advanceTimersByTimeAsync(31000); // the ZIP service, then the fallback
    expect(await pending).toBe('failed');
    expect(weather().condition).toBe('Unable to load');
  });

  it('only the latest call writes state', async () => {
    let release;
    respond = (url) => (url.includes('/v1/forecast')
      ? new Promise((resolve) => { release = () => resolve(ok(forecastBody)); })
      : healthy(url));
    const first = useHook().fetchWeather();
    await vi.advanceTimersByTimeAsync(0);

    // The user clears the location while the first forecast is still out.
    store.set('day-planner-weather-zip', '');
    expect(await useHook().fetchWeather()).toBe('idle');
    release();
    expect(await first).toBe('superseded');
    expect(weather()).toBeNull();
  });

  it('clearing the location drops the kept forecast', async () => {
    await useHook().fetchWeather();
    store.set('day-planner-weather-zip', '');
    await useHook().fetchWeather();
    store.set('day-planner-weather-zip', '80202');
    useReloaded();
    expect(weather()).toBeNull();
  });
});
