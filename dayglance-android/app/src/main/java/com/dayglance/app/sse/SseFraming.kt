package com.dayglance.app.sse

/**
 * Incremental Server-Sent-Events frame boundary detector — the Kotlin mirror of
 * the renderer's `drainSseBuffer` (src/sync/vaultEventStream.js).
 *
 * It does ONLY transport-level framing: accumulate stream text across reads, split
 * complete event blocks on the blank-line delimiter, and hand each block back
 * verbatim. It deliberately does NOT parse `{seq,kind}` — that extraction stays in
 * the renderer's single `parseSseFrame`, which this shell feeds each block through
 * via the bridge. Keeping ONE `{seq,kind}` parser (in the renderer) is the whole
 * point of the bridge-fed design: the native side is a dumb, robust byte framer.
 *
 * Stateful per instance (holds the partial-block remainder between reads) and pure
 * otherwise, so it is unit-testable with no network.
 */
class SseFraming(
    // Cap on the retained (un-delimited) buffer. A server that streams bytes but
    // never the "\n\n" block delimiter would otherwise grow this without bound
    // (memory exhaustion). Real vault events are tiny nudges, so 1 MB is far above
    // anything legitimate; a breach is treated as a stream failure by the caller.
    // Mirrors the iOS VaultSseBridge cap.
    private val maxBufferChars: Int = 1_048_576,
) {

    private val buffer = StringBuilder()

    /**
     * Append a decoded stream chunk and return every COMPLETE event block now
     * available (delimited by a blank line). CRLF/CR are normalised to LF first,
     * matching the renderer. Comment-only / heartbeat blocks (no `data:` line) are
     * dropped here so the bridge isn't woken ~every 25 s for a frame the renderer
     * would only parse to null anyway — a bandwidth/wakeup optimisation, not a
     * correctness one (the renderer's parser would ignore them regardless).
     */
    fun append(chunk: String): List<String> {
        buffer.append(chunk.replace("\r\n", "\n").replace('\r', '\n'))
        val blocks = mutableListOf<String>()
        var idx = buffer.indexOf("\n\n")
        while (idx != -1) {
            val block = buffer.substring(0, idx)
            buffer.delete(0, idx + 2)
            if (hasDataLine(block)) blocks.add(block)
            idx = buffer.indexOf("\n\n")
        }
        // After draining every complete block, whatever remains is a single partial
        // block still awaiting its delimiter. If that alone exceeds the cap the peer
        // is misbehaving (or hostile) — bail so the caller can drop and reconnect
        // rather than buffer unboundedly.
        if (buffer.length > maxBufferChars) {
            throw SseFramingOverflowException(buffer.length, maxBufferChars)
        }
        return blocks
    }

    /**
     * Discard any partial block. Called when a connection drops and a new one is
     * opened, so a half-received event from the dead stream can't be glued onto the
     * first bytes of the fresh stream.
     */
    fun reset() {
        buffer.setLength(0)
    }

    private fun hasDataLine(block: String): Boolean =
        block.split('\n').any { it.startsWith("data:") }
}

/**
 * Thrown by [SseFraming.append] when the retained partial-block buffer exceeds its
 * cap. The reader treats it like any other read failure (drop the connection and
 * reconnect with backoff), so a server that never delimits frames can't exhaust
 * memory.
 */
class SseFramingOverflowException(size: Int, cap: Int) :
    RuntimeException("SSE frame buffer exceeded cap: $size > $cap chars")
