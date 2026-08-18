import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../src/log.js';
import type { ILogFailure, ILoggerCore, ILoggerPlugin } from '../src/typing.js';

type IBoundary = 'hook' | 'sink' | 'pipeline' | 'flush';
type IFailureMode = 'getter' | 'invoke' | 'reject';
type ITestLogger = Pick<ILoggerCore, 'flush' | 'log' | 'onFailure'>;

type IHostileThenable = {
  readonly thenable: unknown;
  readonly error: Error;
  readonly reads: () => number;
  readonly receiverMatches: () => boolean;
  readonly invoked: () => boolean;
  readonly release: () => void;
};

/** Builds a stateful thenable whose first function is the only valid observation path. */
function createHostileThenable(mode: IFailureMode | 'success', label: string): IHostileThenable {
  const error = new Error(`${label}-${mode}`);
  const secondReadError = new Error(`${label}-second-then-read`);
  let readCount = 0;
  let thenable: object;
  let receiverMatches = false;
  let wasInvoked = false;
  let releaseThenable: (() => void) | undefined;

  const secondThen = function (): void {
    throw secondReadError;
  };
  const firstThen = function (
    this: unknown,
    resolve: (value?: unknown) => void,
    reject: (reason?: unknown) => void
  ): void {
    receiverMatches = this === thenable;
    wasInvoked = true;
    if (mode === 'success') {
      releaseThenable = () => resolve(undefined);
    } else if (mode === 'invoke') {
      throw error;
    } else {
      queueMicrotask(() => reject(error));
    }
  };

  thenable = {};
  // oxlint-disable-next-line unicorn/no-thenable -- LG-T12 requires a real hostile thenable.
  Object.defineProperty(thenable, 'then', {
    configurable: true,
    get: () => {
      readCount += 1;
      if (mode === 'getter') throw error;
      return readCount === 1 ? firstThen : secondThen;
    }
  });

  return {
    thenable,
    error,
    reads: () => readCount,
    receiverMatches: () => receiverMatches,
    invoked: () => wasInvoked,
    release: () => releaseThenable?.()
  };
}

/** Installs one logger task boundary with the supplied hostile thenable. */
function createBoundaryLogger(boundary: IBoundary, thenable: unknown): ITestLogger {
  const plugin: ILoggerPlugin = {
    name: `thenable-${boundary}`,
    install: (core) => {
      if (boundary === 'hook') {
        core.hook('before', () => thenable as Promise<void>);
      } else if (boundary === 'sink') {
        core.useSink(() => thenable as Promise<void>);
      } else if (boundary === 'flush') {
        core.onFlush(() => thenable as Promise<void>);
      } else {
        const asyncCore = core as unknown as ILoggerCore<'async'>;
        asyncCore.useAsyncPipeline(() => thenable as Promise<void>);
      }
      return {};
    }
  };

  return new Logger({
    pipeline: boundary === 'pipeline' ? { mode: 'async' } : undefined,
    plugins: [plugin]
  }) as unknown as ITestLogger;
}

const boundaries: readonly IBoundary[] = ['hook', 'sink', 'pipeline', 'flush'];
const failureModes: readonly IFailureMode[] = ['getter', 'invoke', 'reject'];

describe('LG-T12 hostile thenable boundaries', () => {
  it.each(boundaries)(
    '%s reads then once, preserves receiver, and flush drains successful work',
    async (boundary) => {
      const hostile = createHostileThenable('success', boundary);
      const logger = createBoundaryLogger(boundary, hostile.thenable);
      const failures: ILogFailure[] = [];
      logger.onFailure((failure) => failures.push(failure));

      if (boundary !== 'flush') logger.log('info', `lg-t12-${boundary}`);
      const flushPromise = logger.flush();
      let flushed = false;
      void flushPromise.then(() => {
        flushed = true;
      });

      await Promise.resolve();
      await Promise.resolve();
      expect(hostile.invoked()).toBe(true);
      expect(hostile.receiverMatches()).toBe(true);
      expect(hostile.reads()).toBe(1);
      expect(flushed).toBe(false);

      hostile.release();
      await expect(flushPromise).resolves.toBeUndefined();
      expect(flushed).toBe(true);
      expect(failures).toHaveLength(0);
    }
  );

  it.each(boundaries.flatMap((boundary) => failureModes.map((mode) => ({ boundary, mode }))))(
    '$boundary observes $mode failure once with original identity',
    async ({ boundary, mode }) => {
      const hostile = createHostileThenable(mode, boundary);
      const logger = createBoundaryLogger(boundary, hostile.thenable);
      const failures: ILogFailure[] = [];
      logger.onFailure((failure) => failures.push(failure));
      const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);

      try {
        if (boundary !== 'flush') {
          expect(() => logger.log('info', `lg-t12-${boundary}-${mode}`)).not.toThrow();
        }
        await expect(logger.flush()).resolves.toBeUndefined();

        const expectedSource = boundary === 'flush' ? 'flush' : boundary;
        expect(failures).toHaveLength(1);
        expect(failures[0]?.source).toBe(expectedSource);
        expect(failures[0]?.error).toBe(hostile.error);
        expect(diagnostic).toHaveBeenCalledTimes(1);
        expect(hostile.reads()).toBe(1);
        if (mode !== 'getter') expect(hostile.invoked()).toBe(true);
      } finally {
        diagnostic.mockRestore();
      }
    }
  );

  it('contains failure-hook rejection without duplicate diagnostics or unhandled rejection', async () => {
    const hostile = createHostileThenable('reject', 'failure-hook');
    const primary = new Error('sink-primary');
    const logger = new Logger() as unknown as ITestLogger;
    const diagnostic = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      logger.onFailure(() => hostile.thenable as Promise<void>);
      const sinkLogger = logger as ILoggerCore;
      sinkLogger.useSink(() => Promise.reject(primary));
      sinkLogger.log('info', 'lg-t12-failure-hook');
      await expect(logger.flush()).resolves.toBeUndefined();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));

      expect(diagnostic).toHaveBeenCalledTimes(2);
      expect(diagnostic.mock.calls[0]?.[1]).toBe(primary);
      expect(diagnostic.mock.calls[1]?.[0]).toMatchObject({
        code: 'HOOK_FAILED',
        cause: hostile.error
      });
      expect(hostile.reads()).toBe(1);
      expect(hostile.receiverMatches()).toBe(true);
      expect(unhandled).toEqual([]);
    } finally {
      process.removeListener('unhandledRejection', onUnhandled);
      diagnostic.mockRestore();
    }
  });
});
