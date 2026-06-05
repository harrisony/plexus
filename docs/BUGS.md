# Known Bugs / Missing Instrumentation

## inference-v2 (pi-ai native path): missing `tokensPerSec` on streaming requests

**Affected routes:** All `POST /beta/v1/*` and `POST /v1beta/*/streamGenerateContent` streaming responses.

**Symptom:** `tokensPerSec` is `null` in the usage log for every streaming pi-ai request, even when the stream completes successfully and `tokensOutput` is populated.

**Root cause:** The passthrough path computes `tokensPerSec` inside the `StallInspector` / `UsageInspector` pipeline, which measures byte throughput as chunks flow through a Node.js `PassThrough` stream. The inference-v2 route handlers pump chunks directly from the pi-ai `AssistantMessageEvent` async iterator to the Fastify reply — they never pass through the stall inspector, so no throughput timing is recorded.

**Fix direction:** After the streaming loop completes, compute `tokensPerSec = tokensOutput / (durationMs / 1000)` and write it to the usage record via `usageStorage.emitUpdated(...)`, or wire a lightweight timing wrapper around the chunk iterator that records first-chunk time and final chunk time.

---

## inference-v2 (pi-ai native path): `ttftMs` null on non-streaming requests

**Affected routes:** All `POST /beta/v1/*` and `POST /v1beta/*/generateContent` **non-streaming** responses.

**Symptom:** `ttftMs` is `null` in the usage log for every non-streaming pi-ai request.

**Root cause:** `ttftMs` (time-to-first-token) is meaningful only for streaming; for non-streaming requests the entire response is buffered before being sent, so there is no distinct "first token" moment. The passthrough path also records `null` for non-streaming requests. This is therefore expected behaviour, not a bug — but it is noted here for completeness in case a proxy-level TTFB measure is ever desired.

**Fix direction:** No change required unless a wall-clock "response latency" field (i.e. time from request received to first byte sent back to client) is added as a separate metric for non-streaming requests.

---

## inference-v2 (pi-ai native path): debug log missing `responseHeaders`, `responseStatus`, and response snapshots

**Affected routes:** All inference-v2 routes, both streaming and non-streaming.

**Symptom:** Compared to the passthrough path, debug logs for all beta requests are missing:
- `responseHeaders` — always `null`; upstream provider response headers (content-type, server-timing, etc.) not captured.
- `responseStatus` — always `null`; upstream HTTP status code not recorded.
- `rawResponseSnapshot` — always `null`; the passthrough path stores the final reconstructed SSE chunk here (used for cost/energy extraction), but the inference-v2 path never calls `debug.addReconstructedRawResponse()`.
- `transformedResponseSnapshot` — always `null`; same as above, never populated via `debug.addTransformedResponseSnapshot()`.

Note: `rawResponse` and `transformedResponse` are both populated correctly, so the full response content is not lost — only the snapshot and metadata fields are absent.

**Root cause:** The inference-v2 route handlers call `debug.startLog()`, `debug.addTransformedRequest()`, `debug.addRawResponse()`, and `debug.addTransformedResponse()`, but never call `debug.addResponseMeta(requestId, status, headers)` (which sets `responseStatus` and `responseHeaders`), `debug.addReconstructedRawResponse()`, or `debug.addTransformedResponseSnapshot()`. The `fetch-tap` captures raw bytes for `rawResponse` but does not extract the HTTP status/headers from the underlying `Response` object.

**Fix direction:** In `runPiAiExecutor` (or each route handler's `onSuccess`/post-response block), call `debug.addResponseMeta(requestId, upstreamStatus, upstreamHeaders)` after the fetch completes. For snapshots, call `debug.addReconstructedRawResponse(requestId, lastRawChunk)` and `debug.addTransformedResponseSnapshot(requestId, finalMessage)` at the end of streaming or after a non-streaming response.

---

## inference-v2 (pi-ai native path): `kwhUsed` always null

**Affected routes:** All inference-v2 routes, both streaming and non-streaming.

**Symptom:** `kwhUsed` is `null` in the usage log for all pi-ai requests.

**Root cause:** The passthrough path populates `kwhUsed` from two sources, neither of which the inference-v2 path currently uses:

1. **Provider-reported energy from SSE comment lines.** Some providers (e.g. neuralwatt) emit `: energy {"energy_kwh": ...}` as SSE comments alongside `data:` events. The passthrough path's `DebugLoggingInspector` parses these out of the raw byte stream into `reconstructed.providerReportedEnergy`, which `UsageLoggingInspector` and `response-handler.ts` then read to set `kwhUsed` directly. The inference-v2 path consumes pi-ai's typed `AssistantMessageEvent` iterator and never sees the raw SSE bytes, so these comment lines are invisible to it.

2. **Estimated energy from model architecture params.** When no provider-reported energy is present, the passthrough path calls `estimateKwhUsed(tokensInput, tokensOutput, modelParams, gpuParams)` using `modelParams` resolved from the canonical model registry. The inference-v2 route handlers do not perform this lookup.

**Fix direction:** Two complementary fixes:
- Check whether pi-ai exposes energy metadata on its response/event objects (e.g. `AssistantMessage` or a final event); if so, read it directly and set `kwhUsed`.
- As a fallback, resolve `modelParams` from the canonical model registry after a successful response (same lookup used by the passthrough path) and call `estimateKwhUsed` to fill in an estimate.
