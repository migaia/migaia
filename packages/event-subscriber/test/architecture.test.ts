import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('runtime-neutral boundary', () => {
  it('ships side-effect-free admitted entries with only the utils foundation dependency', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly sideEffects?: boolean
      readonly dependencies?: Record<string, string>
      readonly exports?: Record<string, unknown>
    }
    expect(manifest.sideEffects).toBe(false)
    expect(manifest.dependencies ?? {}).toEqual({ '@migaia/utils': 'workspace:^' })
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.', './subscriber'])
  })

  it('confines host scheduler access to the terminal adapter', () => {
    const sourceRoot = resolve(import.meta.dirname, '../src')
    const sourceFiles = (directory: string): string[] =>
      readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
        const entryPath = resolve(directory, entry.name)
        return entry.isDirectory()
          ? sourceFiles(entryPath)
          : entry.name.endsWith('.ts')
            ? [entryPath]
            : []
      })
    const source = sourceFiles(sourceRoot).map((filePath) => ({
      filePath,
      text: readFileSync(filePath, 'utf8')
    }))
    const coreSource = source
      .filter(({ filePath }) => !filePath.endsWith('/internal/terminal-runtime.ts'))
      .map(({ text }) => text)
      .join('\n')
    const terminalSource = source.find(({ filePath }) =>
      filePath.endsWith('/internal/terminal-runtime.ts')
    )?.text
    expect(coreSource).not.toMatch(/from ['"](?:[^'"]*lifecycle|[^'"]*reactive|[^'"]*resource)/)
    expect(coreSource).not.toMatch(/from ['"]node:/)
    expect(coreSource).not.toMatch(/queueMicrotask|setTimeout|Date\.now|performance\.now/)
    expect(terminalSource ?? '').toContain('queueMicrotask')
  })

  it('keeps event fan-out independent from middleware execution', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>
    }
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/middleware-pipeline')
    const sourceRoot = resolve(import.meta.dirname, '../src')
    const source = readFileSync(resolve(sourceRoot, 'index.ts'), 'utf8')
    expect(source).not.toContain('middleware-pipeline')
  })

  it('keeps heavy lifecycle ownership outside the package runtime graph', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>
      readonly devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/lifecycle')
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/event-dispatcher')
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('@migaia/lifecycle')
  })

  it('keeps pipeline and generator control flow out of the public root', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/index.ts'), 'utf8')
    expect(source).not.toMatch(/waterfall|next\(|generator|middleware/)
  })

  it('keeps registration removal structural rather than scan-based', () => {
    const source = readFileSync(
      resolve(import.meta.dirname, '../src/internal/channel-registrations.ts'),
      'utf8'
    )
    expect(source).not.toMatch(/\.indexOf\(|\.find\(|\.filter\(/)
    expect(source).toContain('owner.previous')
    expect(source).toContain('owner.next')
  })

  it('verifies the callable documentation contract and rejects stale scope claims', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const readme = readFileSync(resolve(packageRoot, 'README.md'), 'utf8')
    const useguide = readFileSync(resolve(packageRoot, 'USEGUIDE.md'), 'utf8')
    const contractRows = [
      [
        readme,
        "subscribe(listener, options?: { taskId?: string; delivery?: 'context' }): subscription"
      ],
      [
        readme,
        "subscribe(listener, options: { taskId?: string; delivery: 'value' }): subscription"
      ],
      [readme, '动态事件名可在运行时广播；有限字面量事件表的同一条链禁止重复事件名'],
      [useguide, 'handle.unsubscribe === handle'],
      [useguide, '取消按追加顺序的逆序执行整条链，只真正执行一次'],
      [useguide, '有限字面量事件表在同一条 Hub 链上排除已经使用的 key'],
      [useguide, '宽 key、索引签名或运行时联合 key 保留动态广播'],
      [useguide, '链式扩展不是事务：后一次订阅失败时，前面成功的登记仍归原句柄所有'],
      [useguide, 'SUBSCRIPTION_CLOSED']
    ] as const
    for (const [text, clause] of contractRows) expect(text).toContain(clause)
    expect(`${readme}\n${useguide}`).not.toMatch(
      /plain[- ]only|只能是普通函数|runtime-global uniqueness/i
    )

    expect(
      readFileSync(resolve(packageRoot, '../event-subscriber/src/index.ts'), 'utf8')
    ).toContain('IEventChannelSubscription')
    expect(
      readFileSync(resolve(packageRoot, '../event-subscriber/src/types.ts'), 'utf8')
    ).toContain('IEventHubSubscription')
  })

  it('uses explicit owner import graph and runtime recursion trap', async () => {
    const sourceRoot = resolve(import.meta.dirname, '../src')
    const hub = readFileSync(resolve(sourceRoot, 'hub.ts'), 'utf8')
    const channel = readFileSync(resolve(sourceRoot, 'internal/channel-owner.ts'), 'utf8')
    const owner = readFileSync(resolve(sourceRoot, 'internal/subscription.ts'), 'utf8')
    expect(hub).toContain("from './internal/subscription.ts'")
    expect(channel).toContain("from './subscription.ts'")
    expect(owner).toContain('createRawSubscriptionOwner')
    expect(owner).not.toContain('setSubscriptionReleaseProbe')
    const { createEventHub } = await import('../src/index.ts')
    const eventHub = createEventHub<{ ready: number; done: string }>()
    const handle = eventHub.subscribe('ready', () => undefined)
    expect(handle.subscribe('done', () => undefined)).toBe(handle)
    handle.unsubscribe()
    expect(eventHub.size()).toBe(0)
    const channelSource = readFileSync(
      resolve(import.meta.dirname, '../src/internal/channel-owner.ts'),
      'utf8'
    )
    expect(channelSource).toContain(
      'const shared = this.#registrations.admitUnique(listener, taskId, delivery)'
    )
    expect(channelSource).toContain(
      'const admission = shared ? undefined : this.#registrations.register(listener, taskId, delivery)'
    )
    expect(channelSource).toContain('createRawSubscriptionOwner(')
    expect(channelSource).toContain(
      'const admission = this.#registrations.register(listener, taskId, delivery)'
    )
  })

  it('gives every package test a unique name', () => {
    const testRoot = resolve(import.meta.dirname)
    const testFiles = readdirSync(testRoot)
      .filter((entry) => entry.endsWith('.test.ts') && entry !== 'architecture.test.ts')
      .map((entry) => readFileSync(resolve(testRoot, entry), 'utf8'))
    const testNames = testFiles.flatMap((source) => source.match(/it\('([^']+)'/g) ?? [])
    expect(testNames.length).toBeGreaterThan(0)
    expect(new Set(testNames).size).toBe(testNames.length)
  })
})
