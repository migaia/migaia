import { describe, expect, it } from 'vitest'
import { runMigrations } from '../../src/schema/migrate'

describe('runMigrations', () => {
  it('拒绝非法版本，避免 Infinity 循环与整数精度丢失', async () => {
    for (const fromVersion of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(runMigrations({}, fromVersion, 1, undefined)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
    for (const toVersion of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      await expect(runMigrations({}, 0, toVersion, undefined)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
  })

  it('拒绝非法 migrations 容器、非函数步骤与伪造 signal', async () => {
    for (const migrations of [null, [], 'migrations', 1])
      await expect(runMigrations({}, 0, 1, migrations as never)).rejects.toMatchObject({
        code: 'INVALID_CONFIG'
      })
    await expect(runMigrations({}, 0, 1, { 1: 'invalid' } as never)).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    await expect(
      runMigrations({}, 0, 1, undefined, { aborted: false } as never)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
  })

  it('不执行 prototype 继承的 migration step', async () => {
    let calls = 0
    const migrations = Object.create({
      1: async () => {
        calls += 1
        return { changed: true }
      }
    }) as Record<number, (value: unknown) => Promise<unknown>>
    await expect(runMigrations({ changed: false }, 0, 1, migrations)).resolves.toEqual({
      changed: false
    })
    expect(calls).toBe(0)
  })
  it('fromVersion 已 >= toVersion 时直接返回原值，不执行任何迁移', async () => {
    const migration = async () => {
      throw new Error('should not run')
    }
    await expect(runMigrations({ a: 1 }, 2, 2, { 2: migration })).resolves.toEqual({ a: 1 })
    await expect(runMigrations({ a: 1 }, 3, 2, { 2: migration })).resolves.toEqual({ a: 1 })
  })

  it('按序执行 fromVersion+1 到 toVersion 的每一步迁移', async () => {
    const order: number[] = []
    const result = await runMigrations({ v: 0 }, 0, 3, {
      1: async (prev: any) => {
        order.push(1)
        return { v: prev.v + 1 }
      },
      2: async (prev: any) => {
        order.push(2)
        return { v: prev.v + 1 }
      },
      3: async (prev: any) => {
        order.push(3)
        return { v: prev.v + 1 }
      }
    })
    expect(order).toEqual([1, 2, 3])
    expect(result).toEqual({ v: 3 })
  })

  it('缺失某一版本的迁移函数视为 no-op，不中断链条', async () => {
    const result = await runMigrations({ v: 0 }, 0, 3, {
      1: async (prev: any) => ({ v: prev.v + 1 }),
      3: async (prev: any) => ({ v: prev.v + 10 })
    })
    expect(result).toEqual({ v: 11 })
  })

  it('migrations 为 undefined 时全部视为 no-op', async () => {
    await expect(runMigrations({ a: 1 }, 0, 3, undefined)).resolves.toEqual({ a: 1 })
  })

  it('迁移函数抛错时归一为 MIGRATION_FAILED', async () => {
    await expect(
      runMigrations({ v: 0 }, 0, 1, {
        1: async () => {
          throw new Error('boom')
        }
      })
    ).rejects.toMatchObject({ code: 'MIGRATION_FAILED' })
  })

  it('迁移函数收到正确的 fromVersion/toVersion 上下文', async () => {
    const contexts: Array<{ fromVersion: number; toVersion: number }> = []
    await runMigrations({}, 1, 3, {
      2: async (prev, ctx) => {
        contexts.push(ctx)
        return prev
      },
      3: async (prev, ctx) => {
        contexts.push(ctx)
        return prev
      }
    })
    expect(contexts).toEqual([
      { fromVersion: 1, toVersion: 2 },
      { fromVersion: 2, toVersion: 3 }
    ])
  })

  it('迁移函数未 settle 时 abort 能结束等待', async () => {
    const controller = new AbortController()
    const pending = runMigrations(
      { v: 0 },
      0,
      1,
      { 1: async () => new Promise<unknown>(() => {}) },
      controller.signal
    )
    await Promise.resolve()
    controller.abort('cancel hanging migration')
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('abort 发生在检查与 listener 注册之间时不会丢失', async () => {
    let aborted = false
    const signal = {
      get aborted() {
        return aborted
      },
      reason: 'race abort',
      addEventListener: () => {
        aborted = true
      },
      removeEventListener: () => {}
    }
    await expect(
      runMigrations({}, 0, 1, { 1: async () => new Promise<unknown>(() => {}) }, signal as never)
    ).rejects.toMatchObject({ code: 'ABORTED' })
  })

  it('listener setup 错误归一化且 cleanup 错误不覆盖 migration 结果', async () => {
    const setupCause = new Error('hostile migration listener setup')
    await expect(
      runMigrations({}, 0, 1, { 1: async () => ({ migrated: true }) }, {
        aborted: false,
        addEventListener: () => {
          throw setupCause
        },
        removeEventListener: () => {}
      } as never)
    ).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await expect(
      runMigrations({}, 0, 1, { 1: async () => ({ migrated: true }) }, {
        aborted: false,
        addEventListener: () => {},
        removeEventListener: () => {
          throw new Error('hostile migration listener cleanup')
        }
      } as never)
    ).resolves.toEqual({ migrated: true })
  })

  it('pre-abort 即使没有迁移步骤也返回 ABORTED', async () => {
    const controller = new AbortController()
    controller.abort('already cancelled')
    await expect(runMigrations({ v: 1 }, 1, 1, undefined, controller.signal)).rejects.toMatchObject(
      {
        code: 'ABORTED'
      }
    )
  })
})

it('将 operation signal 传给 migration context', async () => {
  const controller = new AbortController()
  let received: unknown
  await expect(
    runMigrations(
      { v: 0 },
      0,
      1,
      {
        1: async (value, context) => {
          received = context.signal
          return value
        }
      },
      controller.signal
    )
  ).resolves.toEqual({ v: 0 })
  expect(received).toBe(controller.signal)
})
