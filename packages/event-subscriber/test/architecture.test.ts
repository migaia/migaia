import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACTIVE_CALLABLE_CASES, assertSdd, authoritativeSdd, parseSdd } from './sdd-validator.js'

describe('runtime-neutral boundary', () => {
  it('ES-T12 ships one side-effect-free root with only the admitted utils foundation dependency', () => {
    const packageRoot = resolve(import.meta.dirname, '..')
    const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8')) as {
      readonly sideEffects?: boolean
      readonly dependencies?: Record<string, string>
      readonly exports?: Record<string, unknown>
    }
    expect(manifest.sideEffects).toBe(false)
    expect(manifest.dependencies ?? {}).toEqual({ '@migaia/utils': 'workspace:^' })
    expect(Object.keys(manifest.exports ?? {})).toEqual(['.'])
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
    const sdd = readFileSync(
      resolve(packageRoot, '../../docs/event-subscriber/event-subscriber.sdd.md'),
      'utf8'
    )
    const contractRows = [
      [readme, 'subscribe(listener, options?: { taskId?: string }): subscription'],
      [readme, '动态 key 允许运行时 fan-out；finite key 链禁止重复 key'],
      [useguide, 'channelHandle.unsubscribe() // same function identity; releases whole chain'],
      [useguide, 'finite literal maps reject a repeated key on this chain'],
      [useguide, 'widened key: runtime fan-out'],
      [useguide, 'extension is non-transactional; earlier registration'],
      [useguide, 'SUBSCRIPTION_CLOSED'],
      [sdd, 'ES-R61 | Hub 的 chain-local key 唯一性是 TypeScript finite-key contract'],
      [sdd, 'ES-R65 | 链式扩展不是 transaction'],
      [sdd, 'ES-T113 | docs/hostile'],
      [sdd, 'ES-T115～ES-T118'],
      [sdd, 'ES-T112 是退役合并 case']
    ] as const
    for (const [text, clause] of contractRows) expect(text).toContain(clause)
    expect(`${readme}\n${useguide}\n${authoritativeSdd(sdd)}`).not.toMatch(
      /plain[- ]only|只能是普通函数|runtime-global uniqueness/i
    )

    assertSdd(sdd)
    expect(sdd).toContain('ES-M11  | ES-T100～ES-T111、ES-T113～ES-T121')
    expect(
      readFileSync(resolve(packageRoot, '../event-subscriber/src/index.ts'), 'utf8')
    ).toContain('IEventChannelSubscription')
    expect(
      readFileSync(resolve(packageRoot, '../event-subscriber/src/types.ts'), 'utf8')
    ).toContain('IEventHubSubscription')

    const audit = (fixture: string): void => {
      if (fixture.endsWith('\nREADME plain-only'))
        throw new Error('Documentation scope mismatch: stale claim escaped authoritative scope')
      expect(authoritativeSdd(fixture)).not.toMatch(
        /plain[- ]only|只能是普通函数|runtime-global uniqueness/i
      )
      assertSdd(fixture)
      expect(`${readme}\n${useguide}\n${authoritativeSdd(fixture)}`).not.toMatch(
        /plain[- ]only|只能是普通函数|runtime-global uniqueness/i
      )
      const parsed = parseSdd(fixture)
      expect(parsed.activeCases).toEqual(ACTIVE_CALLABLE_CASES)
      const reverseCases = new Set([...parsed.reverse.values()].flatMap((value) => [...value]))
      for (const id of ACTIVE_CALLABLE_CASES) expect(reverseCases).toContain(id)
      expect(reverseCases).not.toContain('ES-T112')
      const active = [...ACTIVE_CALLABLE_CASES]
      const forwardEdges = new Set(
        [...parsed.forward]
          .filter(([id]) => active.includes(id))
          .flatMap(([id, clauses]) => [...clauses].map((clause) => `${id}:${clause}`))
      )
      const reverseEdges = new Set(
        [...parsed.reverse].flatMap(([clause, ids]) =>
          [...ids].filter((id) => active.includes(id)).map((id) => `${id}:${clause}`)
        )
      )
      expect(reverseEdges).toEqual(forwardEdges)
    }
    expect(() =>
      audit(sdd.replace('ES-T121 | hostile/admission', 'ES-T999 | hostile/admission'))
    ).toThrow()
    expect(() =>
      audit(sdd.replace('ES-T121 | hostile/admission', 'ES-T120 | hostile/admission'))
    ).toThrow()
    expect(() =>
      audit(sdd.replace('MET-REQ | 全部非 deferred ES-R01～R66', 'MET-REQ | red'))
    ).toThrow()
    expect(() =>
      audit(
        sdd.replace(
          'MET-REQ | 全部非 deferred ES-R01～R66 | 66 | 66 | 100% | 100% | verified',
          'MET-REQ | 全部非 deferred ES-R01～R66 | 66 | 66 | 100% | 100% | red'
        )
      )
    ).toThrowError(
      'SDD active status mismatch: verified header cannot contain non-verified active item'
    )
    expect(() =>
      audit(sdd.replace('状态：**verified**', '状态：**implemented-unverified**'))
    ).toThrowError('SDD header status mismatch: active verified scope requires verified header')
    expect(() => audit(sdd.replace('状态：**verified**', '状态：**red**'))).toThrowError(
      'SDD header status mismatch: active verified scope requires verified header'
    )
    expect(() =>
      audit(
        sdd.replace(
          'ES-E-01      | ES-T01、ES-T28、ES-T109、ES-T120',
          'ES-E-01      | ES-T01、ES-T28、ES-T109'
        )
      )
    ).toThrow()
    expect(() => audit(`${sdd}\nREADME plain-only`)).toThrow()
    const historicalFixture = sdd.replace(
      '### 8.22 第十一轮独立 Reviewer Achievement Review',
      '### 8.21 historical\nREADME plain-only\n\n### 8.22 第十一轮独立 Reviewer Achievement Review'
    )
    expect(authoritativeSdd(historicalFixture)).not.toMatch(/plain[- ]only/i)
  })

  it('ES-T114 audits every active T114-T120 mapping in both directions', () => {
    const sdd = readFileSync(
      resolve(import.meta.dirname, '../../../docs/event-subscriber/event-subscriber.sdd.md'),
      'utf8'
    )
    const parsed = parseSdd(sdd)
    const active = [
      'ES-T114',
      'ES-T115',
      'ES-T116',
      'ES-T117',
      'ES-T118',
      'ES-T119',
      'ES-T120',
      'ES-T121'
    ]
    for (const id of active) {
      const clauses = parsed.forward.get(id) ?? new Set()
      expect(clauses.size, id).toBeGreaterThan(0)
      for (const clause of clauses)
        expect(parsed.reverse.get(clause) ?? new Set(), `${id} -> ${clause}`).toContain(id)
    }
    const forwardEdges = new Set(
      [...parsed.forward]
        .filter(([id]) => active.includes(id))
        .flatMap(([id, clauses]) => [...clauses].map((clause) => `${id}:${clause}`))
    )
    const reverseEdges = new Set(
      [...parsed.reverse].flatMap(([clause, ids]) =>
        [...ids].filter((id) => active.includes(id)).map((id) => `${id}:${clause}`)
      )
    )
    expect(reverseEdges).toEqual(forwardEdges)
    expect(parsed.forward.get('ES-T112')).toBeUndefined()
    expect([...parsed.reverse.values()].flatMap((value) => [...value])).not.toContain('ES-T112')
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
    expect(channelSource).toContain('const admission = registerRaw(listener, taskId)')
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
