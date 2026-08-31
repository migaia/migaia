import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { commentExample } from '../app/example-commentary.js'

describe('example commentary', () => {
  it('explains storage ownership and disposal without narrating ordinary control flow', () => {
    const example = commentExample(
      "import { localStorage } from '@migaia/storage-web/local-storage'\n\nconst settings = localStorage({ namespace: 'settings' })\nawait settings.set('theme', 'dark')\nconst theme = await settings.get('theme')\n\nif (settings.capabilities.syncRead) {\n  settings.sync.set('density', 'compact')\n}\n\nawait settings.dispose()",
      'ts',
      'zh'
    )

    expect(example.code).toContain('settings 只读写 namespace 为 settings 的键空间')
    expect(example.code).not.toContain('先看条件是否满足')
    expect(example.code).toContain('settings.dispose()')
    expect(example.code).toContain('不会删除已经持久化的数据')
    expect(example.code).not.toMatch(/\/\/ \d+\./)
    expect(example.notes).toHaveLength(1)
  })

  it('explains a capability graph as a complete sequence in plain language', () => {
    const example = commentExample(
      'const graph = createCapabilityGraph()\ngraph.register(provider)\ngraph.register(consumer)\nawait graph.ready()\nconst service = graph.get(consumer, provider)\nawait graph.dispose()',
      'ts',
      'zh'
    )

    expect(example.notes[0]).toBe(
      '先登记谁提供能力、谁依赖它；ready() 会按依赖顺序启动，get() 读取已就绪的能力，dispose() 最后按相反顺序释放资源。'
    )
    expect(example.notes).toHaveLength(1)
    expect(example.code).not.toContain('释放本示例创建的监听器和宿主资源')
  })

  it('explains how callers use returned signal and dispose capabilities', () => {
    const example = commentExample(
      `const merged = createAbortTimeoutSignal({ timeoutMs: 500 })
await request(merged.signal)
merged.dispose()`,
      'ts',
      'zh'
    )

    expect(example.notes).toHaveLength(1)
    expect(example.notes[0]).toContain('merged.signal')
    expect(example.notes[0]).toContain('500 ms')
    expect(example.notes[0]).toContain('request()')
    expect(example.notes[0]).toContain('merged.dispose()')
    expect(example.notes[0]).toContain('只清除该合并信号安装的监听器和计时器')
    expect(example.notes[0]).toContain('不会替 request() 取消其他工作')
  })

  it('marks createManualScheduler as repository-only test infrastructure', () => {
    const example = commentExample(
      'const scheduler = createManualScheduler()\nscheduler.advance(100)',
      'ts',
      'zh'
    )

    expect(example.notes[0]).toContain('本仓测试与适配器验证专用')
    expect(example.notes[0]).toContain('不适合外部业务代码')
    expect(example.notes[0]).toContain('测试框架的 fake timers')
  })

  it('explains why scheduler-aware code does not call Date.now directly', () => {
    const example = commentExample('const now = systemScheduler.now()', 'ts', 'zh')

    expect(example.notes[0]).toContain('数值与 Date.now() 相同')
    expect(example.notes[0]).toContain('now() 与 schedule()')
    expect(example.notes[0]).toContain('一起替换为虚拟时钟')
    expect(example.notes[0]).toContain('普通业务只读真实时间可直接用 Date.now()')
  })

  it('explains the policy-slot use case and shared ownership of identitySnapshot', () => {
    const example = commentExample('const retained = identitySnapshot(source)', 'ts', 'zh')

    expect(example.notes[0]).toContain('零拷贝策略')
    expect(example.notes[0]).toContain('同一对象')
    expect(example.notes[0]).toContain('共享所有权')
    expect(example.notes[0]).toContain('单独包一层调用没有收益')
    expect(example.notes[0]).toContain('跨边界数据也不应使用')
  })

  it('explains immutable path updates without claiming the result is frozen', () => {
    const example = commentExample("const next = set(data, 'user.name', 'Grace')", 'ts', 'zh')

    expect(example.notes[0]).toContain('每次发生实际更新都会返回新根对象')
    expect(example.notes[0]).toContain('原对象不变')
    expect(example.notes[0]).toContain('其他分支继续共享引用')
    expect(example.notes[0]).toContain('不表示整棵树深拷贝或返回值已冻结')
    expect(example.notes[0]).toContain('新旧值相同时会直接复用原对象')
  })

  it('explains the admission and ownership capabilities of ownConfig', () => {
    const example = commentExample('const config = ownConfig(callerOptions)', 'ts', 'zh')

    expect(example.notes[0]).toContain('接收外部配置的边界')
    expect(example.notes[0]).toContain('验证并复制整张对象图')
    expect(example.notes[0]).toContain('内部 WeakMap 登记 profile 与 limits')
    expect(example.notes[0]).toContain('修改原对象不会影响已接纳配置')
    expect(example.notes[0]).toContain('readonlyConfig()')
    expect(example.notes[0]).toContain('patchConfig()、combineConfig()')
  })

  it('explains readonlyConfig without facade jargon', () => {
    const example = commentExample('const view = readonlyConfig(config)', 'ts', 'zh')

    expect(example.notes[0]).toContain('只能读取、不能修改')
    expect(example.notes[0]).toContain('没有复制第二份配置')
    expect(example.notes[0]).toContain('任何层级')
    expect(example.notes[0]).toContain('CONFIG_READONLY')
    expect(example.notes[0]).toContain('patchConfig()')
    expect(example.notes[0]).not.toContain('门面')
  })

  it('keeps formats without line comments unchanged instead of adding filler', () => {
    const example = commentExample('{"enabled":true}', 'json', 'zh')

    expect(example.code).toBe('{"enabled":true}')
    expect(example.notes).toEqual([])
  })

  it('does not invent commentary for imports, assignments, or generic calls', () => {
    const example = commentExample(
      "import { format } from '@migaia/utils/string'\n\nconst input = { name: 'Ada' }\n\nconst output = format('{name}', input)",
      'ts',
      'zh'
    )

    expect(example.code).not.toContain('先从示例标出的公开路径')
    expect(example.code).not.toContain('下一步要用的值')
    expect(example.code).not.toContain('最后执行这一项操作')
    expect(example.code).not.toContain('这里真正发起读写或调用')
    expect(example.code).not.toMatch(/\/\/ \d+\./)
    expect(example.notes).toEqual([])
  })

  it('does not invent storage ownership when the example omits concrete configuration', () => {
    const example = commentExample('localStorage(options)', 'ts', 'zh')

    expect(example.notes).toEqual([])
  })

  it('does not mistake a reactive signal factory for AbortSignal cancellation', () => {
    const example = commentExample(
      `const runtime = createRuntime()
const count = runtime.signal(0)
console.log(count.value)`,
      'typescript',
      'zh'
    )

    expect(example.notes.join('\n')).not.toContain('AbortSignal')
    expect(example.notes.join('\n')).not.toContain('signal 会变为 aborted')
  })

  it('routes every reader example through commentary without altering type signatures', () => {
    const routeSource = readFileSync(new URL('../app/routes/docs.tsx', import.meta.url), 'utf8')
    const explainedCalls = routeSource.match(/^\s+explain$/gm) ?? []
    const signatureCall = routeSource.match(/<CodeBlock\s+code=\{symbol\.signature\}[^>]*\/>/)?.[0]

    expect(explainedCalls).toHaveLength(4)
    expect(routeSource).toMatch(/code=\{symbol\.signature\}[\s\S]*?公开类型签名/)
    expect(signatureCall).not.toContain('explain')
    expect(routeSource).not.toContain('代码旁白')
  })
})
