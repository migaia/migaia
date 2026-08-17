import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Signal } from '../src/reactive/signal.class';
import { createRuntime } from '../src/runtime/runtime.class';
import { createObserverBinding } from '../src/runtime/observer-binding';
import { internalsOf, registerInternals } from '../src/runtime/internals';
import { assertReactiveOwnedBy, claimOwnership } from '../src/runtime/ownership';
import {
  assertSingleRuntimeCopy,
  brandOwnedValue,
  noteRuntimeCopy,
  resetRuntimeCopiesForTest,
  runtimeCopyCount
} from '../src/runtime/copy-check';
import { VersionClock } from '../src/runtime/version-clock.class';
import { Scheduler } from '../src/runtime/scheduler.class';
import type { IFlushable } from '../src/runtime/types';
import { ReactiveErrorCode } from '../src/error-code';
import { REACTIVE_SOURCE } from '../src/errors';

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

// M-T36 正向：§3.7.1 的每个码都要有一个真实、可验证的触发点。
describe('M-T36 (§3.7.1): every declared code has a real trigger', () => {
  it('NODE_DISPOSED: reading a disposed Signal', () => {
    const runtime = createRuntime();
    const signal = new Signal(1, runtime);
    signal.dispose();
    expect(() => signal.value).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.nodeDisposed })
    );
  });

  it('CIRCULAR_DEPENDENCY: a computed reading its own value while evaluating', () => {
    const runtime = createRuntime();
    let computed: { value: number } | undefined;
    computed = runtime.computed(() => (computed as { value: number }).value + 1);
    expect(() => computed?.value).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.circularDependency })
    );
  });

  it('CROSS_RUNTIME: asserting ownership against a different Runtime', () => {
    const owner = createRuntime();
    const other = createRuntime();
    const node = {};
    claimOwnership(node, owner);
    expect(() => assertReactiveOwnedBy(node, other, 'observable')).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.crossRuntime })
    );
  });

  it('NOT_RUNTIME_OWNED: asserting ownership of an unregistered object', () => {
    const runtime = createRuntime();
    expect(() => assertReactiveOwnedBy({}, runtime, 'observable')).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.notRuntimeOwned })
    );
  });

  it('OWNERSHIP_CONFLICT: claiming the same node for two Runtimes', () => {
    const r1 = createRuntime();
    const r2 = createRuntime();
    const node = {};
    claimOwnership(node, r1);
    expect(() => claimOwnership(node, r2)).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.ownershipConflict })
    );
  });

  it('COPY_CONFLICT: assertSingleRuntimeCopy() when a second copy has been noted', () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      resetRuntimeCopiesForTest();
      noteRuntimeCopy(Symbol('simulated-other-copy'));
      expect(() => assertSingleRuntimeCopy()).toThrowError(
        expect.objectContaining({ code: ReactiveErrorCode.copyConflict })
      );
    } finally {
      resetRuntimeCopiesForTest();
      consoleSpy.mockRestore();
    }
  });

  it('createRuntime() 登记本副本，使 runtimeCopyCount() 可发现多副本部署', () => {
    resetRuntimeCopiesForTest();
    try {
      expect(runtimeCopyCount()).toBe(0);
      createRuntime();
      expect(runtimeCopyCount()).toBe(1);
    } finally {
      resetRuntimeCopiesForTest();
    }
  });

  it('BRAND_CORRUPTED: the ownership-copy brand holds a non-symbol value', () => {
    const key = Symbol.for('@morning-watch/store.ownership-copy');
    const node = {};
    Object.defineProperty(node, key, { value: 'not-a-symbol', configurable: true });
    expect(() => brandOwnedValue(node)).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.brandCorrupted })
    );
  });

  it('VERSION_EXHAUSTED: the clock has reached its configured maximum', () => {
    const clock = new VersionClock(1);
    clock.next();
    expect(() => clock.next()).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.versionExhausted })
    );
  });

  it('FLUSH_LOOP: a self-requeuing item exceeds maxFlushPasses', () => {
    const scheduler = new Scheduler(undefined, 2);
    const item: IFlushable = {
      debugName: 'self-requeue',
      tick() {
        scheduler.enqueue(item);
      }
    };
    scheduler.enqueue(item);
    let caught: unknown;
    try {
      scheduler.flush();
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(expect.objectContaining({ code: ReactiveErrorCode.flushLoop }));
  });

  it('OBSERVER_FAILED: two observers fail during the same flush', () => {
    const scheduler = new Scheduler();
    scheduler.enqueue({
      tick() {
        throw new Error('bad-1');
      }
    });
    scheduler.enqueue({
      tick() {
        throw new Error('bad-2');
      }
    });
    let caught: unknown;
    try {
      scheduler.flush();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AggregateError);
    expect(caught).toEqual(expect.objectContaining({ code: ReactiveErrorCode.observerFailed }));
  });

  it('ACTION_FLUSH_FAILED: a non-Error action throw and a subsequent flush failure', () => {
    const scheduler = new Scheduler();
    let caught: unknown;
    try {
      scheduler.runBatched(() => {
        scheduler.enqueue({
          tick() {
            throw new Error('flush also failed');
          }
        });
        // eslint-disable-next-line @typescript-eslint/no-throw-literal
        throw 'plain string action failure';
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toEqual(expect.objectContaining({ code: ReactiveErrorCode.actionFlushFailed }));
  });

  it('async error channel is no-op by default (no console.error); a custom channel receives the raw error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const scheduler = new Scheduler();
      scheduler.enqueue({
        tick() {
          throw new Error('async tick failure');
        }
      });
      await Promise.resolve();
      await Promise.resolve();
      expect(consoleSpy).not.toHaveBeenCalled();
    } finally {
      consoleSpy.mockRestore();
    }

    const seen: unknown[] = [];
    const custom = new Scheduler((error) => seen.push(error));
    custom.enqueue({
      tick() {
        throw new Error('async tick failure');
      }
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect((seen[0] as Error).message).toBe('async tick failure');
  });

  it('CAPTURE_INVALID: committing the same capture token twice', () => {
    const runtime = createRuntime();
    const binding = createObserverBinding(runtime);
    binding.observe(() => undefined);
    const capture = binding.capture(() => 1);
    expect(binding.commit(capture)).not.toBe('no-observer');
    expect(() => binding.commit(capture)).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.captureInvalid })
    );
  });

  it('BINDING_DUPLICATE: observe() called twice on the same binding', () => {
    const runtime = createRuntime();
    const binding = createObserverBinding(runtime);
    binding.observe(() => undefined);
    expect(() => binding.observe(() => undefined)).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.bindingDuplicate })
    );
  });

  it('INTERNALS_REGISTERED: registering internals twice on the same Runtime', () => {
    const runtime = createRuntime();
    const internals = internalsOf(runtime);
    expect(() => registerInternals(runtime, internals)).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.internalsRegistered })
    );
  });

  it('INVALID_OPTION: an empty traced action name', () => {
    const runtime = createRuntime();
    expect(() => runtime.runTracedAction('', () => undefined)).toThrowError(
      expect.objectContaining({ code: ReactiveErrorCode.invalidOption })
    );
  });
});

// M-T36 反向：不得有码之外的裸抛出，不得残留迁走的五条，(source, code) 必须唯一。
describe('M-T36 (§3.7.1) reverse direction: the table is exhaustive and does not overreach', () => {
  const srcFiles = collectSourceFiles(srcDir);

  it('scans a non-trivial number of source files (guards against a silently empty scan)', () => {
    expect(srcFiles.length).toBeGreaterThan(10);
  });

  it('no source module outside errors.ts still throws an untagged built-in error', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      // errors.ts is the single construction site; error-code.ts only holds the constants + JSDoc.
      if (file.endsWith('/errors.ts') || file.endsWith('/error-code.ts')) continue;
      const source = readFileSync(file, 'utf8');
      // A tagged throw reads `throw createReactiveError(...)` / `throw tagReactiveError(new X(...))`,
      // so a literal `throw new X(` is exactly the un-migrated shape.
      const bare = /throw new (Error|TypeError|RangeError|AggregateError)\(/.exec(source);
      if (bare) offenders.push(`${relative(srcDir, file)}: ${bare[0]}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every throw site references a ReactiveErrorCode constant instead of an inline code literal', () => {
    const offenders: string[] = [];
    for (const file of srcFiles) {
      if (file.endsWith('/error-code.ts')) continue;
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const code of Object.values(ReactiveErrorCode)) {
        // The SCREAMING_SNAKE value must never be spelled out at a call site.
        if (new RegExp(`['"\`]${code}['"\`]`).test(source)) {
          offenders.push(`${relative(srcDir, file)}: inline '${code}'`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('the five scope/generation codes that migrated to @migaia/lifecycle are absent from this table', () => {
    const migratedAway = [
      'SCOPE_CLOSED',
      'SCOPE_REENTRANT_DISPOSE',
      'SCOPE_SYNC_VIOLATION',
      'GENERATION_DISPOSED',
      'SCOPE_DISPOSAL_FAILED'
    ];
    const declared = Object.values(ReactiveErrorCode) as string[];
    for (const code of migratedAway) expect(declared).not.toContain(code);
  });

  it('code values are unique within this source, so (source, code) is unique by construction', () => {
    const declared = Object.values(ReactiveErrorCode);
    expect(new Set(declared).size).toBe(declared.length);
    expect(declared).toHaveLength(16); // §3.7.1 表格行数
  });

  it('every tagged error carries source === "@migaia/reactive"', () => {
    const runtime = createRuntime();
    const signal = new Signal(1, runtime);
    signal.dispose();
    let caught: unknown;
    try {
      expect(signal.value).toBeDefined();
    } catch (error) {
      caught = error;
    }
    expect((caught as { source?: string }).source).toBe(REACTIVE_SOURCE);
    expect(REACTIVE_SOURCE).toBe('@migaia/reactive');
  });
});

// M-T41：抛出物必须携带 (source, code)、stack 非空且未被重写、原始错误沿 cause 链可达。
describe('M-T41 (§3.7.5): (source, code) tagging never damages stack or the cause chain', () => {
  it('a tagged error keeps a non-empty stack that points at its own throw site', () => {
    const clock = new VersionClock(1);
    clock.next();
    let caught: unknown;
    try {
      clock.next();
    } catch (error) {
      caught = error;
    }
    const stack = (caught as Error).stack;
    expect(stack).toBeTruthy();
    expect(stack).toContain('version-clock');
  });

  it('tagging an existing error preserves its constructor identity (RangeError stays a RangeError)', () => {
    let caught: unknown;
    try {
      new Scheduler(undefined, 0);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect((caught as { code?: string }).code).toBe(ReactiveErrorCode.invalidOption);
    expect((caught as Error).stack).toBeTruthy();
  });

  it('ACTION_FLUSH_FAILED keeps the original action failure reachable through errors, by identity', () => {
    const scheduler = new Scheduler();
    const actionFailure = { marker: 'the original non-Error action throw' };
    let caught: unknown;
    try {
      scheduler.runBatched(() => {
        scheduler.enqueue({
          tick() {
            throw new Error('flush also failed');
          }
        });
        throw actionFailure;
      });
    } catch (error) {
      caught = error;
    }
    // §3.2 cause 可达：AggregateError.errors 是合法可达路径，两个原始错误都按 identity 可达。
    const errors = (caught as { errors?: unknown[] }).errors;
    expect(errors?.[0]).toBe(actionFailure);
    expect(errors?.[1]).toBeInstanceOf(Error);
  });

  it('AF-T5: a frozen business Error is not mutated — both failures stay identity-reachable via AggregateError', () => {
    const scheduler = new Scheduler();
    const frozen = Object.freeze(new Error('frozen action failure'));
    const flushError = new Error('flush also failed');
    let caught: unknown;
    try {
      scheduler.runBatched(() => {
        scheduler.enqueue({
          tick() {
            throw flushError;
          }
        });
        throw frozen;
      });
    } catch (error) {
      caught = error;
    }
    expect((caught as { code?: string }).code).toBe(ReactiveErrorCode.actionFlushFailed);
    const errors = (caught as { errors?: unknown[] }).errors;
    expect(errors?.[0]).toBe(frozen);
    expect(errors?.[1]).toBe(flushError);
  });

  it('OBSERVER_FAILED keeps every original observer error reachable through AggregateError.errors, by identity', () => {
    const scheduler = new Scheduler();
    const first = new Error('bad-1');
    const second = new Error('bad-2');
    scheduler.enqueue({
      tick() {
        throw first;
      }
    });
    scheduler.enqueue({
      tick() {
        throw second;
      }
    });
    let caught: unknown;
    try {
      scheduler.flush();
    } catch (error) {
      caught = error;
    }
    const errors = (caught as AggregateError).errors;
    expect(errors).toContain(first);
    expect(errors).toContain(second);
  });

  it('a single observer failure is rethrown as the caller’s own error, untagged and by identity', () => {
    const scheduler = new Scheduler();
    const only = new Error('the one and only failure');
    scheduler.enqueue({
      tick() {
        throw only;
      }
    });
    let caught: unknown;
    try {
      scheduler.flush();
    } catch (error) {
      caught = error;
    }
    // Not our error to relabel — a lone failure surfaces exactly as produced.
    expect(caught).toBe(only);
    expect((caught as { code?: string }).code).toBeUndefined();
  });
});
