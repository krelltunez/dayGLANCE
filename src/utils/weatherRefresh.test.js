import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  startWeatherRefresh, retryDelay, REFRESH_INTERVAL_MS, RETRY_BASE_MS, RETURN_STALE_MS, RETURN_RETRY_MIN_MS,
} from './weatherRefresh.js';

const emitter = () => {
  const handlers = new Map();
  return {
    addEventListener: (type, fn) => { handlers.set(type, [...(handlers.get(type) ?? []), fn]); },
    removeEventListener: (type, fn) => { handlers.set(type, (handlers.get(type) ?? []).filter((f) => f !== fn)); },
    emit: (type) => { for (const fn of handlers.get(type) ?? []) fn(); },
    count: (type) => (handlers.get(type) ?? []).length,
  };
};

describe('retryDelay', () => {
  it('doubles from the base and never exceeds the hourly cadence', () => {
    expect(retryDelay(1)).toBe(RETRY_BASE_MS);
    expect(retryDelay(2)).toBe(RETRY_BASE_MS * 2);
    expect(retryDelay(4)).toBe(RETRY_BASE_MS * 8);
    expect(retryDelay(50)).toBe(REFRESH_INTERVAL_MS);
  });
});

describe('startWeatherRefresh', () => {
  let target;
  let doc;
  let outcome;
  let fetchWeather;
  let stop;

  beforeEach(() => {
    vi.useFakeTimers();
    target = emitter();
    doc = Object.assign(emitter(), { visibilityState: 'visible' });
    outcome = 'ok';
    fetchWeather = vi.fn(async () => outcome);
    stop = null;
  });

  afterEach(() => {
    stop?.();
    vi.useRealTimers();
  });

  const start = () => { stop = startWeatherRefresh({ fetchWeather, target, doc }); };
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('fetches at start, then hourly', async () => {
    start();
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });

  it('a failure is retried in seconds, backing off, and a success returns to hourly', async () => {
    outcome = 'failed';
    start();
    await settle();
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 2 - 1);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
    outcome = 'ok';
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchWeather).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1);
    expect(fetchWeather).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchWeather).toHaveBeenCalledTimes(4);
  });

  it('a fetch that throws is a failure, not the end of the schedule', async () => {
    fetchWeather.mockImplementationOnce(async () => { throw new Error('boom'); });
    start();
    await settle();
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });

  it('the network coming back retries at once while failing, and does nothing otherwise', async () => {
    start();
    await settle();
    target.emit('online');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(1);

    outcome = 'failed';
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(fetchWeather).toHaveBeenCalledTimes(2);
    outcome = 'ok';
    target.emit('online');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(3);
    // The retry that was pending is replaced, not left to fire as well.
    await vi.advanceTimersByTimeAsync(RETRY_BASE_MS * 4);
    expect(fetchWeather).toHaveBeenCalledTimes(3);
  });

  it('coming back to the app refreshes a forecast that has gone stale, not a recent one', async () => {
    start();
    await settle();
    await vi.advanceTimersByTimeAsync(RETURN_STALE_MS - 1);
    target.emit('focus');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    target.emit('focus');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(RETURN_STALE_MS);
    doc.emit('visibilitychange');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(3);
  });

  it('a wake the hourly timer slept through is caught on return', async () => {
    let clock = 0;
    stop = startWeatherRefresh({ fetchWeather, target, doc, now: () => clock });
    await settle();
    clock += 8 * 60 * 60 * 1000; // asleep: the wall clock moved, the timer did not
    target.emit('focus');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });

  it('while failing, coming back retries, but not more than once every few seconds', async () => {
    outcome = 'failed';
    start();
    await settle();
    target.emit('focus');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(RETURN_RETRY_MIN_MS);
    target.emit('focus');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(2);
  });

  it('a window being hidden is not a return', async () => {
    start();
    await settle();
    await vi.advanceTimersByTimeAsync(RETURN_STALE_MS);
    doc.visibilityState = 'hidden';
    doc.emit('visibilitychange');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(1);
  });

  it('never runs two fetches at once', async () => {
    let release;
    fetchWeather.mockImplementation(() => new Promise((resolve) => { release = () => resolve('failed'); }));
    start();
    await vi.advanceTimersByTimeAsync(RETURN_STALE_MS);
    target.emit('focus');
    target.emit('online');
    await settle();
    expect(fetchWeather).toHaveBeenCalledTimes(1);
    release();
  });

  it('stop cancels the timer and removes every listener', async () => {
    start();
    await settle();
    stop();
    expect(target.count('focus') + target.count('online') + doc.count('visibilitychange')).toBe(0);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    expect(fetchWeather).toHaveBeenCalledTimes(1);
  });

  it('a fetch that finishes after stop schedules nothing', async () => {
    let release;
    fetchWeather.mockImplementation(() => new Promise((resolve) => { release = () => resolve('ok'); }));
    start();
    stop();
    release();
    await settle();
    expect(vi.getTimerCount()).toBe(0);
  });
});
