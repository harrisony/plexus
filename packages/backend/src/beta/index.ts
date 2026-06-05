/**
 * T2.5 — Beta route registration.
 *
 * Exports `registerBetaRoutes(fastify, usageStorage, quotaEnforcer?)`.
 *
 * Routes added here:
 *   POST /beta/v1/chat/completions  — Stage 1 (OpenAI chat-completions via pi-ai)
 *
 * Each handler:
 *  1. Sets x-request-id.
 *  2. debug.startLog().
 *  3. Quota check.
 *  4. wireUpstreamTimeout + wireEarlyDisconnectDetection.
 *  5. Parses body via openaiRequestToContext().
 *  6. Calls runPiAiExecutor() with serializeMessage / serializeChunks callbacks.
 *  7. Writes JSON or pumps SSE stream.
 *  8. Errors → OpenAI-shaped { error: { message, type } }.
 *
 * onSuccess is a no-op for Stage 1.
 */

import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DebugManager } from '../services/debug-manager';
import type { UsageStorageService } from '../services/usage-storage';
import type { QuotaEnforcer } from '../services/quota/quota-enforcer';
import { checkQuotaMiddleware } from '../services/quota/quota-middleware';
import { wireUpstreamTimeout, wireEarlyDisconnectDetection } from '../utils/timeout';
import { getClientIp } from '../utils/ip';
import { sanitizeHeaders } from '../utils/sanitize-headers';
import { logger } from '../utils/logger';
import { openaiRequestToContext } from './openai-to-context';
import {
  messageToCompletion,
  eventToChunks,
  chunkToSSE,
  makeChunkSerialiserState,
  SSE_DONE,
} from './context-to-openai';
import { runPiAiExecutor } from './pi-ai-executor';
import { installFetchTap } from './fetch-tap';

// Install the global fetch tap once when this module loads
installFetchTap();

export async function registerBetaRoutes(
  fastify: FastifyInstance,
  usageStorage: UsageStorageService,
  quotaEnforcer?: QuotaEnforcer
): Promise<void> {
  /**
   * POST /beta/v1/chat/completions
   *
   * OpenAI chat-completions via the pi-ai native execution path.
   * Fails closed with HTTP 400 when no registry-valid beta-compatible
   * candidate remains — never falls back to the Transformer path.
   */
  fastify.post('/beta/v1/chat/completions', async (request: FastifyRequest, reply) => {
    const requestId = crypto.randomUUID();
    reply.header('x-request-id', requestId);
    const startTime = Date.now();

    const debug = DebugManager.getInstance();
    const body = request.body as any;

    debug.startLog(requestId, body, sanitizeHeaders(request.headers as any));

    // ── Quota check ────────────────────────────────────────────────────────
    if (quotaEnforcer) {
      const allowed = await checkQuotaMiddleware(request, reply, quotaEnforcer);
      if (!allowed) return;
    }

    // ── Wire abort / disconnect ────────────────────────────────────────────
    const abortController = new AbortController();
    const { signal } = wireUpstreamTimeout(abortController);
    const earlyDisconnect = wireEarlyDisconnectDetection(request, abortController);

    try {
      // ── Parse inbound ──────────────────────────────────────────────────
      const parsed = openaiRequestToContext(body);
      const modelAlias: string = body.model ?? '';

      // ── Serialiser state (per-request, so tool-call index resets per stream) ──
      const chunkState = makeChunkSerialiserState(modelAlias);

      // ── Execute ────────────────────────────────────────────────────────
      const result = await runPiAiExecutor({
        requestId,
        incomingApiType: 'chat',
        modelAlias,
        context: parsed.context,
        streamOptions: parsed.streamOptions,
        reasoningEffort: parsed.reasoningEffort,
        toolChoice: parsed.toolChoice,
        parallelToolCalls: parsed.parallelToolCalls,
        streaming: parsed.streaming,
        request,
        usageStorage,
        quotaEnforcer,
        signal,
        toolsDefined: parsed.toolsDefined,
        messageCount: parsed.messageCount,
        onSuccess: async () => {
          // Stage 1: no-op
        },
        serializeMessage: (msg) => messageToCompletion(msg, modelAlias, requestId),
        serializeChunks: (event) => {
          const chunks = eventToChunks(event, chunkState);
          const frames = chunks.map(chunkToSSE);
          // Append SSE_DONE on the terminal event
          if (event.type === 'done' || event.type === 'error') {
            frames.push(SSE_DONE);
          }
          return frames;
        },
      });

      earlyDisconnect.cleanup();

      if (result.response != null) {
        // Non-streaming
        return reply.code(200).header('content-type', 'application/json').send(result.response);
      }

      if (result.stream != null) {
        // Streaming — SSE
        reply
          .code(200)
          .header('content-type', 'text/event-stream; charset=utf-8')
          .header('cache-control', 'no-cache')
          .header('connection', 'keep-alive')
          .header('x-accel-buffering', 'no');

        const readable = new ReadableStream<string>({
          async start(controller) {
            try {
              for await (const frame of result.stream!) {
                controller.enqueue(frame);
              }
            } catch (e: any) {
              logger.error('[beta/chat] Stream error during pump', e);
            } finally {
              controller.close();
            }
          },
        });

        // Encode to bytes
        const encoded = readable.pipeThrough(new TextEncoderStream());
        return reply.send(encoded);
      }

      // Should not reach here
      return reply
        .code(500)
        .send({ error: { message: 'Executor returned no result', type: 'api_error' } });
    } catch (e: any) {
      earlyDisconnect.cleanup();

      logger.error('[beta/chat] Error processing request', e);

      const statusCode = e?.routingContext?.statusCode ?? 500;
      const errorType =
        statusCode === 401
          ? 'authentication_error'
          : statusCode === 400
            ? 'invalid_request_error'
            : statusCode === 403
              ? 'access_denied'
              : 'api_error';
      const errorCode = e?.routingContext?.code;

      // Save error to storage
      usageStorage
        .saveError(requestId, e, { apiType: 'chat', ...(e?.routingContext ?? {}) })
        .catch(() => {});

      return reply.code(statusCode).send({
        error: {
          message: e?.message ?? 'Internal server error',
          type: errorType,
          ...(errorCode ? { code: errorCode } : {}),
        },
      });
    }
  });
}
