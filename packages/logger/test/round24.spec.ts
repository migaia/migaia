import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../src/index.js';
import { http } from '../src/plugins/http.js';
import { process as processPlugin } from '../src/plugins/process.js';
import { LoggerErrorCode, LOGGER_SOURCE } from '../src/errors.js';
import { setLoggerRuntimeManager } from '../src/runtime-manager.js';

describe('Round24 logger construction admission', () => {
  it('rejects a hostile on getter before installing resource-owning plugins and permits reinstall', async () => {
    /** Tracks runtime listeners so failed construction can prove no process resource leaked. */
    const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    /** Tracks whether a resource-owning core plugin was ever installed or disposed. */
    const resourceState = { installs: 0, disposals: 0 };
    /** Error thrown by the hostile public option accessor. */
    const optionError = new Error('round24-on-getter');
    /** Runtime process double with observable listener ownership. */
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: unknown[]) => void): void => {
        const group = listeners.get(event) ?? new Set();
        group.add(listener);
        listeners.set(event, group);
      },
      removeListener: (event: string, listener: (...args: unknown[]) => void): void => {
        listeners.get(event)?.delete(listener);
      },
      exit: (() => undefined as never) as (code?: number) => never
    };
    /** Plugin that would own core resources if construction reached installation. */
    const resourcePlugin = {
      name: 'round24-resource',
      install: (core: { onDispose(resource: () => void): void }): Record<string, never> => {
        resourceState.installs += 1;
        core.onDispose(() => {
          resourceState.disposals += 1;
        });
        return {};
      }
    };
    /** Public option object whose `on` getter fails during admission. */
    const hostileOptions = {
      plugins: [processPlugin(), resourcePlugin],
      get on(): never {
        throw optionError;
      }
    };
    /** Restores the process runtime capability after this isolated test. */
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'round24-construction',
      defer: (task) => task(),
      write: () => undefined
    });

    try {
      let failure: unknown;
      try {
        new Logger(hostileOptions as never);
      } catch (error) {
        failure = error;
      }

      expect(failure).toBeInstanceOf(TypeError);
      expect(failure).toMatchObject({
        source: LOGGER_SOURCE,
        code: LoggerErrorCode.invalidOption
      });
      expect((failure as Error & { cause?: unknown }).cause).toBe(optionError);
      expect(resourceState).toEqual({ installs: 0, disposals: 0 });
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true);

      const reinstall = new Logger({ plugins: [processPlugin()] });
      expect([...listeners.values()].some((group) => group.size > 0)).toBe(true);
      await reinstall.unUse('process');
      expect([...listeners.values()].every((group) => group.size === 0)).toBe(true);
    } finally {
      restore();
    }
  });

  it('wraps an Object.entries proxy failure as logger INVALID_OPTION before plugin side effects', () => {
    /** Error thrown while enumerating the hostile `on` proxy. */
    const optionError = new Error('round24-on-entries');
    /** Public option proxy whose `on` value fails during own-key enumeration. */
    const hostileOn = new Proxy(
      {},
      {
        ownKeys: () => {
          throw optionError;
        }
      }
    );
    /** Public options containing a process plugin that must not be installed. */
    const hostileOptions = { on: hostileOn, plugins: [processPlugin()] };

    let failure: unknown;
    try {
      new Logger(hostileOptions as never);
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(TypeError);
    expect(failure).toMatchObject({
      source: LOGGER_SOURCE,
      code: LoggerErrorCode.invalidOption
    });
    expect((failure as Error & { cause?: unknown }).cause).toBe(optionError);
  });
});

describe('Round24 HTTP shutdown admission', () => {
  it('does not start a fresh request after shutdown abort when the signal does not replay abort', async () => {
    /** Records every controller so request-controller abort state is observable. */
    const controllers: Array<{ readonly signal: { readonly aborted: boolean } }> = [];
    /** Records fetch attempts; shutdown admission must prevent all attempts. */
    const fetch = vi.fn(async (_url: string, init: { signal?: AbortSignal }) => {
      if (!init.signal?.aborted) throw new Error('round24-fetch-started-live');
      return { ok: true, status: 200, headers: { get: () => null } };
    });
    /** Counts shutdown listener registration/removal so terminal cleanup is explicit. */
    const listenerState = { adds: 0, removes: 0 };
    /** Request-timeout scheduler calls prove no HTTP timer was created after terminal admission. */
    let requestScheduleCalls = 0;
    const scheduler = {
      now: () => 0,
      schedule: (_callback: () => void, delay: number) => {
        if (delay === 10000) requestScheduleCalls += 1;
        return { cancel: () => undefined };
      }
    };
    /** Tracks abort listeners and deliberately omits abort replay on late registration. */
    class NonReplayingAbortController {
      /** Listener set owned by one request or shutdown controller. */
      #listeners = new Set<() => void>();
      readonly signal: {
        aborted: boolean;
        addEventListener: (_type: string, listener: () => void) => void;
        removeEventListener: (_type: string, listener: () => void) => void;
      };

      /** Creates a signal that records listeners but does not replay an earlier abort. */
      constructor() {
        let aborted = false;
        this.signal = {
          get aborted(): boolean {
            return aborted;
          },
          addEventListener: (_type, listener): void => {
            listenerState.adds += 1;
            this.#listeners.add(listener);
          },
          removeEventListener: (_type, listener): void => {
            listenerState.removes += 1;
            this.#listeners.delete(listener);
          }
        };
        controllers.push(this as unknown as { readonly signal: { readonly aborted: boolean } });
        Object.defineProperty(this, 'abort', {
          value: (): void => {
            aborted = true;
            for (const listener of Array.from(this.#listeners)) listener();
          },
          configurable: true
        });
      }

      /** Provides the AbortController contract; the constructor installs the stateful function. */
      abort(): void {
        // Replaced in the constructor so the signal closure owns the state.
      }
    }
    /** Restores the global controller implementation after the race test. */
    const originalAbortController = globalThis.AbortController;
    vi.stubGlobal('AbortController', NonReplayingAbortController);
    /** Restores the runtime transport capability after this isolated test. */
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'round24-http-shutdown',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    });

    try {
      const logger: any = new Logger({
        scheduler,
        plugins: [http({ url: 'https://example.test/logs', retries: 2 })]
      });
      logger.onShutdown(() => {
        logger.log('info', 'late-shutdown-entry');
      });

      await expect(logger.shutdown('manual')).resolves.toBeUndefined();
      expect(fetch).not.toHaveBeenCalled();
      expect(controllers.length).toBe(2);
      expect(controllers[1]?.signal.aborted).toBe(true);
      expect(listenerState).toEqual({ adds: 1, removes: 1 });
      expect(requestScheduleCalls).toBe(0);
      await expect(logger.flush()).resolves.toBeUndefined();
    } finally {
      restore();
      vi.stubGlobal('AbortController', originalAbortController);
    }
  });
});
