import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

describe('runtime-neutral boundary', () => {
  it('ES-T12 ships side-effect-free admitted entries with only the utils foundation dependency', () => {
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

  it('ES-T17 confines host scheduler access to the terminal adapter', () => {
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

  it('ES-T24 keeps event fan-out independent from middleware execution', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>
    }
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/middleware-pipeline')
    const sourceRoot = resolve(import.meta.dirname, '../src')
    const source = readFileSync(resolve(sourceRoot, 'index.ts'), 'utf8')
    expect(source).not.toContain('middleware-pipeline')
  })

  it('ES-T25 keeps heavy lifecycle ownership outside the package runtime graph', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly dependencies?: Record<string, string>
      readonly devDependencies?: Record<string, string>
    }
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/lifecycle')
    expect(manifest.dependencies ?? {}).not.toHaveProperty('@migaia/event-dispatcher')
    expect(manifest.devDependencies ?? {}).not.toHaveProperty('@migaia/lifecycle')
  })

  it('ES-T27 keeps pipeline and generator control flow out of the public root', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/index.ts'), 'utf8')
    expect(source).not.toMatch(/waterfall|next\(|generator|middleware/)
  })

  it('ES-T13 keeps registration removal structural rather than scan-based', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/channel.ts'), 'utf8')
    expect(source).not.toMatch(/\.indexOf\(|\.find\(|\.filter\(/)
    expect(source).toContain('owner.previous')
    expect(source).toContain('owner.next')
  })

  it('ES-T113 verifies the callable documentation contract and rejects stale scope claims', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const readme = readFileSync(resolve(packageRoot, 'README.md'), 'utf8')
    const useguide = readFileSync(resolve(packageRoot, 'USEGUIDE.md'), 'utf8')
    const contractRows = [
      [readme, 'subscribe(listener, options?: { taskId?: string }): subscription'],
      [readme, '动态 key 允许运行时 fan-out；finite key 链禁止重复 key'],
      [useguide, 'channelHandle.unsubscribe() // same function identity; releases whole chain'],
      [useguide, 'finite literal maps reject a repeated key on this chain'],
      [useguide, 'widened key: runtime fan-out'],
      [useguide, 'extension is non-transactional; earlier registration'],
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

  it('ES-T114 uses explicit owner import graph and runtime recursion trap', async () => {
    const sourceRoot = resolve(import.meta.dirname, '../src')
    const hub = readFileSync(resolve(sourceRoot, 'hub.ts'), 'utf8')
    const channel = readFileSync(resolve(sourceRoot, 'channel.ts'), 'utf8')
    const owner = readFileSync(resolve(sourceRoot, 'internal/subscription.ts'), 'utf8')
    expect(hub).toContain("from './internal/subscription.js'")
    expect(channel).toContain("from './internal/subscription.js'")
    expect(owner).toContain('createRawSubscriptionOwner')
    expect(owner).not.toContain('setSubscriptionReleaseProbe')
    const { createEventHub } = await import('../src/index.js')
    const eventHub = createEventHub<{ ready: number; done: string }>()
    const handle = eventHub.subscribe('ready', () => undefined)
    expect(handle.subscribe('done', () => undefined)).toBe(handle)
    handle.unsubscribe()
    expect(eventHub.size()).toBe(0)
    const channelSource = readFileSync(resolve(import.meta.dirname, '../src/channel.ts'), 'utf8')
    expect(channelSource).toContain('const shared = admitUnique(listener, taskId)')
    expect(channelSource).toContain(
      'const admission = shared ? undefined : registerRaw(listener, taskId)'
    )
    expect(channelSource).toContain('createSubscriptionHandle(')
    expect(channelSource).toContain('const nextAdmission = registerRaw(nextListener, nextTaskId)')
  })

  it('ES-T51 gives every package test a stable ES-T identifier', () => {
    const testRoot = resolve(import.meta.dirname)
    const testFiles = readdirSync(testRoot)
      .filter((entry) => entry.endsWith('.test.ts') && entry !== 'architecture.test.ts')
      .map((entry) => readFileSync(resolve(testRoot, entry), 'utf8'))
    const testNames = testFiles.flatMap((source) => source.match(/it\('([^']+)'/g) ?? [])
    expect(testNames.length).toBeGreaterThan(0)
    expect(testNames.every((name) => /it\('ES-T\d+ /.test(name))).toBe(true)
    const ids = testNames.map((name) => name.match(/it\('(ES-T\d+) /)?.[1])
    expect(new Set(ids).size).toBe(ids.length)
  })
})
