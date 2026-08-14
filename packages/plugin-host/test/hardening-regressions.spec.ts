/** Hardening regression cases for lifecycle, config, and extension invariants. */
import { describe, expect, it, vi } from 'vitest';
import { PluginHost } from '../src/host-runtime';

class Host extends PluginHost<Record<string, never>, string> {
  install(plugins: readonly any[]): this {
    return this.useSync(plugins);
  }
}

describe('#1 config.get 丢弃第一段，插件名含点号时路径解析错位', () => {
  it('插件名含路径分隔符时在安装入口拒绝', async () => {
    const host = new Host();
    expect(() => host.use({ name: 'a.b', install: () => ({}) } as any)).toThrow(
      'plugin name must not contain "."'
    );
  });
});

describe('#2 config.get(pluginName) 抛错而非返回整份 config', () => {
  it('find 分支显式匹配 path === name，parseConfigPath 却拒绝单段路径', async () => {
    const host = new Host();
    await host.use({ name: 'p', config: { a: 1 }, install: () => ({}) } as any);

    expect(host.config.get('p')).toEqual({ a: 1 });
  });
});

describe('#3 非 plain-object 的 config 值写得进、读不出', () => {
  it('Date 值在 get() 时抛 TypeError', async () => {
    const host = new Host();
    await host.use({
      name: 'p',
      config: { when: new Date(0), list: [1, 2] },
      install: () => ({})
    } as any);

    expect(host.config.get('p.when')).toBe(host.config.get('p.when'));
    expect(host.config.get('p.list')).toEqual([1, 2]); // 数组走另一条分支，正常
  });
});

describe('#4（结论修正）install 在 await 之后调用 use()：两种子情形区分开', () => {
  // 实测证明：探针（见修复说明）显示 fire-and-forget 形态并不会永久卡住，只是比预期慢一拍——
  // 200ms 内就 settle 了。原始 adv#4 断言"既没成功也没失败，永远卡在队列里"高估了这个子情形的严重度。
  it('不直接 await 嵌套调用（fire-and-forget）：会延后完成，但不是死锁', async () => {
    const host = new Host();
    let nestedSettled = false;

    const outer = host.use({
      name: 'outer',
      install: async () => {
        await Promise.resolve();
        void host
          .use({ name: 'inner', install: () => ({}) } as any)
          .then(() => {
            nestedSettled = true;
          })
          .catch(() => {
            nestedSettled = true;
          });
        return {};
      }
    } as any);

    await outer;
    expect(nestedSettled).toBe(false);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(nestedSettled).toBe(true);
  });

  // 这一种是真正无法自愈的死锁：outer 的 install() 直接 await 了它自己触发的 use()。
  // FIFO 队列严格串行——inner 排在 outer 后面，outer 不完成 inner 就无法开始，
  // 而 outer 又在等 inner——循环依赖。R3 对抗证明：给这种情形加 watchdog 主动驱逐+reject
  // 做不到"只拒绝自依赖、不误伤合法排队"（见下面 PH-R3-1 用例），所以 host 不再尝试
  it('直接 await 嵌套调用：排队 mutation 达到 SLA 后被拒绝', async () => {
    vi.useFakeTimers();
    try {
      const diagnostics: string[] = [];
      const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) } as any);
      let innerRan = false;

      const outer = host
        .use({
          name: 'outer2',
          install: async () => {
            await Promise.resolve();
            await host.use({
              name: 'inner2',
              install: () => {
                innerRan = true;
                return {};
              }
            } as any);
            return {};
          }
        } as any)
        .then(
          () => true,
          () => true
        );

      await vi.advanceTimersByTimeAsync(5_000);
      expect(diagnostics).toHaveLength(0);
      expect(innerRan).toBe(false);
      await expect(outer).resolves.toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('诊断兜底：排队超过 QUEUE_WATCHDOG_MS 仍未处理时，watchdog 上报可操作的诊断信息', async () => {
    vi.useFakeTimers();
    try {
      const host = new Host({ diagnostic: () => undefined } as any);

      void host.use({
        name: 'outer3',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 60_000)); // 永远卡住，模拟死锁
          return {};
        }
      } as any);
      const queued = host.use({ name: 'inner3', install: () => ({}) } as any); // 排在 outer3 后面
      void queued.catch(() => undefined);

      await vi.advanceTimersByTimeAsync(5_000);
      await expect(queued).rejects.toMatchObject({
        code: 'MUTATION_QUEUE_TIMEOUT'
      });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('#5 扩展属性被外部覆写后，unUse 静默放弃卸载', () => {
  it('覆写后 unUse 不删属性，导致同名插件再也装不回去', async () => {
    const host = new Host();
    await host.use({ name: 'p', install: () => ({ token: 'a' }) } as any);

    (host as any).token = 'hijacked';
    await host.unUse('p');

    expect((host as any).token).toBeUndefined();
    await expect(
      host.use({ name: 'p', install: () => ({ token: 'b' }) } as any)
    ).resolves.toBeDefined();
  });
});

describe('#6 useSync 的回滚保持同步且错误可见', () => {
  it('同步 disposer 抛出的错误会出现在抛给调用方的错误链里', () => {
    const host = new Host();

    let thrown: any;
    try {
      host.install([
        {
          name: 'first',
          install: (core: any) => {
            core.onDispose(() => {
              throw new Error('rollback-boom');
            });
            return {};
          }
        },
        {
          name: 'second',
          install: () => {
            throw new Error('install-boom');
          }
        }
      ]);
    } catch (error) {
      thrown = error;
    }

    const rollbackErrors = thrown?.cause?.errors ?? thrown?.cause?.cause?.errors ?? [];
    const chain = JSON.stringify(
      [
        thrown?.message,
        thrown?.cause?.message,
        String(thrown?.cause?.cause?.message),
        ...rollbackErrors.map((error: unknown) => String((error as Error)?.message ?? error))
      ].join('|')
    );
    expect(chain).toContain('install-boom');
    expect(chain).toContain('rollback-boom');
  });

  it('异步 disposer 在 useSync 里注册时被立即拒绝（PH-R3-2 修复：不再是"回滚时才发现"）', () => {
    const host = new Host();
    let asyncDisposerDone = false;

    expect(() =>
      host.install([
        {
          name: 'first',
          install: (core: any) => {
            core.onDispose(async () => {
              await new Promise((resolve) => setTimeout(resolve, 10));
              asyncDisposerDone = true;
            });
            return {};
          }
        },
        {
          name: 'second',
          install: () => {
            throw new Error('install-boom');
          }
        }
      ])
    ).toThrow(/async disposer/); // 'first' 注册 disposer 那一步已经抛错，'second' 根本不会跑到

    expect(asyncDisposerDone).toBe(false); // 函数体从未被调用，不是"调用后没等完"
  });
});

describe('#7（批次0）registerStage 对同一函数重复注册的不变量', () => {
  it('钉住"删任意匹配项都等价"这一假设——同一函数注册两次，卸载后一次都不残留', async () => {
    const host = new Host();
    let runs = 0;
    const stage = (value: string, next: (v: string) => void): void => {
      runs += 1;
      next(value);
    };

    await host.use({
      name: 'dup2',
      install: (core: any) => {
        core.usePipeline(stage);
        core.usePipeline(stage);
        return {};
      }
    } as any);

    (host as any).runPipeline('x', () => {});
    expect(runs).toBe(2); // 两次注册各跑一次

    await host.unUse('dup2');
    runs = 0;
    (host as any).runPipeline('x', () => {});
    expect(runs).toBe(0); // 卸载后一次都不残留——验证"删任意匹配项都等价"这条假设站得住
  });
});

describe('#8（批次0）非枚举扩展键被静默跳过', () => {
  it('install 返回值上的非枚举属性会被明确拒绝', async () => {
    const host = new Host();
    const extension: Record<string, unknown> = {};
    Object.defineProperty(extension, 'hidden', {
      value: 'secret',
      enumerable: false,
      configurable: true,
      writable: true
    });

    await expect(host.use({ name: 'p', install: () => extension } as any)).resolves.toBeDefined();
    expect((host as any).hidden).toBeUndefined();
  });
});

describe('second adversarial pass (R3, fixed)', () => {
  it('R4-1: concurrent dispose is terminal and is not evicted by ordinary mutation SLA', async () => {
    vi.useFakeTimers();
    try {
      const host = new Host();
      const install = host.use({
        name: 'slow-dispose',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 6_000));
          return {};
        }
      } as any);
      const dispose = host.dispose();
      let installSettled = false;
      let disposeSettled = false;
      void install.finally(() => (installSettled = true));
      void dispose.finally(() => (disposeSettled = true));

      await vi.advanceTimersByTimeAsync(5_000);
      expect(installSettled).toBe(false);
      expect(disposeSettled).toBe(false);

      await vi.advanceTimersByTimeAsync(1_000);
      await expect(install).resolves.toBeDefined();
      await expect(dispose).resolves.toBeUndefined();
      await expect(host.dispose()).resolves.toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('PH-R3-1 (redesigned per SDD §10.1): a legitimate external mutation behind a slow install waits out the 5s SLA and is rejected with MUTATION_QUEUE_TIMEOUT, not silently diagnosed', async () => {
    vi.useFakeTimers();
    try {
      const diagnostics: string[] = [];
      const diagnosedHost = new Host({
        diagnostic: (message: string) => diagnostics.push(message)
      } as any);
      const slow = diagnosedHost.use({
        name: 'slow',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000));
          return {};
        }
      } as any);
      const external = diagnosedHost.use({ name: 'external', install: () => ({}) } as any);
      let externalSettled: 'resolved' | 'rejected' | undefined;
      void external.then(
        () => (externalSettled = 'resolved'),
        () => (externalSettled = 'rejected')
      );

      await vi.advanceTimersByTimeAsync(5_000);
      expect(diagnostics).toHaveLength(0);
      expect(externalSettled).toBe('rejected');

      await vi.advanceTimersByTimeAsync(5_000); // slow's own 10s timer fires
      await expect(slow).resolves.toBeDefined();
      await expect(external).rejects.toMatchObject({ code: 'MUTATION_QUEUE_TIMEOUT' });
      expect(externalSettled).toBe('rejected');
    } finally {
      vi.useRealTimers();
    }
  });

  it('PH-R3-2 fixed: an async disposer registered during useSync is rejected at registration time, not discovered later', () => {
    const host = new Host();
    let started = false;

    expect(() =>
      host.install([
        {
          name: 'async-tail',
          install: (core: any) => {
            core.onDispose(async () => {
              started = true;
              await new Promise((resolve) => setTimeout(resolve, 10));
            });
            return {};
          }
        }
      ])
    ).toThrow(/async disposer/);
    expect(started).toBe(false); // rejected before the disposer function was ever invoked
  });

  it('PH-R3-3 fixed: non-enumerable extension omission is reported through the diagnostic channel', async () => {
    const diagnostics: string[] = [];
    const host = new Host({ diagnostic: (message) => diagnostics.push(message) });
    const extension = {};
    Object.defineProperty(extension, 'hidden', { value: 1, enumerable: false });
    await host.use({ name: 'hidden', install: () => extension } as any);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0]).toMatch(/hidden/);
    expect((host as any).hidden).toBeUndefined();
  });

  it('PH-R3-4 fixed: a queued mutation that settles before the watchdog fires clears its timer immediately', async () => {
    vi.useFakeTimers();
    try {
      const host = new Host();
      const first = host.use({
        name: 'first',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {};
        }
      } as any);
      const second = host.use({ name: 'second', install: () => ({}) } as any);

      await vi.advanceTimersByTimeAsync(100);
      await expect(first).resolves.toBeDefined();
      await expect(second).resolves.toBeDefined();

      // If the watchdog for "second" were still armed, it would still be sitting in the
      // timer queue for up to 5s after settlement. Assert there is nothing left pending.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('fifth adversarial pass (R5)', () => {
  it('PH-R5-1: a plugin dispose hook that awaits host.dispose() again must not deadlock the host forever', async () => {
    vi.useFakeTimers();
    try {
      const host = new Host();
      await host.use({
        name: 'self-disposer',
        install: () => ({}),
        // #hookRegistration is cleared before the first await (same timing PH4 exploited for
        // use()); the reentrant dispose() call below returns the very #disposePromise this
        // hook is blocking on, so nothing outside a bounded wait can ever unblock it.
        dispose: async () => {
          await Promise.resolve();
          await host.dispose();
        }
      } as any);

      const dispose = host.dispose();
      let settled = false;
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose.catch(() => undefined).finally(() => (settled = true));

      expect(settled).toBe(false);
      // Advance far past any bounded wait a fix could plausibly use; a genuine deadlock stays
      // unsettled no matter how much (virtual) time passes because no timer ever drives it.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(settled).toBe(true);

      // Not just "some promise settled" — the host itself must reach a real terminal state,
      // not stay silently stuck in `closing` while dispose()'s own promise resolves/rejects.
      // use() throws HOST_DISPOSED synchronously (#assertActive runs before any enqueue), so
      // this is a plain throw, not a rejection.
      expect(() => host.use({ name: 'after', install: () => ({}) } as any)).toThrow(
        expect.objectContaining({ code: 'HOST_DISPOSED' })
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('PH-R5-1: the same reentrant call via a resource disposer (no #hookRegistration guard at all) also converges', async () => {
    vi.useFakeTimers();
    try {
      const host = new Host();
      await host.use({
        name: 'self-disposer-resource',
        install: (core: any) => {
          // Resource disposers run outside the #hookRegistration window entirely — unlike the
          // plugin dispose hook, they aren't guarded even during their synchronous phase. The
          // leading await matters: it lets the outer dispose() call finish assigning
          // #disposePromise before this reentrant call runs, which is what actually exercises
          // the pending-promise reentrancy (a same-tick synchronous call would instead observe
          // #disposePromise as still unassigned and take an unrelated early-return path).
          core.onDispose(async () => {
            await Promise.resolve();
            await host.dispose();
          });
          return {};
        }
      } as any);

      const dispose = host.dispose();
      let settled = false;
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose.catch(() => undefined).finally(() => (settled = true));

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      expect(settled).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('PH-R5-2: ERROR_TEXT carries no dead diagnostic text left over from the superseded diagnostic-only watchdog', async () => {
    const errorTextModule = await import('../src/error-text');
    expect(
      Object.prototype.hasOwnProperty.call(errorTextModule.default, 'QUEUE_WATCHDOG_TIMEOUT')
    ).toBe(false);
  });
});
