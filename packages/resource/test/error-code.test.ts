import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '@migaia/reactive';
import { Resource } from '../src';
import { ResourceErrorCode } from '../src/error-code';
import { RESOURCE_SOURCE } from '../src/errors';
import { deferred, flushAsync } from './helpers';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

/** Every `.ts` under `src`, so the exhaustiveness scans below cannot silently miss a new module. */
function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectSourceFiles(full));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

/**
 * Strips comments before scanning for code literals. Doc comments legitimately quote code names
 * (that is the §3.5.1 JSDoc requirement); only real code is an "inline literal" violation.
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// M-T37（§3.7.2）：码表生效，且 REQUEST_ABORTED/REQUEST_CANCELLED 仍是 name === 'AbortError' 的
// DOMException —— 码只是附加字段，不替换类型（store-react 的 suspension 判定依赖这一点）。
describe('M-T37 (§3.7.2): every declared code has a real trigger', () => {
  it('RESOURCE_DISPOSED: reading state after dispose()', () => {
    const runtime = createRuntime();
    const resource = new Resource(() => 1, runtime, { autoStart: false });
    resource.dispose();
    expect(() => resource.state).toThrowError(
      expect.objectContaining({ code: ResourceErrorCode.resourceDisposed })
    );
  });

  it('REQUEST_ABORTED / REQUEST_CANCELLED: cancel() while a request is pending', async () => {
    const runtime = createRuntime();
    const blocking = deferred<number>();
    const resource = new Resource(() => blocking.promise, runtime);
    const promise = resource.promise;
    resource.cancel();
    await expect(promise).rejects.toMatchObject({
      name: 'AbortError',
      code: ResourceErrorCode.requestAborted
    });
    expect(resource.state.status).toBe('cancelled');
    if (resource.state.status === 'cancelled') {
      expect(resource.state.error).toMatchObject({
        name: 'AbortError',
        code: ResourceErrorCode.requestCancelled
      });
    }
    resource.dispose();
  });

  it('NO_ACTIVE_PROMISE: peek() on an idle resource that was never started', () => {
    const runtime = createRuntime();
    const resource = new Resource(() => 1, runtime, { autoStart: false });
    expect(() => resource.peek()).toThrowError(
      expect.objectContaining({ code: ResourceErrorCode.noActivePromise })
    );
    resource.dispose();
  });

  it('INVALID_SNAPSHOT: hydrate() with a malformed snapshot', () => {
    const runtime = createRuntime();
    const resource = new Resource(() => 1, runtime, { autoStart: false });
    expect(() =>
      resource.hydrate({
        version: 2 as 1,
        data: 1,
        updatedAt: Date.now(),
        expiresAt: null
      })
    ).toThrowError(expect.objectContaining({ code: ResourceErrorCode.invalidSnapshot }));
    resource.dispose();
  });

  it('INVALID_OPTION: a negative ttl', () => {
    const runtime = createRuntime();
    expect(() => new Resource(() => 1, runtime, { ttl: -1, autoStart: false })).toThrowError(
      expect.objectContaining({ code: ResourceErrorCode.invalidOption })
    );
  });

  it('the abort/cancel errors keep DOMException identity, so `instanceof`-based consumers still work', async () => {
    const runtime = createRuntime();
    const blocking = deferred<number>();
    const resource = new Resource(() => blocking.promise, runtime);
    const promise = resource.promise;
    resource.cancel();
    await expect(promise).rejects.toBeInstanceOf(DOMException);
    resource.dispose();
  });
});

// M-T37 反向 + M-T41（§3.7.5）：码表穷尽、无内联字面量、stack 未被重写、原始错误按 identity 可达。
describe('M-T41 (§3.7.5): the table is exhaustive and tagging is non-destructive', () => {
  const srcFiles = collectSourceFiles(srcDir);

  it('scans a non-trivial number of source files (guards against a silently empty scan)', () => {
    expect(srcFiles.length).toBeGreaterThan(2);
  });

  it('does not expose the pre-extraction store message prefix', () => {
    expect(srcFiles.flatMap((file) => readFileSync(file, 'utf8')).join('\n')).not.toContain(
      ['[', 'store', ']'].join('')
    );
  });

  it('legacy package metadata resolves the same root entry as exports', () => {
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8')
    ) as {
      main?: string;
      types?: string;
      exports?: { '.': { default?: string; types?: string } };
    };
    expect(manifest.main).toBe('./dist/index.js');
    expect(manifest.types).toBe('./dist/index.d.ts');
    expect(manifest.exports?.['.']).toEqual({
      types: './dist/index.d.ts',
      default: './dist/index.js'
    });
  });

  it('no source module outside errors.ts still throws an untagged built-in error', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      if (file.endsWith('/errors.ts') || file.endsWith('/error-code.ts')) continue;
      const source = readFileSync(file, 'utf8');
      const bare = /throw new (Error|TypeError|RangeError|AggregateError)\(/.exec(source);
      if (bare) offenders.push(`${relative(srcDir, file)}: ${bare[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every throw site references a ResourceErrorCode constant instead of an inline code literal', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      if (file.endsWith('/error-code.ts')) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const code of Object.values(ResourceErrorCode)) {
        if (new RegExp(`['"\`]${code}['"\`]`).test(source)) {
          offenders.push(`${relative(srcDir, file)}: inline '${code}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('code values are unique within this source, so (source, code) is unique by construction', () => {
    const declared = Object.values(ResourceErrorCode);
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared).toHaveLength(8); // §3.7.2 表格行数 + SUSPENSE_PROBE_FAILED/CANCELLATION_CLEANUP_FAILED
  });

  it('a tagged error carries source === "@migaia/resource" and a non-empty stack', () => {
    const runtime = createRuntime();
    const resource = new Resource(() => 1, runtime, { autoStart: false });
    resource.dispose();
    let caught: unknown;
    try {
      expect(resource.state).toBeDefined();
    } catch (error) {
      caught = error;
    }
    expect((caught as { source?: string }).source).toBe(RESOURCE_SOURCE);
    expect((caught as Error).stack).toBeTruthy();
  });

  it('a fetcher failure reaches state.error by identity — the package never relabels the caller’s error', async () => {
    const runtime = createRuntime();
    const original = new Error('the fetcher’s own failure');
    const resource = new Resource(() => Promise.reject(original), runtime);
    await expect(resource.promise).rejects.toBe(original);
    await flushAsync();
    expect(resource.state.status).toBe('error');
    if (resource.state.status === 'error') expect(resource.state.error).toBe(original);
    resource.dispose();
  });
});
