import { describe, expect, it, vi } from 'vitest';
import { LoggerErrorText } from '../src/error-text.js';
import { Logger } from '../src/log.js';
import { LoggerErrorCode, LOGGER_SOURCE } from '../src/errors.js';
import { process as processPlugin } from '../src/plugins/process.js';
import { setLoggerRuntimeManager } from '../src/runtime-manager.js';

type IReporterMode = 'getter' | 'invoke' | 'reject';

type IReporterThenable = {
  readonly thenable: object;
  readonly error: Error;
  readonly reads: () => number;
  readonly receiverMatches: () => boolean;
  readonly invoked: () => boolean;
};

/** Builds a hostile reporter thenable whose getter and invocation each have one observation path. */
function createReporterThenable(mode: IReporterMode, label: string): IReporterThenable {
  /** Original reporter failure preserved through the process cleanup diagnostic. */
  const error = new Error(`${label}-${mode}`);
  /** Counts reflective `.then` reads to prove single observation. */
  let readCount = 0;
  /** Records whether the captured then function received the thenable receiver. */
  let receiverMatches = false;
  /** Records whether the captured then function was invoked. */
  let invoked = false;
  /** Thenable object whose receiver is checked by its captured method. */
  let thenable: object;
  const then = function (
    this: unknown,
    resolve: (value?: unknown) => void,
    reject: (reason?: unknown) => void
  ): void {
    receiverMatches = this === thenable;
    invoked = true;
    if (mode === 'invoke') throw error;
    queueMicrotask(() => reject(error));
    if (mode === 'getter') resolve(undefined);
  };

  thenable = {};
  // oxlint-disable-next-line unicorn/no-thenable -- LG-T49 requires a hostile reporter thenable.
  Object.defineProperty(thenable, 'then', {
    configurable: true,
    get: () => {
      readCount += 1;
      if (mode === 'getter') throw error;
      return then;
    }
  });

  return {
    thenable,
    error,
    reads: () => readCount,
    receiverMatches: () => receiverMatches,
    invoked: () => invoked
  };
}

/** Finds the logger-owned final-uninstall diagnostic without changing nested error order. */
function findLoggerCleanupError(value: unknown): Error & { cause?: unknown } {
  /** Pending cause/aggregate nodes visited during bounded error-chain traversal. */
  const pending: unknown[] = [value];
  /** Prevents cycles in hostile error cause graphs from making the test traversal non-terminating. */
  const visited = new Set<unknown>();
  while (pending.length > 0) {
    const candidate = pending.shift();
    if (visited.has(candidate)) continue;
    visited.add(candidate);
    if (
      candidate instanceof Error &&
      (candidate as Error & { code?: string }).code === LoggerErrorCode.pluginUninstallCleanupFailed
    )
      return candidate as Error & { cause?: unknown };
    if (candidate instanceof AggregateError) pending.push(...candidate.errors);
    if (candidate instanceof Error) pending.push(candidate.cause);
  }
  throw new Error('logger shutdown cleanup diagnostic not found');
}

describe('Round27 logger final cleanup containment', () => {
  it('LG-T48 / LG-R32 continues frozen, sealed, primitive, and non-Error cleanup failures in order', async () => {
    /** Runtime listener registry used to verify every attempted listener is removed. */
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    /** Original exit function captured before ProcessPlugin interception. */
    const originalExit = (() => undefined as never) as (code?: number) => never;
    /** Mutable fake exit slot used by the runtime capability. */
    let exitValue = originalExit;
    /** Whether final restoration should continue succeeding after the first failed uninstall. */
    let allowRestore = false;
    /** Whether listener cleanup should fail for the first uninstall only. */
    let failCleanup = true;
    /** Ordered listener cleanup attempts, including failures. */
    const removeAttempts: string[] = [];
    /** Frozen native error thrown by exit restoration. */
    const frozenRestoreError = Object.freeze(new TypeError('round27-frozen-exit'));
    /** Original frozen restoration stack, which must remain unchanged through wrapper cause. */
    const frozenRestoreStack = frozenRestoreError.stack;
    /** Frozen native error thrown by the first listener removal. */
    const frozenListenerError = Object.freeze(new Error('round27-frozen-listener'));
    /** Sealed native error thrown by the second listener removal. */
    const sealedListenerError = Object.seal(new RangeError('round27-sealed-listener'));
    /** Non-Error object thrown by a later listener removal. */
    const objectThrow = Object.freeze({ marker: 'round27-object' });
    /** Ordered cleanup throws after exit restoration. */
    const cleanupThrows: readonly unknown[] = [
      frozenListenerError,
      sealedListenerError,
      'round27-primitive',
      objectThrow,
      null
    ];
    /** Runtime process double with hostile restoration and listener cleanup. */
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void): void => {
        const group = listeners.get(event) ?? new Set();
        group.add(listener);
        listeners.set(event, group);
      },
      removeListener: (event: string, listener: (...args: any[]) => void): void => {
        removeAttempts.push(event);
        const index = [
          'SIGINT',
          'SIGTERM',
          'beforeExit',
          'uncaughtException',
          'unhandledRejection'
        ].indexOf(event);
        if (failCleanup && index >= 0) {
          const thrown = cleanupThrows[index];
          if (thrown !== undefined) throw thrown;
          throw new Error('round27-missing-cleanup-throw');
        }
        listeners.get(event)?.delete(listener);
      },
      get exit(): (code?: number) => never {
        return exitValue;
      },
      set exit(value: (code?: number) => never) {
        if (value === originalExit && !allowRestore) throw frozenRestoreError;
        exitValue = value;
      }
    };
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round27-cleanup',
      defer: (task) => task(),
      write: () => undefined
    });

    try {
      const first = new Logger({ plugins: [processPlugin({ interceptProcessExit: true })] });
      expect([...listeners.keys()]).toEqual([
        'SIGINT',
        'SIGTERM',
        'beforeExit',
        'uncaughtException',
        'unhandledRejection'
      ]);
      let failure: unknown;
      try {
        await first.unUse('process');
      } catch (error) {
        failure = error;
      }

      expect(removeAttempts).toEqual([
        'SIGINT',
        'SIGTERM',
        'beforeExit',
        'uncaughtException',
        'unhandledRejection'
      ]);
      const tagged = findLoggerCleanupError(failure);
      const cleanup = (tagged.cause as AggregateError).errors;
      expect(cleanup).toHaveLength(6);
      expect(cleanup[0]).not.toBe(frozenRestoreError);
      expect((cleanup[0] as Error & { cause?: unknown }).cause).toBe(frozenRestoreError);
      expect(cleanup[0]).toBeInstanceOf(TypeError);
      expect(Object.getPrototypeOf(cleanup[0])).toBe(TypeError.prototype);
      expect((cleanup[0] as Error).message).toBe(LoggerErrorText.errorTaggingFailed);
      expect(Object.prototype.hasOwnProperty.call(cleanup[0], 'stack')).toBe(true);
      expect(typeof (cleanup[0] as Error).stack).toBe('string');
      expect((cleanup[0] as Error).stack).not.toBe('');
      expect((cleanup[0] as Error).stack).not.toBe(frozenRestoreStack);
      expect(frozenRestoreError.stack).toBe(frozenRestoreStack);
      expect((cleanup[1] as Error & { cause?: unknown }).cause).toBe(frozenListenerError);
      expect(cleanup[1]).toBeInstanceOf(Error);
      expect((cleanup[2] as Error & { cause?: unknown }).cause).toBe(sealedListenerError);
      expect(cleanup[2]).toBeInstanceOf(RangeError);
      expect((cleanup[3] as Error & { cause?: unknown }).cause).toBe('round27-primitive');
      expect((cleanup[4] as Error & { cause?: unknown }).cause).toBe(objectThrow);
      expect((cleanup[5] as Error & { cause?: unknown }).cause).toBeNull();
      expect(tagged).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.pluginUninstallCleanupFailed
      });

      allowRestore = true;
      failCleanup = false;
      exitValue = originalExit;
      listeners.clear();
      const second = new Logger({ plugins: [processPlugin({ interceptProcessExit: true })] });
      expect(runtimeProcess.exit).not.toBe(originalExit);
      await expect(second.unUse('process')).resolves.toBeUndefined();
      expect(runtimeProcess.exit).toBe(originalExit);
    } finally {
      allowRestore = true;
      failCleanup = false;
      exitValue = originalExit;
      restore();
    }
  });
});

describe('Round27 logger runtime reporter containment', () => {
  it.each(['getter', 'invoke', 'reject'] as const)(
    'LG-T49 / LG-R33 contains hostile console reporter %s with one diagnostic attempt',
    async (mode) => {
      /** Hostile rejection returned by the runtime reporter. */
      const reporter = createReporterThenable(mode, 'round27-console');
      /** Primary process-exit failure that must remain reachable in the diagnostic. */
      const exitError = new Error('round27-exit');
      /** Process listeners registered by ProcessPlugin. */
      const listeners = new Map<string, (...args: any[]) => void>();
      /** Runtime process double whose exit path rejects graceful shutdown. */
      const runtimeProcess = {
        env: {},
        stdout: { write: () => true },
        on: (event: string, listener: (...args: any[]) => void): void => {
          listeners.set(event, listener);
        },
        removeListener: (event: string): void => {
          listeners.delete(event);
        },
        exit: (() => {
          throw exitError;
        }) as (code?: number) => never
      };
      /** Single console diagnostic attempt, intentionally returning a hostile thenable. */
      const consoleError = vi.fn(() => reporter.thenable as never);
      /** Process-level unhandled rejection observations. */
      const unhandled: unknown[] = [];
      /** Records any rejection that escapes reporter containment. */
      const onUnhandled = (reason: unknown): void => {
        unhandled.push(reason);
      };
      const restore = setLoggerRuntimeManager({
        process: runtimeProcess,
        randomUUID: () => `round27-reporter-${mode}`,
        defer: (task) => task(),
        write: () => undefined,
        console: { log: () => undefined, warn: () => undefined, error: consoleError }
      });
      process.on('unhandledRejection', onUnhandled);

      try {
        new Logger({ plugins: [processPlugin()] });
        expect(() => listeners.get('SIGINT')?.()).not.toThrow();
        await new Promise<void>((resolve) => setTimeout(resolve, 0));

        expect(consoleError).toHaveBeenCalledTimes(1);
        expect(reporter.reads()).toBe(1);
        if (mode === 'getter') {
          expect(reporter.invoked()).toBe(false);
        } else {
          expect(reporter.invoked()).toBe(true);
          expect(reporter.receiverMatches()).toBe(true);
        }
        const diagnosticCall = consoleError.mock.calls[0] as unknown as
          | readonly unknown[]
          | undefined;
        const diagnostic = diagnosticCall?.[0] as unknown as Error & {
          cause?: unknown;
        };
        expect(diagnostic).toMatchObject({
          source: LOGGER_SOURCE,
          code: LoggerErrorCode.pluginShutdownCleanupFailed
        });
        expect(diagnostic.cause).toBe(exitError);
        expect(unhandled).toEqual([]);
      } finally {
        process.removeListener('unhandledRejection', onUnhandled);
        restore();
      }
    }
  );

  it('LG-T50 / LG-R33 contains a thenable returned by write without retrying the diagnostic', async () => {
    /** Hostile write result whose rejection must be observed without a second write. */
    const reporter = createReporterThenable('reject', 'round27-write');
    /** Process listeners registered by ProcessPlugin. */
    const listeners = new Map<string, (...args: any[]) => void>();
    /** Runtime process double whose exit path rejects graceful shutdown. */
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void): void => {
        listeners.set(event, listener);
      },
      removeListener: (event: string): void => {
        listeners.delete(event);
      },
      exit: (() => {
        throw new Error('round27-write-exit');
      }) as (code?: number) => never
    };
    /** Single write diagnostic attempt, returning a rejecting thenable despite void typing. */
    const write = vi.fn(() => reporter.thenable as never);
    /** Process-level unhandled rejection observations. */
    const unhandled: unknown[] = [];
    /** Records any rejection that escapes reporter containment. */
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round27-write',
      defer: (task) => task(),
      write,
      console: undefined
    });
    process.on('unhandledRejection', onUnhandled);

    try {
      new Logger({ plugins: [processPlugin()] });
      expect(() => listeners.get('SIGINT')?.()).not.toThrow();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      expect(write).toHaveBeenCalledTimes(1);
      expect(reporter.reads()).toBe(1);
      expect(reporter.invoked()).toBe(true);
      expect(reporter.receiverMatches()).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      restore();
    }
  });
});
