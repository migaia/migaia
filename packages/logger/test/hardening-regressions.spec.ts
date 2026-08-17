/** Hardening regression cases for logger lifecycle and dispatch invariants. */
import { describe, expect, it, vi } from 'vitest';
import { Logger } from '../src/log';
import { batch } from '../src/plugins/batch';
import { boundedWait as waitUntil, systemScheduler } from '@migaia/lifecycle';
import type { ILogEntry } from '../src/typing';

describe('#1 shutting-down 期间 raw() 拒绝但 dispatchRaw() 照收', () => {
  it('两条入口对同一状态的判定不一致', async () => {
    const seen: string[] = [];
    const log: any = new Logger();
    log.useSink((entry: ILogEntry) => {
      seen.push(entry.message);
    });
    log.onShutdown(async () => {
      // shutdown 已把状态置为 shutting-down
      log.raw('raw-during-shutdown');
      log.log('t', 'dispatch-during-shutdown');
    });

    await log.shutdown('manual');
    expect(seen).toContain('dispatch-during-shutdown'); // 被接收
  });
});

describe('#2 sink 在派发中注销自己会跳过下一个 sink', () => {
  it('#sinks 是活数组，splice 使 for...of 漏项', () => {
    const called: string[] = [];
    const log: any = new Logger();
    const off = log.useSink(() => {
      called.push('a');
      off();
    });
    log.useSink(() => called.push('b'));
    log.useSink(() => called.push('c'));

    log.log('t', 'x');
    expect(called).toEqual(['a', 'b', 'c']);
  });
});

describe('#3 ctx 的「逐层冻结」声明不成立', () => {
  it('createdAt 与 options 的嵌套值仍可被插件改写', () => {
    const nested = { flag: true };
    const log: any = new Logger({ options: { nested } });

    log.ctx.createdAt.setTime(0);
    expect(log.ctx.createdAt.getTime()).toBe(0);

    (log.ctx.options.nested as any).flag = false;
    expect(nested.flag).toBe(false);
  });
});

describe('#4 用户可控的 data.extendPath 能关掉 extends 转发', () => {
  it('调用方伪造 extendPath 即可让目标收不到日志', () => {
    const target: any = new Logger({ topic: 'target' });
    const received: string[] = [];
    target.useSink((entry: ILogEntry) => received.push(entry.message));

    const source: any = new Logger({ topic: 'source' });
    source.extends(target);

    source.dispatchRaw({ tag: 't', message: 'normal' });
    expect(received).toEqual(['normal']);

    source.dispatchRaw({
      tag: 't',
      message: 'suppressed',
      data: { extendPath: [target.ctx.id] }
    });
    expect(received).toEqual(['normal', 'suppressed']);
  });
});

describe('#5 onFlush 处理器在一次 flush() 里被调用多次', () => {
  it('flusher 自身产生 pending 时循环会重跑 flusher', async () => {
    const log: any = new Logger();
    let flusherCalls = 0;
    let scheduled = false;

    log.onFlush(async () => {
      flusherCalls += 1;
      if (!scheduled) {
        scheduled = true;
        log.defer(async () => {
          await new Promise((resolve) => setTimeout(resolve, 5));
        });
      }
    });

    await log.flush();
    expect(flusherCalls).toBe(1);
  });
});

describe('#6 shutdown 失败会把实例卡在 shutting-down', () => {
  it('插件 dispose 抛错后 shutdown 永久 reject，且实例仍接受日志', async () => {
    const log: any = new Logger({
      plugins: [
        {
          name: 'boom',
          install: () => ({}),
          dispose: () => {
            throw new Error('dispose-boom');
          }
        }
      ]
    });
    const seen: string[] = [];
    log.useSink((entry: ILogEntry) => seen.push(entry.message));

    const failures: unknown[] = [];
    log.onFailure((failure: unknown) => failures.push(failure));

    await expect(log.shutdown('manual')).rejects.toThrow();

    // Failed shutdown is terminal and must not route entries into a disposed host.
    log.log('t', 'after-failed-shutdown');
    expect(seen).toEqual([]);
    expect(failures).toHaveLength(0);

    // 再次 shutdown 只是拿到同一个已 reject 的 promise，无法恢复
    await expect(log.shutdown('manual')).resolves.toBeUndefined();
  });
});

describe('#7（批次0）fireHook 遍历活数组，派发期间新注册的 hook 会在本轮内被调用', () => {
  it('hook A 在自己的回调里注册 hook B，B 在同一轮 fireHook 内就被执行', () => {
    const log: any = new Logger();
    const order: string[] = [];

    log.hook('custom', () => {
      order.push('a');
      log.hook('custom', () => order.push('b'));
    });

    log.fireHook('custom', {});
    expect(order).toEqual(['a', 'b']); // 当前实现：B 参与了本轮，而非要等下一次 fireHook
  });
});

describe('#8（批次0）#snapshotEntry 只隔离 sink，"after" hook 的变更能泄漏进 extends 转发', () => {
  it('sink 拿到派发前的快照，extends 目标拿到 after-hook 修改之后的值', () => {
    const target: any = new Logger({ topic: 'target' });
    const forwarded: unknown[] = [];
    target.useSink((entry: ILogEntry) => forwarded.push((entry.data as any).injected));

    const source: any = new Logger({ topic: 'source' });
    const sourceSeen: unknown[] = [];
    source.useSink((entry: ILogEntry) => sourceSeen.push((entry.data as any).injected));
    source.extends(target);

    source.hook('after', (entry: ILogEntry) => {
      (entry.data as Record<string, unknown>).injected = 'mutated-by-after-hook';
    });

    source.dispatchRaw({ tag: 't', message: 'x' });

    expect(sourceSeen).toEqual([undefined]); // sink 已经在 after hook 跑之前拿到快照，看不到这次修改
    expect(forwarded).toEqual(['mutated-by-after-hook']); // 但 extends 转发发生在 after hook 之后，泄漏了
  });
});

describe('second adversarial pass', () => {
  it('LG-R4-1: batch flush returns after deadline when onBatch never settles', async () => {
    vi.useFakeTimers();
    try {
      const log: any = new Logger({ plugins: [batch()] });
      const createBatcher = log.getShared('createBatcher');
      const batcher = createBatcher({ maxSize: 1 }, () => new Promise<void>(() => undefined));
      batcher.push('stuck');
      const pending = batcher.flush();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('LG-R4-2: one flush shares one absolute deadline across phases and extends targets', async () => {
    vi.useFakeTimers();
    try {
      const log: any = new Logger();
      log.extends({
        ctx: { id: 'never-flush', topic: 'target' },
        dispatchRaw: () => undefined,
        flush: () => new Promise<void>(() => undefined)
      });
      const pending = log.flush();
      await vi.advanceTimersByTimeAsync(3_000);
      await expect(pending).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('flush deadline cannot interrupt a never-settling tracked sink', async () => {
    const log: any = new Logger();
    log.useSink(() => new Promise<void>(() => undefined));
    log.log('t', 'never');
    const outcome = await Promise.race([
      log.flush().then(() => 'flushed'),
      new Promise<string>((resolve) => setTimeout(() => resolve('still-pending'), 20))
    ]);
    expect(outcome).toBe('still-pending');
  });

  it('LG-R3-2 fixed: cross-realm-style thenables (not instanceof Promise) are tracked by flush', async () => {
    const log: any = new Logger();
    let settled = false;
    log.useSink(
      () =>
        ({
          // oxlint-disable-next-line unicorn/no-thenable -- models a Promise from another realm.
          then(resolve: () => void) {
            setTimeout(() => {
              settled = true;
              resolve();
            }, 20);
          }
        }) as any
    );
    log.log('t', 'thenable');
    await log.flush();
    expect(settled).toBe(true); // flush() now waits for the thenable instead of missing it entirely
  });

  it('LG-R3-3 fixed: reentrant shutdown() calls alias to the same in-flight promise instead of starting a second pass', async () => {
    const log: any = new Logger();
    let calls = 0;
    let reentrantPromise: Promise<void> | undefined;
    log.onShutdown(() => {
      calls += 1;
      // Fire reentrantly but do not await it here — a handler awaiting the very shutdown
      // promise its own execution is a step of is a self-reference no implementation can
      // resolve (same class of misuse as a plugin-host install() awaiting its own nested
      // use() call). What this test verifies is that the reentrant call is recognized as
      // "already in flight" and aliases to the same promise, rather than kicking off an
      // independent second pass that would run every handler again.
      reentrantPromise = log.shutdown('manual');
    });

    const outer = log.shutdown('manual');
    expect(reentrantPromise).toBe(outer);
    await outer;
    expect(calls).toBe(1); // the handler ran exactly once, not twice
  });

  it('runtime extend guard does not propagate through a structural logger target', () => {
    const source: any = new Logger({ topic: 'source' });
    let deliveries = 0;
    const structuralTarget: any = {
      ctx: { id: 'structural', topic: 'target' },
      dispatchRaw() {
        deliveries += 1;
        if (deliveries === 1) source.log('loop', 'again');
      }
    };
    source.extends(structuralTarget);
    source.log('loop', 'first');
    expect(deliveries).toBe(2);
  });
});

describe('fifth adversarial pass', () => {
  it('LG-R5-1: a never-settling onShutdown handler no longer blocks shutdown() past the shared deadline', async () => {
    // #drain()/flusher()/extends-target waits are all bounded by an absolute deadline (LG-R3-1,
    // LG-R4-2/3). The onShutdown handler loop that runs *before* any of that was still a raw,
    // unbounded `await handler(reason)` — a handler shaped like "flush a client then resolve" that
    // has a bug and never settles hangs shutdown() forever, the exact failure mode already closed
    // for every other pending source.
    vi.useFakeTimers();
    try {
      const log: any = new Logger();
      log.onShutdown(() => new Promise<void>(() => undefined));
      const pending = log.shutdown('manual');
      let settled = false;
      void pending.then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(3_000);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('LG-R5-1: shutdown handlers registered after a stuck one are still invoked, only their wait is bounded', async () => {
    vi.useFakeTimers();
    try {
      const log: any = new Logger();
      const order: string[] = [];
      log.onShutdown(() => {
        order.push('stuck-start');
        return new Promise<void>(() => undefined);
      });
      log.onShutdown(() => {
        order.push('second');
      });
      const pending = log.shutdown('manual');
      await vi.advanceTimersByTimeAsync(3_000);
      await pending;
      expect(order).toEqual(['stuck-start', 'second']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('LG-R5-2: waitUntil clears its deadline timer once the raced task settles first', async () => {
    vi.useFakeTimers();
    try {
      await waitUntil(Promise.resolve('done'), systemScheduler.now() + 3_000);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('LG-R5-2: #drain clears its per-round deadline timer once pending work settles before the deadline', async () => {
    vi.useFakeTimers();
    try {
      const log: any = new Logger();
      log.useSink(() => Promise.resolve());
      log.log('t', 'x');
      await log.flush();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('LG-R5-3: waitUntil must observe a task even when the deadline has already elapsed, or a later rejection goes unhandled', async () => {
    // Every waitUntil() call site (flusher loop, extends-target loop, and the LG-R5-1 shutdown
    // handler loop) can be reached *after* #drain() has already burned the whole deadline — at
    // that point waitUntil's early "deadline already elapsed" branch returns false without ever
    // touching `task`. If the caller built that task fresh (e.g. `Promise.resolve(handler(reason))`)
    // instead of passing an already-tracked/observed promise, an eventual rejection on it becomes a
    // genuine Node unhandledRejection instead of flowing into the caller's failure-reporting path.
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const rejecting = Promise.reject(new Error('boom-after-deadline'));
      const alreadyElapsed = systemScheduler.now() - 1;
      const result = await waitUntil(rejecting, alreadyElapsed);
      expect(result).toBe(false);
      // Give Node's unhandledRejection detector (queued for a later tick) a chance to fire.
      await new Promise((resolve) => setTimeout(resolve, 10));
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
    expect(unhandled).toEqual([]);
  });
});
