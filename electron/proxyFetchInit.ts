// The request the `proxy-fetch` handler (main.ts) sends for the renderer: the
// WebDAV sync reads and writes, and the other requests that go through the
// main process to avoid CORS.
//
// Every one of them is sent with the HTTP cache out of the way (#2409). The
// sync file is read to learn what the server holds NOW; Chromium's cache may
// answer a plain GET from an earlier response for as long as its heuristics
// call that response fresh, and a server that sends no validators makes that
// hours. A truncated sync file was served from it after the file on the server
// had been repaired, so sync stayed broken until the app's cache was cleared.
//
// Two layers, because they fail differently: `cache: 'no-store'` keeps this
// app's own cache out of it, and the `Cache-Control: no-cache` request header
// says the same to the network stack and to any proxy between here and the
// server. A caller's own Cache-Control is left as it is.

export interface ProxyFetchInit {
  method: string;
  headers: Record<string, string>;
  redirect: 'manual';
  cache: 'no-store';
  signal: AbortSignal;
  body?: string;
}

export function proxyFetchInit(
  method: string,
  headers: Record<string, string> | null | undefined,
  body: string | null | undefined,
  signal: AbortSignal,
): ProxyFetchInit {
  const sent: Record<string, string> = { ...(headers ?? {}) };
  const hasCacheControl = Object.keys(sent).some((name) => name.toLowerCase() === 'cache-control');
  if (!hasCacheControl) sent['Cache-Control'] = 'no-cache';
  return {
    method,
    headers: sent,
    redirect: 'manual',
    cache: 'no-store',
    signal,
    ...(body != null ? { body } : {}),
  };
}
