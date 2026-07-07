import { describe, expect, it } from 'vitest';
import { validateConfig } from '../config';

function configWithAlias(aliasFields: Record<string, unknown>): string {
  return JSON.stringify({
    providers: {
      p1: {
        api_base_url: 'https://p1.example.com/v1',
        api_key: 'k',
        models: { 'model-1': {} },
      },
    },
    models: {
      'test-alias': {
        target_groups: [
          {
            name: 'default',
            selector: 'random',
            targets: [{ provider: 'p1', model: 'model-1' }],
          },
        ],
        ...aliasFields,
      },
    },
    keys: {},
  });
}

describe('ModelConfigSchema sticky_session parsing', () => {
  it('accepts sticky_session: true', () => {
    const cfg = validateConfig(configWithAlias({ sticky_session: true }));
    expect(cfg.models?.['test-alias']?.sticky_session).toBe(true);
  });

  it('accepts sticky_session: false', () => {
    const cfg = validateConfig(configWithAlias({ sticky_session: false }));
    expect(cfg.models?.['test-alias']?.sticky_session).toBe(false);
  });

  it('defaults sticky_session to true when not provided', () => {
    const cfg = validateConfig(configWithAlias({}));
    // Schema is `.default(true).optional()` — missing input parses to true so
    // sticky sessions are enabled by default for new models.
    expect(cfg.models?.['test-alias']?.sticky_session).toBe(true);
  });

  it('rejects non-boolean sticky_session', () => {
    expect(() => validateConfig(configWithAlias({ sticky_session: 'yes' }))).toThrow();
    expect(() => validateConfig(configWithAlias({ sticky_session: 1 }))).toThrow();
  });
});

describe('ModelConfigSchema upstream_cache_affinity parsing', () => {
  it('accepts upstream_cache_affinity: true', () => {
    const cfg = validateConfig(configWithAlias({ upstream_cache_affinity: true }));
    expect(cfg.models?.['test-alias']?.upstream_cache_affinity).toBe(true);
  });

  it('accepts upstream_cache_affinity: false', () => {
    const cfg = validateConfig(configWithAlias({ upstream_cache_affinity: false }));
    expect(cfg.models?.['test-alias']?.upstream_cache_affinity).toBe(false);
  });

  it('defaults upstream_cache_affinity to true when not provided', () => {
    const cfg = validateConfig(configWithAlias({}));
    expect(cfg.models?.['test-alias']?.upstream_cache_affinity).toBe(true);
  });

  it('rejects non-boolean upstream_cache_affinity', () => {
    expect(() => validateConfig(configWithAlias({ upstream_cache_affinity: 'yes' }))).toThrow();
    expect(() => validateConfig(configWithAlias({ upstream_cache_affinity: 1 }))).toThrow();
  });
});
