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
class SseFraming {

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
