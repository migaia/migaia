import { describe, expect, it } from 'vitest'

import { commentExample } from '../app/example-commentary.js'

describe('example commentary', () => {
  it.each(['zh', 'en'] as const)(
    'preserves authored comments and whitespace in %s examples without synthesized prose',
    (locale) => {
      /** Authored comments and spacing must survive rendering and copying unchanged. */
      const code = `
// 创建本次会话。
const session = openSession(options)

await session.run(job)
await session.dispose()
`
      /** Maintained context describes the page, but must not become generated example prose. */
      const example = commentExample(code, 'ts', locale, {
        apiName: 'openSession',
        purpose: '创建隔离的任务会话，并统一拥有本次任务申请的资源。',
        scenario: '一个请求需要在结束时释放连接和监听器。'
      })

      expect(example.code).toBe(code)
      expect(example.notes).toEqual([])
      expect(example.code).not.toContain('本例对应的生产场景是')
      expect(example.code).not.toContain('保存 openSession() 返回的本次实例')
      expect(example.code).not.toContain('The production situation shown here is')
      expect(example.code).not.toContain('holds this openSession() result')
      expect(example.code).not.toContain('输出用于确认上一操作的结果。')
      expect(example.code).not.toContain('Logs the result of the preceding operation.')
    }
  )

  it.each(['zh', 'en'] as const)('does not narrate direct API calls in %s', (locale) => {
    /** An unassigned call must remain readable without an invented instance explanation. */
    const code = 'openSession(options)'
    /** Page metadata must not synthesize a comment before the executable call. */
    const example = commentExample(code, 'ts', locale, {
      apiName: 'openSession',
      purpose: '创建隔离的任务会话。',
      scenario: '一个请求需要释放连接。'
    })

    expect(example.code).toBe(code)
    expect(example.notes).toEqual([])
    expect(example.code).not.toContain('这里直接执行')
    expect(example.code).not.toContain('没有创建可供后续复用的实例')
    expect(example.code).not.toContain('without creating a reusable instance')
  })

  it.each([
    'const settings = localStorageHost({ namespace: "settings" })\nawait settings.dispose()',
    'const graph = createCapabilityGraph()\ngraph.register(provider)\nawait graph.ready()\ngraph.get(consumer, provider)\nawait graph.dispose()',
    'const host = createCapabilityHost({ tenantId })\nhost.register(provider)\nawait host.enable("persistence")\nawait host.dispose()',
    'const merged = createAbortTimeoutSignal({ timeoutMs: 500 })\nawait request(merged.signal)\nmerged.dispose()',
    'const scheduler = createManualScheduler()\nscheduler.advance(100)',
    'const now = systemScheduler.now()',
    'const retained = identitySnapshot(source)',
    'const next = set(data, "user.name", "Grace")',
    'const config = ownConfig(callerOptions)',
    'const view = readonlyConfig(config)',
    'await transaction(callback)',
    'const query = liveQuery(options)\nawait query.ready\nquery.dispose()'
  ])('keeps API examples free of automatic walkthroughs: %s', (code) => {
    /** Previously recognized calls must receive the same pass-through behavior as ordinary code. */
    const example = commentExample(code, 'ts', 'zh')

    expect(example.code).toBe(code)
    expect(example.notes).toEqual([])
  })

  it('preserves shell comments and formats without line comments', () => {
    expect(commentExample('# Authored command\npnpm install\n', 'bash', 'en')).toEqual({
      code: '# Authored command\npnpm install\n',
      notes: []
    })
    expect(commentExample('{"enabled":true}', 'json', 'zh')).toEqual({
      code: '{"enabled":true}',
      notes: []
    })
  })

  it('preserves public signatures without synthesized overload commentary', () => {
    /** Declaration text remains owned by the generated API data and its renderer. */
    const code =
      'export declare function createEventChannel<T>(options: IOptions): IChannel<T>\nexport declare function createEventChannel<T, R>(options: IOptions, projectionPlan: IPlan<R>): IChannel<T, R>'
    /** Signature metadata must not duplicate the page contract inside its code block. */
    const example = commentExample(code, 'ts', 'zh', {
      apiName: 'createEventChannel',
      kind: 'signature',
      parameterNames: ['options', 'projectionPlan'],
      purpose: '创建事件通道。'
    })

    expect(example.code).toBe(code)
    expect(example.notes).toEqual([])
  })
})
