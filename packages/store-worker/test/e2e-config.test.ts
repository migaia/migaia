import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import config from '../e2e/vite.config.js';

describe('store-worker E2E config', () => {
  it('loads the owning package from current source', () => {
    /** Alias table that prevents a stale dist build from producing a false-green E2E result. */
    const aliases = config.resolve?.alias as Record<string, string>;
    expect(aliases['@migaia/store-worker']).toBe(
      fileURLToPath(new URL('../src/index.ts', import.meta.url))
    );
  });
});
