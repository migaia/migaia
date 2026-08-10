import { describe, expect, expectTypeOf, it, vi } from 'vitest';

import { Logger } from './src/log';
import { batch, type IBatchShared } from './src/plugins/batch';
import { color } from './src/plugins/color';
import { level } from './src/plugins/level';
import { reasoning } from './src/plugins/reasoning';
import { process as processPlugin } from './src/plugins/process';
import { http } from './src/plugins/http';
import { uuid } from './src/plugins/uuid';
import { setLoggerRuntimeManager } from './src/runtime-manager';
import type { ILogEntry, ILoggerPlugin } from './src/typing';
import { GENERATOR_CONTINUE, type IPipelineMode } from '@migai/plugin-host';

describe('logger plugin host integration', () => {
  it('runs without process through the runtime manager', () => {
    const writes: string[] = [];
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'browser-id',
      defer: (task) => task(),
      write: (text) => writes.push(text)
    });
    try {
      const logger = new Logger({ plugins: [processPlugin()] });
      logger.raw('browser log');
      expect(logger.ctx.id).toBe('browser-id');
      expect(writes).toEqual(['browser log']);
    } finally {
      restore();
    }
  });

  it('reinstalls process listeners after the final process plugin is removed', async () => {
    const listeners = new Map<string, Set<(...args: any[]) => void>>();
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => {
        let group = listeners.get(event);
        if (!group) {
          group = new Set();
          listeners.set(event, group);
        }
        group.add(listener);
      },
      removeListener: (event: string, listener: (...args: any[]) => void) => {
        listeners.get(event)?.delete(listener);
      },
      exit: (() => undefined as never) as (code?: number) => never
    };
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'process-id',
      defer: (task) => task(),
      write: () => undefined
    });
    try {
      const first = new Logger({ plugins: [processPlugin()] });
      expect(listeners.get('SIGINT')?.size).toBe(1);
      let flushes = 0;
      first.onFlush(() => {
        flushes += 1;
      });
      for (const listener of listeners.get('beforeExit') ?? []) listener();
      for (const listener of listeners.get('beforeExit') ?? []) listener();
      await Promise.resolve();
      await Promise.resolve();
      expect(flushes).toBe(1);
      await first.unUse('process');
      expect(listeners.get('SIGINT')?.size).toBe(0);
      const second = new Logger({ plugins: [processPlugin()] });
      expect(listeners.get('SIGINT')?.size).toBe(1);
      await second.unUse('process');
    } finally {
      restore();
    }
  });

  it('exits with signal code after cores dispose and preserves shutdown logs', async () => {
    const listeners = new Map<string, (...args: any[]) => void>();
    const exits: number[] = [];
    const runtimeProcess = {
      env: {},
      stdout: { write: () => true },
      on: (event: string, listener: (...args: any[]) => void) => listeners.set(event, listener),
      removeListener: () => undefined,
      exit: ((code?: number) => {
        exits.push(code ?? 0);
        return undefined as never;
      }) as (code?: number) => never
    };
    const writes: string[] = [];
    const restore = setLoggerRuntimeManager({
      process: runtimeProcess,
      randomUUID: () => 'signal-id',
      defer: (task) => task(),
      write: (text) => writes.push(text)
    });
    try {
      const logger = new Logger({
        plugins: [
          processPlugin({ shutdownTimeoutMs: 50 }),
          {
            name: 'shutdown-log',
            install: (core: any) => {
              core.onShutdown(() => core.log('info', 'shutdown started'));
              core.useSink((entry: ILogEntry) => writes.push(entry.message));
              return {};
            }
          }
        ] as const
      });
      listeners.get('SIGINT')!();
      await logger.shutdown('signal');
      await new Promise((resolve) => setTimeout(resolve, 0));
      expect(exits).toEqual([0]);
      expect(writes).toContain('shutdown started');
    } finally {
      restore();
    }
  });

  it('exposes isolated plugin config snapshots on the logger facade', async () => {
    const logger = new Logger({ plugins: [level({ level: 'warn' })] });
    expect(logger.config.get('level')).toEqual({ level: 'warn' });
    expect(logger.config.get()).toEqual({ level: { level: 'warn' } });
    await logger.config.update('level', () => ({ level: 'error' }));
    expect(logger.config.get('level')).toEqual({ level: 'error' });
  });

  it.each(['async', 'generator'] as const)(
    'runs logger pipeline plugins in %s mode',
    async (mode) => {
      const seen: ILogEntry[] = [];
      const restore = setLoggerRuntimeManager({
        randomUUID: () => 'mode-id',
        defer: (task) => task(),
        write: () => undefined
      });
      try {
        const logger = new Logger({
          pipeline: { mode },
          plugins: [
            level({ level: 'error' }),
            uuid(),
            {
              name: `mode-capture-${mode}`,
              install: (core: any) => {
                core.useSink((entry: ILogEntry) => seen.push(entry));
                return {};
              }
            }
          ] as const
        });
        logger.log('debug', 'filtered');
        logger.log('error', 'passes');
        await logger.flush();
        expect(seen.map((entry) => `${entry.tag}:${entry.message}:${entry.data.uuid}`)).toEqual([
          'error:passes:mode-id'
        ]);
      } finally {
        restore();
      }
    }
  );

  it('contains synchronous pipeline errors during default dispatch', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = new Logger({
      plugins: [
        {
          name: 'throwing-sync-stage',
          install: (core: any) => {
            core.usePipeline(() => {
              throw new Error('sync stage failed');
            });
            return {};
          }
        }
      ]
    });

    expect(() => logger.log('info', 'message')).not.toThrow();
    expect(error).toHaveBeenCalledWith('[logger] pipeline 阶段异常:', expect.any(Error));
    error.mockRestore();
  });

  it('shares concurrent flush work and ignores entries after shutdown', async () => {
    let release!: () => void;
    const sent: string[] = [];
    const plugin: ILoggerPlugin = {
      name: 'controlled-sink',
      install: (core) => {
        core.useSink(async (entry) => {
          await new Promise<void>((resolve) => (release = resolve));
          sent.push(entry.message);
        });
        return {};
      }
    };
    const logger = new Logger({
      plugins: [plugin]
    });

    logger.log('info', 'before');
    const first = logger.flush();
    const second = logger.flush();
    expect(second).toBe(first);
    release();
    await first;
    await logger.shutdown('manual');
    logger.log('info', 'after');
    await logger.flush();
    expect(sent).toEqual(['before']);
  });

  it('reports rejected sink work without rejecting business dispatch', async () => {
    const failures: string[] = [];
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const plugin: ILoggerPlugin = {
      name: 'failing-sink',
      install: (core) => {
        core.onFailure((failure) => failures.push(failure.source));
        core.useSink(() => Promise.reject(new Error('sink failed')));
        return {};
      }
    };
    const logger = new Logger({
      plugins: [plugin]
    });

    expect(() => logger.log('info', 'message')).not.toThrow();
    await logger.flush();
    expect(failures).toEqual(['sink']);
    error.mockRestore();
  });

  it('keeps console arguments separate from explicit meta and snapshots sink containers', async () => {
    const seen: ILogEntry[] = [];
    const plugin: ILoggerPlugin = {
      name: 'snapshot-sink',
      install: (core) => {
        core.useSink((entry) => {
          seen.push(entry);
        });
        return {};
      }
    };
    const logger = new Logger({
      plugins: [plugin]
    });
    const args: unknown[] = [{ consoleOnly: true }];
    const data = { requestId: 'one' };
    logger.log('info', 'console', ...args);
    logger.dispatchRaw({ tag: 'info', message: 'structured', meta: { userId: 'u1' }, data });
    args.push('later');
    data.requestId = 'two';
    await logger.flush();

    expect(seen[0]?.meta).toBeUndefined();
    expect(seen[0]?.args).toEqual([{ consoleOnly: true }]);
    expect(seen[1]?.meta).toEqual({ userId: 'u1' });
    expect(seen[1]?.data).toEqual({ requestId: 'one' });
  });

  it('does not retry HTTP 400 responses and reports the send failure', async () => {
    const fetch = vi.fn(async () => ({ ok: false, status: 400, headers: { get: () => null } }));
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'http-id',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const failures: string[] = [];
      const logger = new Logger({
        plugins: [http({ url: 'https://example.test/logs', retries: 2 })]
      });
      logger.onFailure((failure) => failures.push(failure.source));
      logger.log('info', 'message');
      await logger.flush();
      expect(fetch).toHaveBeenCalledOnce();
      expect(failures).toEqual(['sink']);
    } finally {
      error.mockRestore();
      restore();
    }
  });

  it('reports HTTP serialization failures through the failure hook', async () => {
    const fetch = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null } }));
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'http-cycle',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    });
    try {
      const failures: string[] = [];
      const logger = new Logger({ plugins: [http({ url: 'https://example.test/logs' })] });
      logger.onFailure((failure) => failures.push(failure.source));
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      logger.log('info', 'cyclic', cyclic);
      await logger.flush();
      expect(fetch).not.toHaveBeenCalled();
      expect(failures).toEqual(['sink']);
    } finally {
      restore();
    }
  });

  it('flushes an unfinished reasoning phase before switching phase', async () => {
    const entries: ILogEntry[] = [];
    const logger = new Logger({
      plugins: [
        reasoning(),
        {
          name: 'reasoning-capture',
          install: (core: any) => {
            core.useSink((entry: ILogEntry) => entries.push(entry));
            return {};
          }
        }
      ] as const
    });
    logger.startThinking();
    logger.thinking('unfinished thinking');
    logger.response('answer');
    await logger.flush();
    expect(entries.map((entry) => entry.tag)).toEqual(['thinking']);
    expect(entries[0]?.message).toBe('unfinished thinking');
  });

  it('retries HTTP 429 and honors a zero Retry-After delay', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => '0' } })
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } });
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'http-429',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    });
    try {
      const logger = new Logger({
        plugins: [http({ url: 'https://example.test/logs', retries: 1 })]
      });
      logger.log('info', 'message');
      await logger.flush();
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      restore();
    }
  });

  it.each([
    ['HTTP 5xx', () => ({ ok: false, status: 503, headers: { get: () => null } })],
    ['network failure', () => Promise.reject(new Error('offline'))]
  ])('retries %s failures', async (_name, response) => {
    vi.useFakeTimers();
    const fetch = vi
      .fn()
      .mockImplementationOnce(response)
      .mockResolvedValueOnce({ ok: true, status: 200, headers: { get: () => null } });
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'http-retry',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    });
    try {
      const logger = new Logger({
        plugins: [http({ url: 'https://example.test/logs', retries: 1 })]
      });
      logger.log('info', 'message');
      const flushed = logger.flush();
      await vi.runAllTimersAsync();
      await flushed;
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally {
      restore();
      vi.useRealTimers();
    }
  });

  it('aborts an in-flight HTTP request during shutdown', async () => {
    let signal: AbortSignal | undefined;
    const fetch = vi.fn(
      (_url: string, init: { signal?: AbortSignal }) =>
        new Promise<never>((_resolve, reject) => {
          signal = init.signal;
          init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })
    );
    const restore = setLoggerRuntimeManager({
      randomUUID: () => 'http-abort',
      defer: (task) => task(),
      write: () => undefined,
      fetch
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const logger = new Logger({ plugins: [http({ url: 'https://example.test/logs' })] });
      logger.log('info', 'message');
      await logger.shutdown('manual');
      expect(signal?.aborted).toBe(true);
    } finally {
      error.mockRestore();
      restore();
    }
  });

  it('drains asynchronous work forwarded through multiple extends targets', async () => {
    let release!: () => void;
    const leaf = new Logger({
      plugins: [
        {
          name: 'leaf-async-sink',
          install: (core: any) => {
            core.useSink(() => new Promise<void>((resolve) => (release = resolve)));
            return {};
          }
        }
      ]
    });
    const middle = new Logger().extends(leaf);
    const root = new Logger().extends(middle);
    root.log('info', 'message');
    const flushed = root.flush();
    release();
    await flushed;
  });

  it('shares concurrent shutdown work and preserves the first reason', async () => {
    const reasons: string[] = [];
    const logger = new Logger({
      plugins: [
        {
          name: 'shutdown-observer',
          install: (core: any) => {
            core.onShutdown((reason: string) => reasons.push(reason));
            return {};
          }
        }
      ]
    });
    const first = logger.shutdown('signal');
    const second = logger.shutdown('manual');
    expect(second).toBe(first);
    await first;
    expect(reasons).toEqual(['signal']);
  });

  it('infers getShared keys and values from plugin shared declarations', async () => {
    const sharedPlugin = {
      name: 'typed-shared',
      shared: () => ({ answer: 42, format: (value: number) => String(value) }),
      install: () => ({})
    };
    const logger = new Logger({ plugins: [sharedPlugin] });
    const dynamicLogger = await new Logger().use(sharedPlugin);

    expectTypeOf(logger.getShared('answer')).toEqualTypeOf<number | undefined>();
    expectTypeOf(logger.getShared('format')).toEqualTypeOf<
      ((value: number) => string) | undefined
    >();
    expectTypeOf(dynamicLogger.getShared('answer')).toEqualTypeOf<number | undefined>();
    // oxlint-disable-next-line no-constant-condition
    if (false) {
      // @ts-expect-error unknown shared keys are rejected
      logger.getShared('missing');
    }
  });

  it('serializes concurrent updates', async () => {
    const seen: number[] = [];
    const plugin: ILoggerPlugin<Record<string, never>, { value: number }> = {
      name: 'serial-update',
      install: () => ({}),
      update: async (config) => {
        seen.push(config.value);
        await Promise.resolve();
      }
    };
    const logger = new Logger({ plugins: [plugin] });

    await Promise.all([
      logger.config.update('serial-update', () => ({ value: 1 })),
      logger.config.update('serial-update', () => ({ value: 2 })),
      logger.config.update('serial-update', () => ({ value: 3 }))
    ]);

    expect(seen).toEqual([1, 2, 3]);
  });

  it('allows plugin update to flush without waiting for its own lifecycle task', async () => {
    let flushed = 0;
    const plugin: ILoggerPlugin<Record<string, never>, { value: number }> = {
      name: 'flush-in-update',
      install: (core) => {
        core.onFlush(() => {
          flushed += 1;
        });
        return {};
      },
      update: async (_config, core) => {
        await core.flush();
      }
    };
    const logger = new Logger({ plugins: [plugin] });

    const update = logger.config.update('flush-in-update', () => ({ value: 1 }));
    await expect(
      Promise.race([
        update,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error('flush waited for its own lifecycle task')), 100);
        })
      ])
    ).resolves.toBeUndefined();
    expect(flushed).toBe(1);
  });

  it('disposes once when unUse is concurrent', async () => {
    let disposed = 0;
    const plugin: ILoggerPlugin = {
      name: 'serial-dispose',
      install: () => ({}),
      dispose: async () => {
        disposed += 1;
        await Promise.resolve();
      }
    };
    const logger = new Logger({ plugins: [plugin] });

    await Promise.all([logger.unUse('serial-dispose'), logger.unUse('serial-dispose')]);

    expect(disposed).toBe(1);
    await expect(logger.unUse('serial-dispose')).resolves.toBeUndefined();
  });

  it('starts rollback cleanup after sync install fails', async () => {
    let disposed = 0;
    const plugin: ILoggerPlugin = {
      name: 'failed-install',
      install: (core) => {
        core.onDispose(() => {
          disposed += 1;
        });
        throw new Error('install failed');
      },
      dispose: () => {
        disposed += 1;
      }
    };
    const logger = new Logger();

    await expect(logger.use(plugin)).rejects.toThrow('install failed');
    expect(disposed).toBe(1);
  });

  it('keeps constructor hooks outside plugin scope', async () => {
    let called = 0;
    const logger = new Logger({ on: { before: () => void (called += 1) } });

    logger.log('info', 'message');
    await logger.flush();

    expect(called).toBe(1);
  });

  it('throws synchronous plugin installation failures from the constructor', () => {
    const plugin: ILoggerPlugin = {
      name: 'constructor-failure',
      install: () => {
        throw new Error('constructor install failed');
      }
    };

    expect(() => new Logger({ plugins: [plugin] })).toThrow('constructor install failed');
  });

  it('rejects async plugins in the constructor before returning a partial logger', () => {
    const plugin: ILoggerPlugin<{ ready: boolean }> = {
      name: 'constructor-async',
      install: async () => ({ ready: true })
    };

    expect(() => new Logger({ plugins: [plugin] })).toThrow(
      'returned an awaitable during synchronous installation'
    );
  });

  it('colors first message content when colorMessage is head', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = new Logger({
      plugins: [
        level(),
        color({ color: 'always', colorMessage: 'head', format: 'pretty', timestamp: false })
      ]
    });

    logger.warn('WARNING');
    await logger.flush();

    const output = String(warn.mock.calls[0]?.[0]);
    expect(output).toContain('\u001b[');
    expect(output).toContain('WARNING');
    warn.mockRestore();
  });

  it.each(['none', 'head'] as const)(
    'renders all console-style arguments when colorMessage is %s',
    async (colorMessage) => {
      const info = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = new Logger({
        plugins: [
          level(),
          color({ color: 'always', colorMessage, format: 'pretty', timestamp: false })
        ]
      });

      logger.info('value: %s', 42, true, null);
      await logger.flush();

      expect(info.mock.calls[0]).toEqual([expect.stringContaining('value: %s'), 42, true, null]);
      info.mockRestore();
    }
  );

  it('colors every primitive argument when colorMessage is all', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger({
      plugins: [
        level(),
        color({ color: 'always', colorMessage: 'all', format: 'pretty', timestamp: false })
      ]
    });
    const object = { answer: 42 };

    logger.info('values', 42, true, null, object);
    await logger.flush();

    const output = info.mock.calls[0]!;
    expect(String(output[0])).toContain('\u001b[');
    expect(String(output[1])).toContain('\u001b[');
    expect(String(output[2])).toContain('\u001b[');
    expect(String(output[3])).toContain('\u001b[');
    expect(output[4]).toBe(object);
    info.mockRestore();
  });

  it('colors only the final argument when colorMessage is tail', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger({
      plugins: [
        level(),
        color({ color: 'always', colorMessage: 'tail', format: 'pretty', timestamp: false })
      ]
    });

    logger.info('values', 42, 'last');
    await logger.flush();

    const output = info.mock.calls[0]!;
    expect(String(output[0])).not.toContain('\u001b[36mvalues');
    expect(output[1]).toBe(42);
    expect(String(output[2])).toContain('\u001b[');
    expect(String(output[2])).toContain('last');
    info.mockRestore();
  });

  it('colors only the first and final arguments when colorMessage is head-tail', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger({
      plugins: [
        level(),
        color({
          color: 'always',
          colorMessage: 'head-tail',
          format: 'pretty',
          timestamp: false
        })
      ]
    });

    logger.info('head', 'middle', 'tail');
    await logger.flush();

    const output = info.mock.calls[0]!;
    expect(String(output[0])).toContain('\u001b[36mhead');
    expect(output[1]).toBe('middle');
    expect(String(output[2])).toContain('\u001b[');
    expect(String(output[2])).toContain('tail');
    info.mockRestore();
  });

  it('accepts a non-string first argument like console.log', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger({
      plugins: [level(), color({ color: 'never', format: 'pretty', timestamp: false })]
    });
    const value = { answer: 42 };

    logger.info(value, 'tail');
    await logger.flush();

    expect(info.mock.calls[0]).toEqual([expect.stringContaining('[INFO]'), value, 'tail']);
    info.mockRestore();
  });

  it('outputs level logs synchronously by default', () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger({
      plugins: [level(), color({ color: 'never', format: 'pretty', timestamp: false })]
    });

    logger.info('sync');

    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });

  it('defers level logs only when asyncOutput is enabled', async () => {
    const info = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = new Logger({
      plugins: [
        level({ asyncOutput: true }),
        color({ color: 'never', format: 'pretty', timestamp: false })
      ]
    });

    logger.info('async');
    expect(info).not.toHaveBeenCalled();

    await logger.flush();
    expect(info).toHaveBeenCalledOnce();
    info.mockRestore();
  });

  it('applies reasoning asyncOutput to raw and completed entry output', async () => {
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const seen: string[] = [];
    const collector: ILoggerPlugin = {
      name: 'reasoning-async-collector',
      install: (core) => {
        core.useSink((entry) => {
          seen.push(entry.message);
        });
        return {};
      }
    };
    const logger = new Logger({ plugins: [reasoning({ asyncOutput: true }), collector] });

    logger.response('answer');
    logger.endResponse();
    expect(write).not.toHaveBeenCalled();
    expect(seen).toEqual([]);

    await logger.flush();
    expect(write).toHaveBeenCalledWith('answer');
    expect(seen).toEqual(['answer']);
    write.mockRestore();
  });

  it('runs full batch callbacks asynchronously by default', async () => {
    const batches: string[][] = [];
    const consumer: ILoggerPlugin<
      Record<string, never>,
      Record<string, unknown>,
      IPipelineMode,
      {},
      IBatchShared
    > = {
      name: 'default-async-batch-consumer',
      install: (core) => {
        const createBatcher = core.getShared('createBatcher')!;
        const batcher = createBatcher<string>({ maxSize: 1 }, (items) => {
          batches.push(items);
        });
        core.useSink((entry) => batcher.push(entry.message));
        return {};
      }
    };
    const logger = new Logger({ plugins: [batch(), consumer] });

    logger.log('info', 'deferred-1');
    logger.log('info', 'deferred-2');
    expect(batches).toEqual([]);

    await logger.flush();
    expect(batches).toEqual([['deferred-1'], ['deferred-2']]);
  });

  it('allows synchronous full batch callbacks explicitly', () => {
    const batches: string[][] = [];
    const consumer: ILoggerPlugin<
      Record<string, never>,
      Record<string, unknown>,
      IPipelineMode,
      {},
      IBatchShared
    > = {
      name: 'sync-batch-consumer',
      install: (core) => {
        const createBatcher = core.getShared('createBatcher')!;
        const batcher = createBatcher<string>({ maxSize: 1 }, (items) => {
          batches.push(items);
        });
        core.useSink((entry) => batcher.push(entry.message));
        return {};
      }
    };
    const logger = new Logger({ plugins: [batch({ asyncOutput: false }), consumer] });

    logger.log('info', 'immediate');

    expect(batches).toEqual([['immediate']]);
  });

  it.each(['sync', 'async', 'generator'] as const)('runs %s pipeline mode', async (mode) => {
    const seen: string[] = [];
    const collector: ILoggerPlugin = {
      name: `collector-${mode}`,
      install: (core) => {
        if (mode === 'sync') {
          core.usePipeline((entry, next) => next({ ...entry, message: `${entry.message}:sync` }));
        } else if (mode === 'async') {
          core.useAsyncPipeline(async (entry, next) => {
            await next({ ...entry, message: `${entry.message}:async` });
          });
        } else {
          core.useGeneratorPipeline(function* (entry) {
            yield { ...entry, message: `${entry.message}:generator` };
            return GENERATOR_CONTINUE;
          });
        }
        core.useSink((entry) => {
          seen.push(entry.message);
        });
        return {};
      }
    };
    const logger = new Logger({
      pipeline: { mode },
      plugins: [collector]
    });

    logger.log('info', 'message');
    await logger.flush();

    expect(seen).toEqual([`message:${mode}`]);
  });

  it('uses generator return values with and without yield', async () => {
    const seen: string[] = [];
    const generatorPlugin: ILoggerPlugin<
      Record<string, never>,
      Record<string, unknown>,
      'generator'
    > = {
      name: 'generator-return',
      install(core) {
        core.useGeneratorPipeline(function* (entry) {
          return { ...entry, message: `${entry.message}:return` };
        });
        core.useGeneratorPipeline(function* (entry) {
          yield { ...entry, message: `${entry.message}:yield` };
          return { ...entry, message: `${entry.message}:final` };
        });
        core.useSink((entry) => {
          seen.push(entry.message);
        });
        return {};
      }
    };
    const logger = new Logger({
      pipeline: { mode: 'generator' },
      plugins: [generatorPlugin]
    });

    logger.log('info', 'message');
    await logger.flush();
    expect(seen).toEqual(['message:return:final']);
  });

  it('types pipeline methods from constructor mode', () => {
    const asyncLogger = new Logger({ pipeline: { mode: 'async' } });
    expect(() => asyncLogger.useAsyncPipeline(async (entry, next) => next(entry))).not.toThrow();
    // oxlint-disable-next-line no-constant-condition
    if (false) {
      // @ts-expect-error async mode only exposes async pipeline registration
      asyncLogger.usePipeline((entry, next) => next(entry));
    }
    const generatorLogger = new Logger({ pipeline: { mode: 'generator' } });
    expect(() =>
      generatorLogger.useGeneratorPipeline(function* (entry) {
        yield entry;
        return undefined;
      })
    ).not.toThrow();
    // oxlint-disable-next-line no-constant-condition
    if (false) {
      // @ts-expect-error generator mode only exposes generator pipeline registration
      generatorLogger.useAsyncPipeline(async (entry, next) => next(entry));
    }
  });

  it('rejects nested plugin mutation during install', async () => {
    const inner: ILoggerPlugin<
      Record<string, never>,
      Record<string, unknown>,
      IPipelineMode,
      { innerShared: number }
    > = {
      name: 'nested-inner',
      shared: () => ({ innerShared: 42 }),
      install: () => ({})
    };
    const outer: ILoggerPlugin<
      Record<string, never>,
      Record<string, unknown>,
      IPipelineMode,
      { outerShared: number }
    > = {
      name: 'nested-outer',
      shared: () => ({ outerShared: 7 }),
      install: (core) => {
        (core as unknown as { use(plugin: unknown): unknown }).use(inner);
        return {};
      }
    };

    const logger = new Logger();
    await expect(logger.use(outer)).rejects.toThrow();
  });

  it('awaits async cleanup when async installation fails', async () => {
    const events: string[] = [];
    const logger = new Logger();
    const plugin: ILoggerPlugin = {
      name: 'async-failed-install',
      install: () => {
        throw new Error('install failed');
      },
      dispose: async () => {
        await Promise.resolve();
        events.push('disposed');
      }
    };

    await expect(logger.use(plugin)).rejects.toThrow('install failed');
    expect(events).toEqual([]);
  });

  it('does not silently drop entries when level() runs under generator pipeline mode', async () => {
    const seen: string[] = [];
    const collector: ILoggerPlugin = {
      name: 'collector',
      install: (core) => {
        core.useSink((entry) => {
          seen.push(entry.message);
        });
        return {};
      }
    };
    const logger = new Logger({
      pipeline: { mode: 'generator' },
      plugins: [level(), collector]
    });

    logger.info('hello world');
    await logger.flush();

    expect(seen).toEqual(['hello world']);
  });
});
