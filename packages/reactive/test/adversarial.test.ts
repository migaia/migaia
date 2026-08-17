import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRuntime } from '../src/runtime/runtime.class';
import { noteRuntimeCopy, resetRuntimeCopiesForTest } from '../src/runtime/copy-check';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

function collectSourceFiles(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...collectSourceFiles(full));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('AF-T4 reactive runtime-neutrality', () => {
  it('core modules (excluding the adapter boundary) never touch host clock/timer/console directly', () => {
    const allowed = new Set(['default-runtime-adapter.ts', 'ambient.d.ts']);
    const offenders: string[] = [];
    for (const file of collectSourceFiles(srcDir)) {
      if (allowed.has(file.split('/').pop() ?? '')) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const pattern of ['Date.now', 'performance', 'queueMicrotask', 'console.']) {
        if (source.includes(pattern)) {
          offenders.push(`${relative(srcDir, file)}: ${pattern}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('a manual adapter drives trace timestamps without reading the real host clock', async () => {
    const reportError = vi.fn();
    const events: Array<{ timestamp?: number; type?: string }> = [];
    const runtime = createRuntime({
      adapter: {
        scheduleMicrotask: (task) => queueMicrotask(task),
        now: () => 1_000,
        timestamp: () => 42,
        reportError
      },
      onTrace: (event) => events.push(event)
    });
    const signal = runtime.signal(0);
    signal.value = 1;
    await flush();
    expect(
      events.some((event) => event.type === 'observable-change' && event.timestamp === 42)
    ).toBe(true);
    expect(reportError).not.toHaveBeenCalled();
    signal.dispose();
  });

  it('AF-T20: a non-function adapter field is rejected with INVALID_OPTION at construction', () => {
    for (const key of ['scheduleMicrotask', 'now', 'timestamp', 'reportError'] as const) {
      expect(() => createRuntime({ adapter: { [key]: 'not-a-function' } as any })).toThrow(
        expect.objectContaining({ code: 'INVALID_OPTION' })
      );
    }
  });

  it('AF-T20: a throwing reporter does not break Runtime construction (copy warning containment)', () => {
    noteRuntimeCopy(Symbol('foreign-copy'));
    expect(() =>
      createRuntime({
        onError: () => {
          throw new Error('reporter boom');
        }
      })
    ).not.toThrow();
    resetRuntimeCopiesForTest();
  });

  it('AF-T20: an async-rejecting reporter is contained without unhandled rejection', async () => {
    noteRuntimeCopy(Symbol('foreign-copy'));
    const runtime = createRuntime({
      onError: () => Promise.reject(new Error('async reporter boom'))
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime).toBeDefined();
    resetRuntimeCopiesForTest();
  });

  it('AF-T25: explicit undefined adapter field keeps the default (no overwrite)', async () => {
    const runtime = createRuntime({ adapter: { now: undefined } as any });
    // 显式 undefined 视为 omitted：默认 now 仍可用，不延迟产生裸 TypeError。
    const signal = runtime.signal(0);
    signal.value = 1;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(runtime.currentVersion()).toBeGreaterThan(0);
    signal.dispose();
  });

  it('AF-T28: hostile adapter getter is wrapped as INVALID_OPTION with the original as cause', () => {
    const getterError = new Error('adapter getter boom');
    const adapter = new Proxy(
      {},
      {
        get() {
          throw getterError;
        }
      }
    );
    let caught: unknown;
    try {
      createRuntime({ adapter } as any);
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe('INVALID_OPTION');
    expect((caught as { cause?: unknown }).cause).toBe(getterError);
  });
});
