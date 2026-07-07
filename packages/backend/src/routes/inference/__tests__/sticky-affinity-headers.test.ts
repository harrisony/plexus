import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import Fastify, { FastifyInstance } from 'fastify';
import { setConfigForTesting } from '../../../config';
import { registerInferenceRoutes } from '../index';
import { Dispatcher } from '../../../services/dispatcher';
import { UsageStorageService } from '../../../services/usage-storage';
import { DebugManager } from '../../../services/debug-manager';
import { SelectorFactory } from '../../../services/selectors/factory';
import { PLEXUS_SESSION_ID_HEADER } from '../constants';

function makeMockDispatcher() {
  return {
    dispatch: vi.fn(async () => ({
      id: 'resp_123',
      model: 'gpt-4',
      created: 123,
      content: 'ok',
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2, reasoning_tokens: 0 },
    })),
  } as unknown as Dispatcher;
}

function makeMockUsageStorage() {
  return {
    saveRequest: vi.fn(),
    saveError: vi.fn(),
    updatePerformanceMetrics: vi.fn(),
    emitStartedAsync: vi.fn(),
    emitUpdatedAsync: vi.fn(),
  } as unknown as UsageStorageService;
}

describe('inference sticky and affinity headers', () => {
  let fastify: FastifyInstance;
  let mockDispatcher: Dispatcher;

  beforeEach(async () => {
    fastify = Fastify();
    mockDispatcher = makeMockDispatcher();
    const mockUsageStorage = makeMockUsageStorage();
    DebugManager.getInstance().setStorage(mockUsageStorage);
    SelectorFactory.setUsageStorage(mockUsageStorage);

    setConfigForTesting({
      providers: {},
      models: {
        'gpt-4': {
          priority: 'selector',
          sticky_session: true,
          upstream_cache_affinity: false,
          targets: [{ provider: 'openai', model: 'gpt-4' }],
        },
      },
      keys: {
        'test-key-1': { secret: 'sk-valid-key', comment: 'Test Key' },
      },
      failover: {
        enabled: false,
        retryableStatusCodes: [429, 500, 502, 503, 504],
        retryableErrors: ['ECONNREFUSED', 'ETIMEDOUT'],
      },
      quotas: [],
    });

    await registerInferenceRoutes(fastify, mockDispatcher, mockUsageStorage);
    await fastify.ready();
  });

  afterEach(async () => {
    await fastify.close();
  });

  test('chat route reads x-plexus-session-id without populating cacheRoutingHeaders', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'content-type': 'application/json',
        [PLEXUS_SESSION_ID_HEADER]: 'sticky-chat',
      },
      payload: {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'hello' }],
      },
    });

    expect(response.statusCode).toBe(200);
    const dispatched = (mockDispatcher.dispatch as any).mock.calls[0][0];
    expect(dispatched.stickySessionId).toBe('sticky-chat');
    expect(dispatched.cacheRoutingHeaders).toBeUndefined();
  });

  test('responses route reads sticky and cache-affinity headers', async () => {
    const response = await fastify.inject({
      method: 'POST',
      url: '/v1/responses',
      headers: {
        authorization: 'Bearer sk-valid-key',
        'content-type': 'application/json',
        [PLEXUS_SESSION_ID_HEADER]: 'sticky-responses',
        session_id: 'session-123',
        'x-client-request-id': 'request-456',
      },
      payload: {
        model: 'gpt-4',
        input: 'hello',
      },
    });

    expect(response.statusCode).toBe(200);
    const dispatched = (mockDispatcher.dispatch as any).mock.calls[0][0];
    expect(dispatched.stickySessionId).toBe('sticky-responses');
    expect(dispatched.cacheRoutingHeaders).toEqual({
      session_id: 'session-123',
      'x-client-request-id': 'request-456',
    });
  });
});
