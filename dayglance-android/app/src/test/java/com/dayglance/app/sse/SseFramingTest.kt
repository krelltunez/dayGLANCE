package com.dayglance.app.sse

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Unit tests for the native SSE frame boundary detector. Mirrors the behaviour the
 * renderer's drainSseBuffer is tested for (src/sync/vaultEventStream.test.js), so
 * the native framing and the JS parser agree on what a "complete event block" is.
 */
class SseFramingTest {

    @Test
    fun `emits complete blocks and carries the partial remainder across reads`() {
        val f = SseFraming()
        // Two complete events plus a partial third, split awkwardly across reads.
        val first = f.append("data: {\"seq\":1,\"kind\":\"sync\"}\n\ndata: {\"seq\":2,")
        assertEquals(listOf("data: {\"seq\":1,\"kind\":\"sync\"}"), first)

        // The partial "data: {\"seq\":2," is buffered — nothing emitted yet.
        val second = f.append("\"kind\":\"intents\"}\n\n")
        assertEquals(listOf("data: {\"seq\":2,\"kind\":\"intents\"}"), second)
    }

    @Test
    fun `normalizes CRLF and CR frame boundaries`() {
        val f = SseFraming()
        val blocks = f.append("data: {\"seq\":7,\"kind\":\"sync\"}\r\n\r\n")
        assertEquals(listOf("data: {\"seq\":7,\"kind\":\"sync\"}"), blocks)
    }

    @Test
    fun `drops heartbeat and comment-only blocks (no data line)`() {
        val f = SseFraming()
        val blocks = f.append(": keep-alive\n\nevent: ping\n\ndata: {\"seq\":4,\"kind\":\"sync\"}\n\n")
        // Only the block carrying a data: line is forwarded.
        assertEquals(listOf("data: {\"seq\":4,\"kind\":\"sync\"}"), blocks)
    }

    @Test
    fun `multi-line data block is forwarded verbatim for the renderer to parse`() {
        val f = SseFraming()
        val block = "event: intents\nid: 9\ndata: {\"seq\":9,\"kind\":\"intents\"}"
        val blocks = f.append("$block\n\n")
        assertEquals(listOf(block), blocks)
    }

    @Test
    fun `reset discards a partial block so a new stream does not glue onto the old`() {
        val f = SseFraming()
        f.append("data: {\"seq\":1,") // partial, buffered
        f.reset()
        // Fresh stream after reconnect: the leftover partial must be gone.
        val blocks = f.append("data: {\"seq\":2,\"kind\":\"sync\"}\n\n")
        assertEquals(listOf("data: {\"seq\":2,\"kind\":\"sync\"}"), blocks)
    }

    @Test(expected = SseFramingOverflowException::class)
    fun `throws when a single undelimited frame exceeds the cap`() {
        // A server that streams bytes but never the "\n\n" delimiter must not grow the
        // buffer without bound — append throws once the retained partial exceeds the cap.
        val f = SseFraming(maxBufferChars = 1024)
        f.append("data: " + "x".repeat(2000)) // no blank-line boundary, over cap
    }

    @Test
    fun `does not throw while the buffer stays under the cap and still drains`() {
        val f = SseFraming(maxBufferChars = 1024)
        // Under-cap partial is retained (no throw); a later delimiter completes it.
        assertEquals(emptyList<String>(), f.append("data: {\"seq\":1,"))
        val blocks = f.append("\"kind\":\"sync\"}\n\n")
        assertEquals(listOf("data: {\"seq\":1,\"kind\":\"sync\"}"), blocks)
    }

    @Test
    fun `handles several complete blocks in one chunk`() {
        val f = SseFraming()
        val blocks = f.append(
            "data: {\"seq\":1,\"kind\":\"connected\"}\n\n" +
                "data: {\"seq\":2,\"kind\":\"sync\"}\n\n" +
                "data: {\"seq\":3,\"kind\":\"intents\"}\n\n"
        )
        assertEquals(3, blocks.size)
        assertTrue(blocks[0].contains("connected"))
        assertTrue(blocks[2].contains("intents"))
    }
}
