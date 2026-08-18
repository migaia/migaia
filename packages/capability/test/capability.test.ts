import { describe, expect, it, vi } from 'vitest';
import { createCapabilityHost, CapabilityErrorCode, type ICapabilityHandle } from '../src/index';

/**
 * 能力闸门的验收。
 *
 * 钉住的是「关闭」到底意味着什么：handle 真的被释放、失败留在关闭态、在途激活会被 回退作废、两个租户互不可见。这些恰恰是「关闭 = 不 import」给不了的东西。
 */

const handleOf = (dispose = vi.fn()): ICapabilityHandle & { dispose: typeof dispose } => ({
  dispose
});

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
};

/** 测试默认显式列出允许项，避免把「缺省放行」重新带回实现。 */
const enabledHost = <Context>(context: Context, ...names: string[]) =>
  createCapabilityHost(context, {
    flags: Object.fromEntries(names.map((name) => [name, true]))
  });

describe('能力闸门', () => {
  it('uses the disposer captured at adoption even if the public handle mutates', async () => {
    const original = vi.fn();
    const hijacked = vi.fn();
    const handle = { dispose: original };
    const host = enabledHost({}, 'x');
    host.register({ name: 'x', activate: () => handle });
    await host.enable('x');
    handle.dispose = hijacked;
    await host.disable('x');
    expect(original).toHaveBeenCalledOnce();
    expect(hijacked).not.toHaveBeenCalled();
  });

  it('invokes the captured disposer with the capability handle as receiver', async () => {
    const handle = {
      released: false,
      dispose() {
        this.released = true;
      }
    };
    const host = enabledHost({}, 'receiver');
    host.register({ name: 'receiver', activate: () => handle });
    await host.enable('receiver');
    await host.disable('receiver');
    expect(handle.released).toBe(true);
  });

  it('reads a hostile disposer getter exactly once', async () => {
    let reads = 0;
    let original = 0;
    let hijacked = 0;
    const handle: { readonly dispose: () => void } = {
      get dispose() {
        reads++;
        return reads === 1
          ? () => {
              original++;
            }
          : () => {
              hijacked++;
            };
      }
    };
    const host = enabledHost({}, 'hostile');
    host.register({ name: 'hostile', activate: () => handle });
    await host.enable('hostile');
    await host.disable('hostile');
    expect({ reads, original, hijacked }).toEqual({ reads: 1, original: 1, hijacked: 0 });
  });

  it('Round24 C-T01: classifies a throwing handle disposer getter and converges disable/dispose', async () => {
    const getterError = new Error('dispose getter failed');
    let reads = 0;
    const handle = {
      get dispose() {
        reads++;
        throw getterError;
      }
    };
    const reported: unknown[] = [];
    const host = createCapabilityHost(undefined, {
      flags: { hostile: true },
      onError: (_name, error) => reported.push(error)
    });
    host.register({ name: 'hostile', activate: () => handle as never });

    await expect(host.enable('hostile')).resolves.toEqual({
      status: 'failed',
      error: expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.invalidHandle,
        cause: getterError
      })
    });
    expect(reads).toBe(1);
    expect(host.handle('hostile')).toBeUndefined();
    expect(host.error('hostile')).toEqual(
      expect.objectContaining({ code: CapabilityErrorCode.invalidHandle, cause: getterError })
    );
    expect(reported).toEqual([
      expect.objectContaining({ code: CapabilityErrorCode.invalidHandle, cause: getterError })
    ]);

    await expect(host.disable('hostile')).resolves.toBe(false);
    await expect(host.dispose()).resolves.toBeUndefined();
    expect(host.state('hostile')).toBe('off');
    expect(host.handle('hostile')).toBeUndefined();
  });

  it('Round26 C-T02: rejects delayed disposer-origin dispose and reports once', async () => {
    let host!: ReturnType<typeof createCapabilityHost<undefined>>;
    let selfError: unknown;
    const reported: unknown[] = [];
    const disposer = vi.fn(async () => {
      try {
        host.dispose();
      } catch (error) {
        selfError = error;
      }
      await Promise.resolve();
      await host.dispose();
    });
    host = createCapabilityHost(undefined, {
      flags: { worker: true },
      onError: (_name, error) => reported.push(error)
    });
    host.register({
      name: 'worker',
      activate: () => ({ dispose: disposer })
    });
    await host.enable('worker');

    const first = host.dispose();
    expect(host.disposed).toBe(true);
    expect(selfError).toEqual(
      expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.hostTransitioning,
        message: 'capability host cannot mutate during a lifecycle transition'
      })
    );
    expect(disposer).toHaveBeenCalledOnce();

    await first;
    expect(reported).toEqual([
      expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.hostTransitioning
      })
    ]);
    expect(host.state('worker')).toBe('off');
    expect(host.handle('worker')).toBeUndefined();
    expect(host.dispose()).toBe(first);
    expect(disposer).toHaveBeenCalledOnce();
  });

  it('Round26 C-T03: rejects external in-progress dispose and reuses completed canonical Promise', async () => {
    const cleanup = deferred<void>();
    const disposer = vi.fn(() => cleanup.promise);
    const host = enabledHost(undefined, 'worker');
    host.register({ name: 'worker', activate: () => ({ dispose: disposer }) });
    await host.enable('worker');

    const first = host.dispose();
    const concurrent = host.dispose();
    expect(concurrent).not.toBe(first);
    await expect(concurrent).rejects.toEqual(
      expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.hostTransitioning
      })
    );

    cleanup.resolve();
    await expect(first).resolves.toBeUndefined();
    expect(host.dispose()).toBe(first);
  });

  it('preserves the existing report-and-resolve cleanup rejection semantics', async () => {
    const cleanupError = new Error('cleanup rejected');
    const onError = vi.fn();
    const host = createCapabilityHost<undefined>(undefined, {
      flags: { worker: true },
      onError
    });
    const disposer = vi.fn(async () => {
      throw cleanupError;
    });
    host.register({ name: 'worker', activate: () => ({ dispose: disposer }) });
    await host.enable('worker');

    const first = host.dispose();
    const second = host.dispose();
    await expect(second).rejects.toEqual(
      expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.hostTransitioning
      })
    );
    await expect(first).resolves.toBeUndefined();
    expect(disposer).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith('worker', cleanupError);
    expect(host.dispose()).toBe(first);
  });

  it('isolates dispose cleanup failures and converges every entry to off', async () => {
    const releaseOrder: string[] = [];
    const firstCleanupError = new Error('third cleanup failed');
    const secondCleanupError = new Error('second cleanup failed');
    const onError = vi.fn();
    const host = createCapabilityHost(undefined, {
      flags: { first: true, second: true, third: true },
      onError
    });
    host.register({
      name: 'first',
      activate: () => ({
        dispose: () => {
          releaseOrder.push('first');
        }
      })
    });
    host.register({
      name: 'second',
      activate: () => ({
        dispose: () => {
          releaseOrder.push('second');
          throw secondCleanupError;
        }
      })
    });
    host.register({
      name: 'third',
      activate: () => ({
        dispose: () => {
          releaseOrder.push('third');
          throw firstCleanupError;
        }
      })
    });

    await host.enable('first');
    await host.enable('second');
    await host.enable('third');

    const firstDispose = host.dispose();
    expect(host.disposed).toBe(true);
    await expect(host.dispose()).rejects.toEqual(
      expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.hostTransitioning
      })
    );
    await expect(firstDispose).resolves.toBeUndefined();

    expect(releaseOrder).toEqual(['third', 'second', 'first']);
    expect(onError.mock.calls).toEqual([
      ['third', firstCleanupError],
      ['second', secondCleanupError]
    ]);
    expect(host.error('third')).toBe(firstCleanupError);
    expect(host.error('second')).toBe(secondCleanupError);
    for (const name of ['first', 'second', 'third']) {
      expect(host.state(name)).toBe('off');
      expect(host.handle(name)).toBeUndefined();
    }
    expect(host.dispose()).toBe(firstDispose);
  });

  it('structured enable result and async disposal await cleanup', async () => {
    let released = false;
    const host = createCapabilityHost<unknown>({}, { flags: { worker: true } });
    host.register({
      name: 'worker',
      activate: () => ({
        dispose: async () => {
          await Promise.resolve();
          released = true;
        }
      })
    });
    expect(await host.enableResult('worker')).toEqual({
      status: 'enabled'
    });
    await host.dispose();
    expect(released).toBe(true);
  });
  it('dispose() waits for an activation still in flight, not just already-tracked releases', async () => {
    // The bug this guards: dispose() used to snapshot only
    // `pendingReleases` — a still-running activate() has no handle yet, so
    // it has nothing in that snapshot to await. It would resolve, then the
    // activation would finish *after*, creating a handle that gets released
    // invisibly to whoever awaited dispose().
    const activation = deferred<ICapabilityHandle>();
    const dispose = vi.fn();
    const host = enabledHost({}, 'worker');
    host.register({ name: 'worker', activate: () => activation.promise });

    const enabling = host.enable('worker');
    const disposing = host.dispose();
    // Let dispose() run its synchronous disposeSync() phase and enter
    // its wait loop before the activation settles.
    await Promise.resolve();
    activation.resolve(handleOf(dispose));

    await disposing;
    expect(dispose).toHaveBeenCalledTimes(1);
    await enabling;
  });

  it('publishes activation before synchronous activate disposal and waits for late cleanup', async () => {
    const cleanup = deferred<void>();
    const dispose = vi.fn(() => cleanup.promise);
    let internalDispose!: Promise<void>;
    let host!: ReturnType<typeof createCapabilityHost<undefined>>;
    host = enabledHost(undefined, 'worker');
    host.register({
      name: 'worker',
      activate: () => {
        internalDispose = host.dispose();
        return { dispose };
      }
    });

    const enabling = host.enable('worker');
    expect(host.disposed).toBe(true);
    await expect(host.dispose()).rejects.toEqual(
      expect.objectContaining({
        source: '@migaia/capability',
        code: CapabilityErrorCode.hostTransitioning
      })
    );

    let settled = false;
    void internalDispose.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    cleanup.resolve();
    await expect(internalDispose).resolves.toBeUndefined();
    await expect(enabling).resolves.toEqual({ status: 'cancelled' });
    expect(dispose).toHaveBeenCalledOnce();
    expect(host.state('worker')).toBe('off');
    expect(host.handle('worker')).toBeUndefined();
  });

  it("disable() waits for that entry's activation still in flight, not just already-tracked releases", async () => {
    const activation = deferred<ICapabilityHandle>();
    const dispose = vi.fn();
    const host = enabledHost({}, 'worker');
    host.register({ name: 'worker', activate: () => activation.promise });

    const enabling = host.enable('worker');
    const disabling = host.disable('worker');
    await Promise.resolve();
    activation.resolve(handleOf(dispose));

    await disabling;
    expect(dispose).toHaveBeenCalledTimes(1);
    await enabling;
    await host.dispose();
  });

  it('activates once no matter how many callers ask concurrently', async () => {
    const activate = vi.fn(async () => handleOf());
    const host = enabledHost({ tenant: 'a' }, 'persist');
    host.register({ name: 'persist', activate });

    const results = await Promise.all([
      host.enableLegacyBoolean('persist'),
      host.enableLegacyBoolean('persist'),
      host.enableLegacyBoolean('persist')
    ]);

    expect(results).toEqual([true, true, true]);
    expect(activate).toHaveBeenCalledTimes(1);
    expect(host.state('persist')).toBe('on');
    await host.dispose();
  });

  it('passes the host context into activation', async () => {
    const activate = vi.fn(async () => handleOf());
    const host = enabledHost({ tenant: 'acme' }, 'persist');
    host.register({ name: 'persist', activate });

    await host.enableLegacyBoolean('persist');

    expect(activate).toHaveBeenCalledWith({ tenant: 'acme' });
    await host.dispose();
  });

  it('snapshots registration identity and activation against caller mutation', async () => {
    const original = handleOf();
    const replacement = handleOf();
    const observedThisNames: string[] = [];
    const activateOriginal = vi.fn(async function (this: { name: string }) {
      observedThisNames.push(this.name);
      return original;
    });
    const activateReplacement = vi.fn(async () => replacement);
    const definition = {
      name: 'persist',
      activate: activateOriginal
    };
    const host = enabledHost(undefined, 'persist', 'worker');
    host.register(definition);

    definition.name = 'worker';
    definition.activate = activateReplacement;

    await expect(host.enableLegacyBoolean('persist')).resolves.toBe(true);
    expect(activateOriginal).toHaveBeenCalledOnce();
    expect(observedThisNames).toEqual(['persist']);
    expect(activateReplacement).not.toHaveBeenCalled();
    host.setFlag('persist', false);
    expect(host.state('persist')).toBe('gated');
    expect(original.dispose).toHaveBeenCalledOnce();
    expect(() => host.state('worker')).toThrow('not registered');
    await host.dispose();
  });

  it('rejects malformed registrations before they enter the name table', async () => {
    const host = enabledHost(undefined, 'valid');

    expect(() => host.register({ name: '   ', activate: async () => handleOf() })).toThrow(
      'name must be a non-empty string'
    );
    expect(() =>
      host.register({
        name: 'valid',
        activate: undefined
      } as never)
    ).toThrow('activate must be a function');
    expect(host.names).toEqual([]);
    await host.dispose();
  });

  it('disposes the handle exactly once when disabled, and re-activates fresh', async () => {
    const first = handleOf();
    const second = handleOf();
    const handles = [first, second];
    const host = enabledHost(undefined, 'persist');
    host.register({
      name: 'persist',
      activate: async () => handles.shift() as ICapabilityHandle
    });

    await host.enableLegacyBoolean('persist');
    expect(host.disableNow('persist')).toBe(true);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    // 关闭一个已关闭的能力不是错误，但也不该再释放一次
    expect(host.disableNow('persist')).toBe(false);
    expect(first.dispose).toHaveBeenCalledTimes(1);

    await host.enableLegacyBoolean('persist');
    expect(host.handle('persist')).toBe(second);
    await host.dispose();
    expect(second.dispose).toHaveBeenCalledTimes(1);
  });

  it('stays off when activation fails, and keeps the reason', async () => {
    const onError = vi.fn();
    const host = createCapabilityHost(undefined, {
      flags: { worker: true },
      onError
    });
    host.register({
      name: 'worker',
      activate: async () => {
        throw new Error('chunk 404');
      }
    });

    await expect(host.enableLegacyBoolean('worker')).resolves.toBe(false);
    // 「半开」是最坏的结果：调用方以为能用，实际没有 handle
    expect(host.state('worker')).toBe('failed');
    expect(host.handle('worker')).toBeUndefined();
    expect(String(host.error('worker'))).toContain('chunk 404');
    expect(onError).toHaveBeenCalledTimes(1);
    // 失败不影响 host 本身
    expect(host.disposed).toBe(false);
    await host.dispose();
  });

  it('refuses to enable what the flags turned off, which is the rollback path', async () => {
    const activate = vi.fn(async () => handleOf());
    const host = createCapabilityHost(undefined);
    host.register({ name: 'devtools', activate });

    await expect(host.enableLegacyBoolean('devtools')).resolves.toBe(false);
    expect(activate).not.toHaveBeenCalled();
    expect(host.state('devtools')).toBe('gated');
    await host.dispose();
  });

  it('uses own-property allowlisting without invoking getters or the prototype chain', async () => {
    const getter = vi.fn(() => true);
    const flags = Object.create({ inherited: true }) as Record<string, boolean>;
    Object.defineProperty(flags, 'getter', {
      enumerable: true,
      get: getter
    });
    flags.persist = true;

    const host = createCapabilityHost(undefined, { flags });
    flags.persist = false;
    for (const name of ['persist', 'inherited', 'getter', '__proto__']) {
      host.register({ name, activate: async () => handleOf() });
    }

    expect(getter).not.toHaveBeenCalled();
    expect(host.state('persist')).toBe('off');
    expect(host.state('inherited')).toBe('gated');
    expect(host.state('getter')).toBe('gated');
    expect(host.state('__proto__')).toBe('gated');

    // Map 保存 flag：危险键名只是普通字符串，不会落到 Object.prototype。
    host.setFlag('__proto__', true);
    expect(host.state('__proto__')).toBe('off');
    await expect(host.enableLegacyBoolean('__proto__')).resolves.toBe(true);
    await host.dispose();
  });

  it('fails closed when a replacement flag snapshot cannot be inspected', async () => {
    const handle = handleOf();
    const host = enabledHost(undefined, 'persist');
    host.register({ name: 'persist', activate: async () => handle });
    await host.enableLegacyBoolean('persist');
    const unreadable = new Proxy({} as Record<string, boolean>, {
      ownKeys() {
        throw new Error('flag service payload is unreadable');
      }
    });

    expect(() => host.setFlags(unreadable)).toThrow(
      expect.objectContaining({
        code: CapabilityErrorCode.invalidOption,
        cause: expect.objectContaining({ message: 'flag service payload is unreadable' })
      })
    );
    expect(host.state('persist')).toBe('gated');
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    await expect(host.enableLegacyBoolean('persist')).resolves.toBe(false);
    await host.dispose();
  });

  it('turns setFlag(false) into an atomic rollback and can explicitly reopen', async () => {
    const first = handleOf();
    const second = handleOf();
    const activate = vi
      .fn<() => Promise<ICapabilityHandle>>()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second);
    const host = enabledHost(undefined, 'persist');
    host.register({ name: 'persist', activate });

    await host.enableLegacyBoolean('persist');
    host.setFlag('persist', false);
    expect(first.dispose).toHaveBeenCalledTimes(1);
    expect(host.state('persist')).toBe('gated');
    await expect(host.enableLegacyBoolean('persist')).resolves.toBe(false);

    host.setFlag('persist', true);
    expect(host.state('persist')).toBe('off');
    await expect(host.enableLegacyBoolean('persist')).resolves.toBe(true);
    expect(host.handle('persist')).toBe(second);
    await host.dispose();
  });

  it('replaces the complete flag snapshot so an omitted old allow cannot survive', async () => {
    const persist = handleOf();
    const worker = handleOf();
    const host = enabledHost(undefined, 'persist', 'worker');
    host.register({ name: 'persist', activate: async () => persist });
    host.register({ name: 'worker', activate: async () => worker });
    await Promise.all([host.enableLegacyBoolean('persist'), host.enableLegacyBoolean('worker')]);

    host.setFlags({ worker: true });

    expect(host.state('persist')).toBe('gated');
    expect(persist.dispose).toHaveBeenCalledTimes(1);
    expect(host.state('worker')).toBe('on');
    expect(worker.dispose).not.toHaveBeenCalled();
    await host.dispose();
  });

  it('releases a multi-flag rollback in reverse activation order', async () => {
    const order: string[] = [];
    const host = enabledHost(undefined, 'foundation', 'dependent');
    // Registration order deliberately differs from activation order.
    host.register({
      name: 'dependent',
      activate: async () => ({
        dispose: () => {
          order.push('dependent');
        }
      })
    });
    host.register({
      name: 'foundation',
      activate: async () => ({
        dispose: () => {
          order.push('foundation');
        }
      })
    });
    await host.enableLegacyBoolean('foundation');
    await host.enableLegacyBoolean('dependent');

    host.setFlags({});

    expect(order).toEqual(['dependent', 'foundation']);
    expect(host.state('foundation')).toBe('gated');
    expect(host.state('dependent')).toBe('gated');
    await host.dispose();
  });

  it('contains a later disposer failure and still completes LIFO rollback', async () => {
    const order: string[] = [];
    const onError = vi.fn();
    const host = createCapabilityHost(undefined, {
      flags: { foundation: true, dependent: true },
      onError
    });
    host.register({
      name: 'foundation',
      activate: async () => ({
        dispose: () => {
          order.push('foundation');
        }
      })
    });
    host.register({
      name: 'dependent',
      activate: async () => ({
        dispose: () => {
          order.push('dependent');
          throw new Error('dependent cleanup failed');
        }
      })
    });
    await host.enableLegacyBoolean('foundation');
    await host.enableLegacyBoolean('dependent');

    expect(() => host.setFlags({})).not.toThrow();

    expect(order).toEqual(['dependent', 'foundation']);
    expect(host.state('dependent')).toBe('gated');
    expect(host.state('foundation')).toBe('gated');
    expect(onError).toHaveBeenCalledWith(
      'dependent',
      expect.objectContaining({ message: 'dependent cleanup failed' })
    );
    await host.dispose();
  });

  it('rejects disposer reentry without letting it rewrite the outer flag snapshot', async () => {
    let host!: ReturnType<typeof createCapabilityHost<undefined>>;
    let enableDuringDispose: Promise<boolean> | undefined;
    const reentryErrors: unknown[] = [];
    host = enabledHost(undefined, 'persist');
    host.register({
      name: 'persist',
      activate: async () => ({
        dispose() {
          for (const mutation of [
            () => host.setFlag('persist', true),
            () => host.setFlags({ persist: true }),
            () => host.disableNow('persist')
          ]) {
            try {
              mutation();
            } catch (error) {
              reentryErrors.push(error);
            }
          }
          enableDuringDispose = host.enableLegacyBoolean('persist');
        }
      })
    });
    await host.enableLegacyBoolean('persist');

    host.setFlags({});

    expect(reentryErrors).toHaveLength(3);
    for (const error of reentryErrors) {
      expect(error).toEqual(
        expect.objectContaining({
          message: 'capability host cannot mutate during a lifecycle transition'
        })
      );
    }
    await expect(enableDuringDispose).rejects.toThrow('lifecycle transition');
    expect(host.state('persist')).toBe('gated');
    expect(host.handle('persist')).toBeUndefined();
    await expect(host.enableLegacyBoolean('persist')).resolves.toBe(false);
    await host.dispose();
  });

  it('contains disposal and reporter errors when an in-flight activation is revoked', async () => {
    const disposeError = new Error('late handle failed to dispose');
    const reporterError = new Error('reporter failed');
    const onError = vi.fn(() => {
      throw reporterError;
    });
    const gate = deferred<ICapabilityHandle>();
    const host = createCapabilityHost(undefined, {
      flags: { worker: true },
      onError
    });
    host.register({ name: 'worker', activate: () => gate.promise });

    const enabling = host.enableLegacyBoolean('worker');
    host.setFlag('worker', false);
    gate.resolve({
      dispose() {
        throw disposeError;
      }
    });

    await expect(enabling).resolves.toBe(false);
    expect(host.state('worker')).toBe('gated');
    expect(host.error('worker')).toBe(disposeError);
    expect(onError).toHaveBeenCalledWith('worker', disposeError);
    await host.dispose();
  });

  it('contains async disposal and reporter rejections during rollback', async () => {
    const disposeError = new Error('async dispose failed');
    const reporterError = new Error('async reporter failed');
    const onError = vi.fn(async () => {
      throw reporterError;
    });
    const host = createCapabilityHost(undefined, {
      flags: { worker: true },
      onError
    });
    host.register({
      name: 'worker',
      activate: async () => ({
        async dispose() {
          throw disposeError;
        }
      })
    });

    await expect(host.enableLegacyBoolean('worker')).resolves.toBe(true);
    host.setFlag('worker', false);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(host.state('worker')).toBe('gated');
    expect(host.error('worker')).toBe(disposeError);
    expect(onError).toHaveBeenCalledWith('worker', disposeError);
    await host.dispose();
  });

  it('reports a stale async cleanup failure without poisoning a replacement generation', async () => {
    const cleanup = deferred<void>();
    const reported = deferred<void>();
    const cleanupError = new Error('old generation cleanup failed');
    const onError = vi.fn(() => reported.resolve(undefined));
    const replacement = handleOf();
    const activate = vi
      .fn<() => Promise<ICapabilityHandle>>()
      .mockResolvedValueOnce({
        dispose: async () => {
          await cleanup.promise;
          throw cleanupError;
        }
      })
      .mockResolvedValueOnce(replacement);
    const host = createCapabilityHost(undefined, {
      flags: { worker: true },
      onError
    });
    host.register({ name: 'worker', activate });
    await host.enableLegacyBoolean('worker');

    host.setFlag('worker', false);
    host.setFlag('worker', true);
    await expect(host.enableLegacyBoolean('worker')).resolves.toBe(true);
    cleanup.resolve(undefined);
    await reported.promise;

    expect(host.state('worker')).toBe('on');
    expect(host.handle('worker')).toBe(replacement);
    expect(host.error('worker')).toBeUndefined();
    expect(onError).toHaveBeenCalledWith('worker', cleanupError);
    await host.dispose();
  });

  it('does not let a superseded activation cleanup poison the replacement', async () => {
    const staleActivation = deferred<ICapabilityHandle>();
    const cleanup = deferred<void>();
    const cleanupError = new Error('superseded activation cleanup failed');
    const replacement = handleOf();
    const onError = vi.fn();
    const activate = vi
      .fn<() => Promise<ICapabilityHandle>>()
      .mockReturnValueOnce(staleActivation.promise)
      .mockResolvedValueOnce(replacement);
    const host = createCapabilityHost(undefined, {
      flags: { worker: true },
      onError
    });
    host.register({ name: 'worker', activate });

    const staleEnable = host.enableLegacyBoolean('worker');
    host.disableNow('worker');
    await expect(host.enableLegacyBoolean('worker')).resolves.toBe(true);
    staleActivation.resolve({
      dispose: async () => {
        await cleanup.promise;
        throw cleanupError;
      }
    });
    await expect(staleEnable).resolves.toBe(false);
    cleanup.resolve(undefined);
    await vi.waitFor(() => {
      expect(onError).toHaveBeenCalledWith('worker', cleanupError);
    });

    expect(host.state('worker')).toBe('on');
    expect(host.handle('worker')).toBe(replacement);
    expect(host.error('worker')).toBeUndefined();
    await host.dispose();
  });

  it('reads a disposal then getter only once', async () => {
    const failure = new Error('thenable cleanup failed');
    const getThen = vi.fn(
      () => (_resolve: (value: unknown) => void, reject: (error: unknown) => void) =>
        reject(failure)
    );
    const host = enabledHost(undefined, 'worker');
    host.register({
      name: 'worker',
      activate: async () => ({
        dispose() {
          // oxlint-disable-next-line unicorn/no-thenable -- test hostile then getter handling.
          return Object.defineProperty({}, 'then', {
            get: getThen
          }) as never;
        }
      })
    });

    await host.enableLegacyBoolean('worker');
    host.setFlag('worker', false);
    await Promise.resolve();

    expect(getThen).toHaveBeenCalledTimes(1);
    expect(host.error('worker')).toBe(failure);
    await host.dispose();
  });

  it('contains activation reporter errors and rejects malformed handles as failures', async () => {
    const onError = vi.fn(() => {
      throw new Error('reporter failed');
    });
    const host = createCapabilityHost(undefined, {
      flags: { malformed: true },
      onError
    });
    host.register({
      name: 'malformed',
      activate: async () => null as unknown as ICapabilityHandle
    });

    await expect(host.enableLegacyBoolean('malformed')).resolves.toBe(false);
    expect(host.state('malformed')).toBe('failed');
    expect(String(host.error('malformed'))).toContain('invalid handle');
    expect(onError).toHaveBeenCalledTimes(1);
    await host.dispose();
  });

  it('discards an in-flight activation that was disabled meanwhile', async () => {
    // 回退最难的一格：开关已经翻回去了，而上一次激活的动态 import 才刚落地。
    // 采纳那个结果等于「关掉的能力几毫秒后自己回来」。
    const gate = deferred<ICapabilityHandle>();
    const handle = handleOf();
    const host = enabledHost(undefined, 'persist');
    host.register({ name: 'persist', activate: () => gate.promise });

    const enabling = host.enableLegacyBoolean('persist');
    expect(host.state('persist')).toBe('activating');
    host.disableNow('persist');
    gate.resolve(handle);

    await expect(enabling).resolves.toBe(false);
    expect(host.state('persist')).toBe('off');
    expect(host.handle('persist')).toBeUndefined();
    // 作废不等于泄漏：刚建出来的东西要就地释放
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    await host.dispose();
  });

  it('discards an in-flight activation that the host outlived', async () => {
    const gate = deferred<ICapabilityHandle>();
    const handle = handleOf();
    const host = enabledHost(undefined, 'persist');
    host.register({ name: 'persist', activate: () => gate.promise });

    const enabling = host.enableLegacyBoolean('persist');
    const disposing = host.dispose();
    gate.resolve(handle);

    await disposing;
    await expect(enabling).resolves.toBe(false);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
  });

  it('keeps two tenants from seeing each other', async () => {
    const left = enabledHost({ tenant: 'left' }, 'persist');
    const right = createCapabilityHost(
      { tenant: 'right' },
      {
        flags: { persist: false }
      }
    );
    left.register({ name: 'persist', activate: async () => handleOf() });
    right.register({ name: 'persist', activate: async () => handleOf() });

    await left.enable('persist');
    await right.enable('persist');

    expect(left.state('persist')).toBe('on');
    expect(right.state('persist')).toBe('gated');
    left.dispose();
    right.dispose();
  });

  it('disposes in reverse activation order', async () => {
    const order: string[] = [];
    const host = enabledHost(undefined, 'persist', 'devtools', 'worker');
    for (const name of ['persist', 'devtools', 'worker']) {
      host.register({
        name,
        activate: async () => ({
          dispose: () => {
            order.push(name);
          }
        })
      });
    }

    await host.enableLegacyBoolean('worker');
    await host.enableLegacyBoolean('persist');
    await host.enableLegacyBoolean('devtools');
    await host.dispose();

    expect(order).toEqual(['devtools', 'persist', 'worker']);
    expect(host.disposed).toBe(true);
  });

  it('rejects unknown names and double registration instead of guessing', async () => {
    const host = enabledHost(undefined, 'persist');
    host.register({ name: 'persist', activate: async () => handleOf() });

    expect(() => host.register({ name: 'persist', activate: async () => handleOf() })).toThrow(
      'already registered'
    );
    expect(() => host.state('nope')).toThrow('not registered');
    await expect(host.enableLegacyBoolean('nope')).rejects.toThrow('not registered');

    await host.dispose();
    // enable 是 async：释放后的调用以 rejection 形态报错，不是同步抛
    await expect(host.enableLegacyBoolean('persist')).rejects.toThrow('disposed');
  });

  it('supports a lazily imported capability, which is the whole point', async () => {
    // 体积只在这条路上才真的省下来：关着的时候这个模块不进初始包。
    // 闸门保证的是时机、失败与竞态，省体积的是打包器。
    const load = vi.fn(async () => ({
      install: () => ({ dispose: vi.fn() })
    }));
    const host = enabledHost(undefined, 'persist');
    host.register({
      name: 'persist',
      activate: async () => (await load()).install()
    });

    expect(load).not.toHaveBeenCalled();
    await host.enableLegacyBoolean('persist');
    expect(load).toHaveBeenCalledTimes(1);
    await host.dispose();
  });

  it('primary lifecycle methods expose structured and awaitable semantics', async () => {
    let released = false;
    const host = enabledHost(undefined, 'persist');
    host.register({
      name: 'persist',
      activate: async () => ({
        dispose: async () => {
          await Promise.resolve();
          released = true;
        }
      })
    });
    expect(await host.enable('persist')).toEqual({ status: 'enabled' });
    await host.disable('persist');
    expect(released).toBe(true);
    await host.dispose();
  });
});
