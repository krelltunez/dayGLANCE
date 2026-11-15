# How large the sync file can get

WebDAV and Nextcloud sync keep all of your data in one file,
`dayglance-sync.json`. Every upload sends that file whole, and every download
fetches it whole. On some setups, a proxy sits between the app and your server,
and that proxy decides how large the file may be. This page lists each setup's
limit and what the app does when the file goes over it (#2142).

Most people never get close to a limit. The file is a little over 300 bytes per
task, plus your notes, habits and settings. With end-to-end encryption on, it
is about a third larger, because the encrypted payload is base64.

## The limit for each setup

| Where the app runs | Path to your WebDAV server | Limit |
|---|---|---|
| **dayglance.app** (hosted web app and PWA) | through the hosted proxy, a Vercel function | **4.5 MB**, for both uploads and downloads |
| **Self-hosted Docker image** | nginx, then the bundled Node proxy | **50 MB** at nginx, plus any reverse proxy you put in front of it |
| **Desktop app** (macOS, Windows, Linux) | straight from the app's main process | only your server's own limit |
| **Android and iOS apps** | straight from the native HTTP bridge | only your server's own limit |
| **`npm run dev`** | the Vite dev server's proxy | none |

On the hosted web app, 4.5 MB is roughly 10,000 tasks unencrypted, or about
7,000 encrypted. Long notes make that number smaller.

**iCloud, Direct Access and GLANCEvault are not affected.**
- iCloud and Direct Access read and write a local file.
- GLANCEvault syncs row by row, so no request carries all of your data.

## When the file is too large

The server or proxy answers `413 Payload Too Large`. From version 2.3.0,
`@glance-apps/sync` reports that as its own error, `PAYLOAD_TOO_LARGE`, with
the file's size.
- **Nothing is uploaded, and nothing is lost.** Your changes stay on this
  device.
- **Downloads go on.** Changes from your other devices still arrive and merge.
- **Uploads wait 30 minutes** before trying again, instead of retrying every
  poll.
- **The message says what happened**, with the size, and points at whoever
  runs the server. Before 2.3.0 it said "Network error. Check your
  connection", which was wrong and unfixable.

### A file this device cannot download

The hosted proxy's 4.5 MB applies to the response too. A device that reaches
the server directly, such as the desktop or phone app, can write a file larger
than that. dayglance.app in a browser then gets a 413 on download, and its
sync stops until the file shrinks. The desktop and mobile apps are unaffected.
If you have that much data, use one of them, or self-host the web app.

## Raising the limit

- **Self-hosted Docker:**
  - nginx allows 50 MB (`client_max_body_size` in `nginx.conf`). It used
    nginx's default of 1 MB until #2142, so older images stopped syncing at 1
    MB.
  - A reverse proxy in front of the container (Traefik, Caddy, another nginx)
    has its own limit, and it must allow the same size.
- **Your WebDAV server:** its own upload limit always applies, on every
  platform. Check it if a 413 persists after the proxy limits are raised.
- **The hosted proxy:** 4.5 MB is Vercel's platform limit for a function, and
  it cannot be raised.

## Why the file is not compressed

Compressing the JSON before it is encrypted would make the file several times
smaller. It is deliberately deferred:

- **Older apps could not read it.** Every GLANCE app and every older install
  reads the file. A compressed file looks like corruption to any device that
  has not been updated, and that device would stop syncing. Compression needs
  a new envelope version, and every app has to read that version before any
  app writes it.
- **It has to happen before encryption.** Ciphertext does not compress, so the
  encryption envelope would change too, not just the file.
- **It postpones the limit rather than removing it.** A bigger data set still
  meets the cap eventually. GLANCEvault, which syncs row by row, is the answer
  for data that has outgrown one file.

If the 4.5 MB hosted limit turns out to bite in practice, compression becomes a
coordinated change in `@glance-apps/sync` and all three apps.

## Polling an unchanged file

Separately from size, 2.3.0 stops a quiet device from re-merging the whole file
on every poll.

- **WebDAV:** after a cycle that changed nothing, the next poll sends
  `If-None-Match`. A `304 Not Modified` ends the cycle without a download.
- **iCloud and Direct Access:** the same file text, while local data is
  unchanged, skips the parse and the merge.
- **Both:** a full check still runs at least every 10 minutes.

Every WebDAV path above (hosted, Docker, desktop, native and the dev server)
passes `If-None-Match` and the `304` through. A proxy of your own in front of the server has to do the
same, or each poll falls back to a full download (which still works).

The app's own read wrappers pass it through as well (`absentRemoteSeedGuard.js`,
`unreadableRemote.js`). The first one used to take only the provider config,
so the condition never left the app and every quiet poll downloaded the file;
`src/sync/adapterConditionalRead.test.js` holds the header to the wire. A `304`
counts as a read of the target for the write guard, since the server has just
confirmed the file is the one already merged.
