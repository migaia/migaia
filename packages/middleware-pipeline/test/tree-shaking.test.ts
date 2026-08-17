import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { build } from 'vite';

/** Build-only fixture path; no output is written to disk. */
const SYNC_ENTRY_PATH = fileURLToPath(new URL('./fixtures/sync-entry.ts', import.meta.url));

describe('tree shaking', () => {
  it('removes unused async and generator modes from a sync-only bundle', async () => {
    const result = (await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        lib: { entry: SYNC_ENTRY_PATH, formats: ['es'] }
      }
    })) as
      | { readonly output: readonly { readonly type: string; readonly code?: string }[] }
      | readonly {
          readonly output: readonly { readonly type: string; readonly code?: string }[];
        }[];
    const outputs = Array.isArray(result) ? result : [result];
    const code = outputs
      .flatMap((output) => output.output)
      .filter((item) => item.type === 'chunk')
      .map((item) => item.code ?? '')
      .join('\n');

    expect(code).toContain('runSyncOnly');
    expect(code).not.toContain('middleware-pipeline.generator-continue');
    expect(code).not.toContain('middleware stage and downstream failed');
  });
});
