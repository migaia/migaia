/** Hardening regression cases for lifecycle, config, and extension invariants. */
import { describe, expect, it, vi } from 'vitest'
import { asyncDisposeKey, disposeKey, PluginHost, PluginHostError } from '../src/index.js'

class Host extends PluginHost<Record<string, never>, string> {
  /** Supplies an explicit unbounded test policy while preserving test overrides. */
  constructor(options: any = {}) {
    super({
      ...options,
      execution: options.execution ?? { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    })
  }

  install(plugins: readonly any[]) {
    return this.useSync(plugins)
  }
}

class ConfigDate extends Date {
  label = 'date'
  self = this
}

class ConfigRegExp extends RegExp {
  label = 'regexp'
  self = this
}

/** Map subclass readers must use the readonly proxy as their custom-method receiver. */
class ConfigMapSubclass extends Map<string, number> {
  readValue(): number {
    return this.get('value') ?? -1
  }

  receiver(): this {
    return this
  }

  mutateWithSuper(): void {
    super.set('value', 2)
  }

  mutateOwnProperty(): void {
    ;(this as unknown as { marker: number }).marker = 1
  }
}

/** Set subclass readers must use the readonly proxy as their custom-method receiver. */
class ConfigSetSubclass extends Set<string> {
  hasValue(): boolean {
    return this.has('value')
  }

  receiver(): this {
    return this
  }

  mutateWithSuper(): void {
    super.add('other')
  }

  mutateOwnProperty(): void {
    ;(this as unknown as { marker: number }).marker = 1
  }
}

/** Map subclass whose iterable hook hides entries from code that fails to capture native readers. */
class HiddenIteratorMap extends Map<string, unknown> {
  [Symbol.iterator](): any {
    return [][Symbol.iterator]()
  }
}

/** Set subclass whose iterable hook hides values from code that fails to capture native readers. */
class HiddenIteratorSet extends Set<unknown> {
  [Symbol.iterator](): any {
    return [][Symbol.iterator]()
  }
}

/** Map subclass overrides every reader family to prove custom calls receive only the proxy. */
class ReaderOverrideMap extends Map<string, number> {
  get(): any {
    super.set('leak', 1)
    return this
  }

  has(): any {
    super.set('leak', 1)
    return this
  }

  entries(): any {
    return this
  }

  keys(): any {
    return this
  }

  values(): any {
    return this
  }

  forEach(): any {
    return this
  }

  [Symbol.iterator](): any {
    return this
  }
}

/** Set subclass overrides every reader family to prove custom calls receive only the proxy. */
class ReaderOverrideSet extends Set<string> {
  has(): any {
    super.add('leak')
    return this
  }

  entries(): any {
    return this
  }

  keys(): any {
    return this
  }

  values(): any {
    return this
  }

  forEach(): any {
    return this
  }

  [Symbol.iterator](): any {
    return this
  }
}

describe('PH-AF-63：resource disposer admission snapshot', () => {
  it('只读取一次 disposer，保留 receiver，并忽略 admission 后的替换', async () => {
    const host = new Host()
    const resource: Record<PropertyKey, unknown> = {}
    let getterReads = 0
    let firstCalls = 0
    let secondCalls = 0
    let receiverMatched = false
    const first = function (this: object): void {
      firstCalls += 1
      receiverMatched = this === resource
    }
    const second = function (): void {
      secondCalls += 1
    }

    Object.defineProperty(resource, disposeKey, {
      configurable: true,
      get: () => {
        getterReads += 1
        return getterReads === 1 ? first : second
      }
    })

    await host.use({
      name: 'p',
      install: (core: { onDispose(value: object): void }) => {
        core.onDispose(resource)
        return {}
      }
    } as any)

    Object.defineProperty(resource, disposeKey, {
      configurable: true,
      value: second,
      writable: true
    })
    await host.unUse('p')

    expect(getterReads).toBe(1)
    expect(firstCalls).toBe(1)
    expect(secondCalls).toBe(0)
    expect(receiverMatched).toBe(true)
  })
})

describe('PH-T16：plugin admission snapshot and disposer boundary', () => {
  it('PH-T16a：每个 plugin getter 只读取一次，mutation 后仍执行已捕获 hook 与 receiver', async () => {
    const host = new Host()
    const plugin = {} as Record<PropertyKey, unknown>
    const reads = new Map<PropertyKey, number>()
    const calls = { install: 0, shared: 0, update: 0, dispose: 0 }
    const receivers = { install: false, shared: false, update: false, dispose: false }
    const count = (key: PropertyKey): void => {
      reads.set(key, (reads.get(key) ?? 0) + 1)
    }
    const install = function (this: object): Record<string, never> {
      calls.install += 1
      receivers.install = this === plugin
      return {}
    }
    const shared = function (this: object): Record<string, never> {
      calls.shared += 1
      receivers.shared = this === plugin
      return {}
    }
    const update = function (this: object): void {
      calls.update += 1
      receivers.update = this === plugin
    }
    const dispose = function (this: object): void {
      calls.dispose += 1
      receivers.dispose = this === plugin
    }
    const replacement = (): void => undefined
    Object.defineProperties(plugin, {
      name: {
        configurable: true,
        get: () => {
          count('name')
          return 'snapshot'
        }
      },
      config: {
        configurable: true,
        get: () => {
          count('config')
          return { enabled: true }
        }
      },
      install: {
        configurable: true,
        get: () => {
          count('install')
          return install
        }
      },
      shared: {
        configurable: true,
        get: () => {
          count('shared')
          return shared
        }
      },
      update: {
        configurable: true,
        get: () => {
          count('update')
          return update
        }
      },
      dispose: {
        configurable: true,
        get: () => {
          count('dispose')
          return dispose
        }
      },
      [asyncDisposeKey]: {
        configurable: true,
        get: () => {
          count(asyncDisposeKey)
          return replacement
        }
      },
      [disposeKey]: {
        configurable: true,
        get: () => {
          count(disposeKey)
          return replacement
        }
      }
    })

    await host.use(plugin as any)
    Object.defineProperties(plugin, {
      config: { configurable: true, value: { enabled: false } },
      install: { configurable: true, value: replacement },
      shared: { configurable: true, value: replacement },
      update: { configurable: true, value: replacement },
      dispose: { configurable: true, value: replacement },
      [asyncDisposeKey]: { configurable: true, value: replacement },
      [disposeKey]: { configurable: true, value: replacement }
    })

    await host.config.update('snapshot', () => ({ enabled: false }))
    await host.unUse('snapshot')

    expect(reads.get('name')).toBe(1)
    expect(reads.get('config')).toBe(1)
    expect(reads.get('install')).toBe(1)
    expect(reads.get('shared')).toBe(1)
    expect(reads.get('update')).toBe(1)
    expect(reads.get('dispose')).toBe(1)
    expect(reads.get(asyncDisposeKey)).toBe(1)
    expect(reads.get(disposeKey)).toBe(1)
    expect(calls).toEqual({ install: 1, shared: 1, update: 1, dispose: 1 })
    expect(receivers).toEqual({ install: true, shared: true, update: true, dispose: true })
  })

  it('PH-T16b：symbol disposer admission 保持 async precedence、receiver 与 captured identity', async () => {
    const host = new Host()
    const plugin = {} as Record<PropertyKey, unknown>
    let asyncReads = 0
    let disposeReads = 0
    let asyncCalls = 0
    let syncCalls = 0
    let receiverMatched = false
    const firstAsync = function (this: object): void {
      asyncCalls += 1
      receiverMatched = this === plugin
    }
    const replacementAsync = (): void => {
      asyncCalls += 100
    }
    const sync = (): void => {
      syncCalls += 1
    }
    Object.defineProperties(plugin, {
      name: { configurable: true, value: 'symbol-snapshot' },
      install: { configurable: true, value: () => ({}) },
      [asyncDisposeKey]: {
        configurable: true,
        get: () => {
          asyncReads += 1
          return firstAsync
        }
      },
      [disposeKey]: {
        configurable: true,
        get: () => {
          disposeReads += 1
          return sync
        }
      }
    })

    await host.use(plugin as any)
    Object.defineProperties(plugin, {
      [asyncDisposeKey]: { configurable: true, value: replacementAsync },
      [disposeKey]: { configurable: true, value: replacementAsync }
    })
    await host.unUse('symbol-snapshot')

    expect(asyncReads).toBe(1)
    expect(disposeReads).toBe(1)
    expect(asyncCalls).toBe(1)
    expect(syncCalls).toBe(0)
    expect(receiverMatched).toBe(true)
  })

  it('hostile plugin getter becomes plugin-host INVALID_OPTION with original cause', () => {
    const host = new Host()
    const cause = new Error('install getter boom')
    const plugin = { name: 'hostile' } as Record<PropertyKey, unknown>
    Object.defineProperty(plugin, 'install', {
      configurable: true,
      get: () => {
        throw cause
      }
    })

    let caught: unknown
    try {
      host.use(plugin as any)
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({
      source: '@migaia/plugin-host',
      code: 'INVALID_OPTION',
      cause
    })
  })

  it('PH-T16d：hostile resource disposer getter remains tagged inside install failure cause chain', async () => {
    const host = new Host()
    const cause = new Error('resource disposer getter boom')
    const resource = {} as Record<PropertyKey, unknown>
    Object.defineProperty(resource, disposeKey, {
      configurable: true,
      get: () => {
        throw cause
      }
    })

    await expect(
      host.use({
        name: 'hostile-resource',
        install: (core: { onDispose(value: object): void }) => {
          core.onDispose(resource)
          return {}
        }
      } as any)
    ).rejects.toMatchObject({
      source: '@migaia/plugin-host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: {
        source: '@migaia/plugin-host',
        code: 'INVALID_OPTION',
        cause
      }
    })
  })
})

describe('#1 config.get 丢弃第一段，插件名含点号时路径解析错位', () => {
  it('插件名含路径分隔符时在安装入口拒绝', async () => {
    const host = new Host()
    expect(() => host.use({ name: 'a.b', install: () => ({}) } as any)).toThrow(
      'plugin name must not contain "."'
    )
  })
})

describe('#2 config.get(pluginName) 抛错而非返回整份 config', () => {
  it('find 分支显式匹配 path === name，parseConfigPath 却拒绝单段路径', async () => {
    const host = new Host()
    await host.use({ name: 'p', config: { a: 1 }, install: () => ({}) } as any)

    expect(host.config.get('p')).toEqual({ a: 1 })
  })
})

describe('#3 非 plain-object 的 config 值受保护且可读取', () => {
  it('Map 的 get/forEach/iterator 都只暴露只读代理', async () => {
    const map = new Map([['k', { value: 1 }]])
    const host = new Host()
    await host.use({ name: 'p', config: { map }, install: () => ({}) } as any)
    const view: any = host.config.get('p.map')
    expect(() => {
      view.get('k').value = 2
    }).toThrow('config is readonly')
    view.forEach((_value: unknown, _key: unknown, raw: Map<string, { value: number }>) => {
      expect(() => raw.set('z', { value: 3 })).toThrow()
    })
    expect(map.has('z')).toBe(false)
    expect(map.get('k')?.value).toBe(1)
  })

  it('blocks descriptor and object-key escapes from readonly config views', async () => {
    const objectKey = { id: 1 }
    const host = new Host()
    await host.use({
      name: 'p',
      config: { nested: { value: 1 }, map: new Map([[objectKey, true]]) },
      install: () => ({})
    } as any)
    const root: any = host.config.get('p')
    const leaked = Object.getOwnPropertyDescriptor(root, 'nested')!.value
    expect(() => {
      leaked.value = 2
    }).toThrow('config is readonly')
    expect(() => Object.setPrototypeOf(root, {})).toThrow('config is readonly')
    const map: any = host.config.get('p.map')
    const iteratedKey = [...map.keys()][0]
    expect(map.has(iteratedKey)).toBe(true)
    expect(map.get(iteratedKey)).toBe(true)
  })

  it('preserves Map object-key identity across separate readonly views', async () => {
    const key = { id: 1 }
    const host = new Host()
    await host.use({
      name: 'p',
      config: { map: new Map([[key, true]]) },
      install: () => ({})
    } as any)
    const first = host.config.get('p.map') as Map<object, boolean>
    const capturedKey = [...first.keys()][0]!
    const second = host.config.get('p.map') as Map<object, boolean>
    expect(second.has(capturedKey)).toBe(true)
  })

  it('Date 值在重复 get() 时保持代理身份并可读取', async () => {
    const host = new Host()
    const date = new ConfigDate(0)
    const pattern = new ConfigRegExp('a', 'g')
    await host.use({
      name: 'p',
      config: {
        when: date,
        whenAlias: date,
        pattern,
        patternAlias: pattern,
        list: [1, 2]
      },
      install: () => ({})
    } as any)

    const first = host.config.get('p.when')
    expect(first).toBe(host.config.get('p.when'))
    expect(first).toBe(host.config.get('p.whenAlias'))
    expect((first as Date).getTime()).toBe(0)
    const patternView = host.config.get('p.pattern')
    expect(patternView).toBe(host.config.get('p.patternAlias'))
    expect((first as ConfigDate).self).toBe(first)
    expect((patternView as ConfigRegExp).self).toBe(patternView)
    expect(host.config.get('p.list')).toEqual([1, 2]) // 数组走另一条分支，正常
  })

  it('Map/Set Date key 和 entry 在只读视图中保持身份并可查找', async () => {
    const host = new Host()
    const original = new Date(0)
    await host.use({
      name: 'p',
      config: {
        map: new Map([[original, 'value']]),
        set: new Set([original])
      },
      install: () => ({})
    } as any)

    const map = host.config.get('p.map') as ReadonlyMap<Date, string>
    const set = host.config.get('p.set') as ReadonlySet<Date>
    const mapKey = [...map.keys()][0]!
    const setEntry = [...set.values()][0]!

    expect(mapKey).toBe(setEntry)
    expect(map.has(mapKey)).toBe(true)
    expect(map.get(mapKey)).toBe('value')
    expect(set.has(setEntry)).toBe(true)
  })

  it('Date 的变异方法不能改写只读视图', async () => {
    // PH-CFG-RO-01
    const host = new Host()
    const original = new Date(0)
    await host.use({
      name: 'p',
      config: { when: original },
      install: () => ({})
    } as any)

    const view = host.config.get('p.when') as Date
    const mutators = [
      'setDate',
      'setFullYear',
      'setHours',
      'setMilliseconds',
      'setMinutes',
      'setMonth',
      'setSeconds',
      'setTime',
      'setUTCDate',
      'setUTCFullYear',
      'setUTCHours',
      'setUTCMilliseconds',
      'setUTCMinutes',
      'setUTCMonth',
      'setUTCSeconds',
      'setYear'
    ] as const
    const mutatorView = view as unknown as Record<
      (typeof mutators)[number],
      (value: number) => number
    >

    for (const mutator of mutators) {
      expect(() => mutatorView[mutator](1234)).toThrow('config is readonly')
    }

    original.setTime(1234)
    expect(view.getTime()).toBe(0)
  })

  it('Map、Set、RegExp 的快照可读取但不能改变内部状态', async () => {
    // PH-CFG-RO-02
    const host = new Host()
    await host.use({
      name: 'p',
      config: {
        map: new Map([['a', 1]]),
        set: new Set(['a']),
        pattern: /a/g
      },
      install: () => ({})
    } as any)

    const map = host.config.get('p.map') as Map<string, number>
    const set = host.config.get('p.set') as Set<string>
    const pattern = host.config.get('p.pattern') as RegExp
    expect(map.get('a')).toBe(1)
    expect(set.has('a')).toBe(true)
    expect(pattern.test('a')).toBe(true)
    expect(pattern.lastIndex).toBe(0)
    expect(() => map.set('b', 2)).toThrow('config is readonly')
    expect(() => set.add('b')).toThrow('config is readonly')
    expect(map.has('b')).toBe(false)
    expect(set.has('b')).toBe(false)
  })
})

describe('PH-R19：cycle-aware config copy-on-write', () => {
  it('PH-T19a：更新无关键时重建 root、回基 root alias，并复用未受影响 subtree', async () => {
    const shared = { value: 1 }
    const config: Record<string, any> = {
      enabled: false,
      shared,
      alias: shared,
      nested: { back: undefined }
    }
    config.self = config
    config.nested.back = config

    const host = new Host()
    await host.use({ name: 'cycle-cow', config, install: () => ({}) } as any)
    const previous: any = host.config.get('cycle-cow')
    const previousShared = previous.shared

    await host.config.update('cycle-cow', () => ({ enabled: true }))

    const next: any = host.config.get('cycle-cow')
    expect(next).not.toBe(previous)
    expect(next.enabled).toBe(true)
    expect(next.self).toBe(next)
    expect(next.nested.back).toBe(next)
    expect(next.shared).toBe(next.alias)
    expect(next.shared).toBe(previousShared)
    expect(previous.enabled).toBe(false)
    expect(previous.self).toBe(previous)
    expect(previous.nested.back).toBe(previous)
  })

  it('PH-T19b：替换键引用 previous root/nested alias 时仍 rebases 到同一新 snapshot', async () => {
    const config: Record<string, any> = { nested: { back: undefined } }
    config.self = config
    config.nested.back = config

    const host = new Host()
    await host.use({ name: 'cycle-replace', config, install: () => ({}) } as any)
    const previous: any = host.config.get('cycle-replace')

    await host.config.update('cycle-replace', (seen) => ({
      replacement: seen,
      nestedReplacement: seen.nested
    }))

    const next: any = host.config.get('cycle-replace')
    expect(next).not.toBe(previous)
    expect(next.self).toBe(next)
    expect(next.replacement).toBe(next)
    expect(next.nestedReplacement).toBe(next.nested)
    expect(next.nestedReplacement.back).toBe(next)
    expect(previous.self).toBe(previous)
    expect(previous.nested.back).toBe(previous)
  })

  it('PH-T19c：update 失败不提交候选 root，旧 snapshot 与其 cycle 保持可读', async () => {
    const cause = new Error('cycle update failed')
    const config: Record<string, any> = { enabled: false }
    config.self = config
    const host = new Host()
    await host.use({
      name: 'cycle-rollback',
      config,
      install: () => ({}),
      update: () => {
        throw cause
      }
    } as any)
    const previous: any = host.config.get('cycle-rollback')

    await expect(
      host.config.update('cycle-rollback', (seen) => ({ enabled: true, replacement: seen }))
    ).rejects.toBe(cause)

    const afterFailure: any = host.config.get('cycle-rollback')
    expect(afterFailure).toBe(previous)
    expect(afterFailure.enabled).toBe(false)
    expect(afterFailure.self).toBe(afterFailure)
    expect(afterFailure.replacement).toBeUndefined()
  })
})

describe('PH-R20：readonly Map/Set subclass receiver isolation', () => {
  it('PH-T20a：Map subclass custom readers work, return the proxy, and cannot mutate via super', async () => {
    const map = new ConfigMapSubclass([['value', 1]])
    const host = new Host()
    await host.use({ name: 'map-subclass', config: { map }, install: () => ({}) } as any)

    const view: any = host.config.get('map-subclass.map')
    expect(view).toBeInstanceOf(Map)
    expect(view.readValue()).toBe(1)
    expect(view.receiver()).toBe(view)
    expect(() => view.mutateWithSuper()).toThrow()
    expect(() => view.mutateOwnProperty()).toThrow('config is readonly')
    expect(view.get('value')).toBe(1)
    expect(view.has('other')).toBe(false)
    expect((view as { marker?: number }).marker).toBeUndefined()
  })

  it('PH-T20b：Set subclass custom readers work, return the proxy, and cannot mutate via super', async () => {
    const set = new ConfigSetSubclass(['value'])
    const host = new Host()
    await host.use({ name: 'set-subclass', config: { set }, install: () => ({}) } as any)

    const view: any = host.config.get('set-subclass.set')
    expect(view).toBeInstanceOf(Set)
    expect(view.hasValue()).toBe(true)
    expect(view.receiver()).toBe(view)
    expect(() => view.mutateWithSuper()).toThrow()
    expect(() => view.mutateOwnProperty()).toThrow('config is readonly')
    expect(view.has('other')).toBe(false)
    expect((view as { marker?: number }).marker).toBeUndefined()
  })
})

describe('PH-R23：readonly Map/Set reader identity dispatch', () => {
  it('PH-T23a：all Map/Set reader overrides receive proxy, return proxy, and cannot super-mutate', async () => {
    const host = new Host()
    const sourceMap = new ReaderOverrideMap([['value', 1]])
    const sourceSet = new ReaderOverrideSet(['value'])
    await host.use({
      name: 'reader-overrides',
      config: {
        map: sourceMap,
        set: sourceSet
      },
      install: () => ({})
    } as any)

    const map: any = host.config.get('reader-overrides.map')
    const set: any = host.config.get('reader-overrides.set')
    expect(() => map.get('value')).toThrow()
    expect(() => map.has('value')).toThrow()
    expect(map.entries()).toBe(map)
    expect(map.keys()).toBe(map)
    expect(map.values()).toBe(map)
    expect(map.forEach()).toBe(map)
    expect(map[Symbol.iterator]()).toBe(map)
    expect(Reflect.apply(Map.prototype.has, sourceMap, ['leak'])).toBe(false)
    expect(map).toBeInstanceOf(Map)

    expect(() => set.has('value')).toThrow()
    expect(set.entries()).toBe(set)
    expect(set.keys()).toBe(set)
    expect(set.values()).toBe(set)
    expect(set.forEach()).toBe(set)
    expect(set[Symbol.iterator]()).toBe(set)
    expect(Reflect.apply(Set.prototype.has, sourceSet, ['leak'])).toBe(false)
    expect(set).toBeInstanceOf(Set)
  })

  it('PH-T23b：post-admission built-in prototype mutation never reclassifies custom readers as native', async () => {
    const host = new Host()
    await host.use({
      name: 'reader-prototype-mutation',
      config: { map: new Map([['value', 1]]), set: new Set(['value']) },
      install: () => ({})
    } as any)

    const map: any = host.config.get('reader-prototype-mutation.map')
    const set: any = host.config.get('reader-prototype-mutation.set')
    const mapGet = Map.prototype.get
    const setHas = Set.prototype.has
    try {
      Map.prototype.get = function (): any {
        return this
      }
      Set.prototype.has = function (): any {
        return this
      }
      expect(map.get('value')).toBe(map)
      expect(set.has('value')).toBe(set)
    } finally {
      Map.prototype.get = mapGet
      Set.prototype.has = setHas
    }
  })
})

describe('PH-R24：captured Map/Set traversal for clone and COW graph discovery', () => {
  it('PH-T24a：initial clone preserves hidden-iterator entries, aliases, and subclass prototypes', async () => {
    const config: any = { alias: { value: 1 } }
    const map = new HiddenIteratorMap()
    const set = new HiddenIteratorSet()
    config.map = map
    config.set = set
    config.self = config
    map.set('root', config)
    map.set('alias', config.alias)
    set.add(config)
    set.add(config.alias)

    const host = new Host()
    await host.use({ name: 'clone-hidden-iterators', config, install: () => ({}) } as any)
    const snapshot: any = host.config.get('clone-hidden-iterators')

    expect(snapshot.map).toBeInstanceOf(Map)
    expect(snapshot.set).toBeInstanceOf(Set)
    expect(snapshot.map.get('root')).toBe(snapshot)
    expect(snapshot.map.get('alias')).toBe(snapshot.alias)
    expect(snapshot.set.has(snapshot)).toBe(true)
    expect(snapshot.set.has(snapshot.alias)).toBe(true)
  })

  it('PH-T24b：COW graph discovery clones Map/Set root-reachers despite hidden Symbol.iterator', async () => {
    const config: any = { enabled: false }
    const map = new HiddenIteratorMap()
    const set = new HiddenIteratorSet()
    config.map = map
    config.set = set
    config.self = config
    map.set('root', config)
    set.add(config)

    const host = new Host()
    await host.use({ name: 'cow-hidden-iterators', config, install: () => ({}) } as any)
    const previous: any = host.config.get('cow-hidden-iterators')
    await host.config.update('cow-hidden-iterators', () => ({ enabled: true }))
    const next: any = host.config.get('cow-hidden-iterators')

    expect(next).not.toBe(previous)
    expect(next.map).not.toBe(previous.map)
    expect(next.set).not.toBe(previous.set)
    expect(next.map).toBeInstanceOf(Map)
    expect(next.set).toBeInstanceOf(Set)
    expect(next.map.get('root')).toBe(next)
    expect(next.set.has(next)).toBe(true)
    expect(previous.map.get('root')).toBe(previous)
    expect(previous.set.has(previous)).toBe(true)
  })
})

describe('PH-R21：patch-root cycle rebasing', () => {
  it('PH-T21a：patch root, nested backrefs, shared patch aliases, and old-root aliases rebase together', async () => {
    const host = new Host()
    await host.use({
      name: 'patch-root-cycle',
      config: { nested: { value: 1 } },
      install: () => ({})
    } as any)
    const previous: any = host.config.get('patch-root-cycle')
    const patchShared = { value: 2 }

    await host.config.update('patch-root-cycle', (seen) => {
      const patch: any = {
        self: undefined,
        nested: { back: undefined },
        shared: patchShared,
        sharedAlias: patchShared,
        oldRoot: seen,
        oldNested: seen.nested
      }
      patch.self = patch
      patch.nested.back = patch
      return patch
    })

    const next: any = host.config.get('patch-root-cycle')
    expect(next.self).toBe(next)
    expect(next.nested.back).toBe(next)
    expect(next.shared).toBe(next.sharedAlias)
    expect(next.oldRoot).toBe(next)
    expect(next.oldNested).toBe(previous.nested)
    expect(next).not.toBe(previous)
    expect(previous.nested.value).toBe(1)
  })

  it('PH-T21b：failed update with patch-root cycle leaves old root and aliases untouched', async () => {
    const cause = new Error('patch root update failed')
    const host = new Host()
    const config: Record<string, any> = { enabled: false }
    config.self = config
    await host.use({
      name: 'patch-root-rollback',
      config,
      install: () => ({}),
      update: () => {
        throw cause
      }
    } as any)
    const previous: any = host.config.get('patch-root-rollback')

    await expect(
      host.config.update('patch-root-rollback', (seen) => {
        const patch: any = { self: undefined, oldRoot: seen }
        patch.self = patch
        return patch
      })
    ).rejects.toBe(cause)

    const afterFailure: any = host.config.get('patch-root-rollback')
    expect(afterFailure).toBe(previous)
    expect(afterFailure.self).toBe(afterFailure)
    expect(afterFailure.oldRoot).toBeUndefined()
    expect(afterFailure.enabled).toBe(false)
  })
})

describe('PH-R25：callable config ownership', () => {
  it('PH-T25e：non-constructable methods keep dynamic readonly receivers without raw leaks', async () => {
    const config: Record<string, any> = {
      value: 11,
      method() {
        return this.value
      },
      receiver() {
        return this
      },
      arrow: () => 'arrow'
    }
    config.method.self = config.method
    config.method.root = config
    const host = new Host()

    await host.use({ name: 'callable-method-receiver', config, install: () => ({}) } as any)

    const root: any = host.config.get('callable-method-receiver')
    expect(root.method()).toBe(11)
    expect(root.receiver()).toBe(root)
    expect(root.arrow()).toBe('arrow')
    expect(root.method).not.toBe(config.method)
    expect(root.method.self).toBe(root.method)
    expect(root.method.root).toBe(root)
  })

  it('PH-T25f：constructable readonly callables use ordinary mutable instances and protect config', async () => {
    const Constructor: any = function (this: Record<string, unknown>): void {
      this.answer = 4
      this.newTargetMeta = (new.target as any).meta.value
      this.prototypeConfig = (this as any).settings.value
      try {
        ;(new.target as any).meta.value = 99
      } catch {
        this.configMutationBlocked = true
      }
      try {
        ;(this as any).settings.value = 99
      } catch {
        this.prototypeConfigMutationBlocked = true
      }
    }
    Constructor.meta = { value: 7 }
    Constructor.prototype.kind = 'base'
    Constructor.prototype.settings = { value: 3 }
    const host = new Host()

    await host.use({
      name: 'callable-construction-semantics',
      config: { Constructor },
      install: () => ({})
    } as any)

    const root: any = host.config.get('callable-construction-semantics')
    const instance = new root.Constructor()
    instance.after = true
    expect(instance.answer).toBe(4)
    expect(instance.newTargetMeta).toBe(7)
    expect(instance.prototypeConfig).toBe(3)
    expect(instance.configMutationBlocked).toBe(true)
    expect(instance.prototypeConfigMutationBlocked).toBe(true)
    expect(instance.kind).toBe('base')
    expect(instance.after).toBe(true)
    expect(instance instanceof root.Constructor).toBe(true)
    expect(Object.getPrototypeOf(instance)).not.toBe(root.Constructor.prototype)
    expect(root.Constructor.meta.value).toBe(7)

    class Derived extends root.Constructor {
      constructor() {
        super()
        this.derived = true
      }
    }
    const derived = new Derived()
    derived.afterDerived = true
    expect(derived instanceof Derived).toBe(true)
    expect(derived instanceof root.Constructor).toBe(true)
    expect(Object.getPrototypeOf(derived)).toBe(Derived.prototype)
    expect(derived.answer).toBe(4)
    expect(derived.derived).toBe(true)
    expect(derived.prototypeConfig).toBe(3)
    expect(derived.configMutationBlocked).toBe(true)
    expect(derived.prototypeConfigMutationBlocked).toBe(true)
    expect(derived.afterDerived).toBe(true)
    expect(root.Constructor.meta.value).toBe(7)
    expect(() => {
      root.Constructor.meta.value = 8
    }).toThrow('config is readonly')
  })

  it('PH-T25g：explicit object-return constructors preserve mutable result without raw leakage', async () => {
    const explicitResult: any = { kind: 'explicit' }
    const Constructor: any = function (): any {
      return explicitResult
    }
    const host = new Host()

    await host.use({
      name: 'callable-explicit-return',
      config: { Constructor },
      install: () => ({})
    } as any)

    const root: any = host.config.get('callable-explicit-return')
    const result = new root.Constructor()
    result.ownedByCaller = true
    expect(result).not.toBe(explicitResult)
    expect(result.kind).toBe('explicit')
    expect(result.ownedByCaller).toBe(true)
    expect(explicitResult.ownedByCaller).toBeUndefined()
  })

  it('PH-T25a：admission clones callable own data, so external mutation cannot alter snapshot', async () => {
    const callable: any = function (): string {
      return 'stable'
    }
    callable.meta = { value: 1 }
    const config = { callable } as Record<string, any>
    const host = new Host()

    await host.use({ name: 'callable-mutation', config, install: () => ({}) } as any)
    callable.meta.value = 2

    const view: any = host.config.get('callable-mutation.callable')
    expect(view()).toBe('stable')
    expect(view.meta.value).toBe(1)
    expect(() => {
      view.meta.value = 3
    }).toThrow('config is readonly')
  })

  it('PH-T25b：initial clone and COW rebase callable-to-root and callable-to-nested cycles', async () => {
    const callable: any = function (this: { value: number }): number {
      return this.value
    }
    const config: Record<string, any> = { value: 1, nested: { value: 2 }, callable }
    config.self = config
    config.nested.back = config
    callable.root = config
    callable.nested = config.nested
    callable.self = callable

    const host = new Host()
    await host.use({ name: 'callable-cycles', config, install: () => ({}) } as any)
    const previous: any = host.config.get('callable-cycles')
    expect(previous.callable.root).toBe(previous)
    expect(previous.callable.nested).toBe(previous.nested)
    expect(previous.callable.self).toBe(previous.callable)
    expect(previous.callable()).toBe(1)

    await host.config.update('callable-cycles', () => ({ value: 3 }))
    const next: any = host.config.get('callable-cycles')
    expect(next).not.toBe(previous)
    expect(next.callable).not.toBe(previous.callable)
    expect(next.callable.root).toBe(next)
    expect(next.callable.nested).toBe(next.nested)
    expect(next.callable.self).toBe(next.callable)
    expect(next.callable()).toBe(3)
    expect(previous.value).toBe(1)
    expect(previous.callable.root).toBe(previous)
  })

  it('PH-T25c：readonly callable preserves call receiver while blocking owned property writes', async () => {
    const callable: any = function (this: { value: number }): number {
      return this.value
    }
    callable.state = { value: 7 }
    const Constructed: any = function (this: { answer: number }): void {
      this.answer = 4
    }
    const host = new Host()
    await host.use({
      name: 'callable-receiver',
      config: { value: 9, callable, Constructed },
      install: () => ({})
    } as any)

    const root: any = host.config.get('callable-receiver')
    const view: any = root.callable
    expect(root.callable()).toBe(9)
    expect(view.state.value).toBe(7)
    expect(() => {
      view.state.value = 8
    }).toThrow('config is readonly')
    expect(() => {
      view.state = {}
    }).toThrow('config is readonly')
    const instance = new root.Constructed()
    expect(instance.answer).toBe(4)
  })

  it('PH-T25d：unsupported callable admission fails atomically and leaves host reusable', async () => {
    class Constructable {}
    expect(() =>
      new Host().use({
        name: 'callable-reject',
        config: { callable: Constructable },
        install: () => ({})
      } as any)
    ).toThrow(/config callable/)

    const host = new Host()
    await expect(
      host.use({
        name: 'callable-reject',
        config: {
          callable: function (): number {
            return 1
          }
        },
        install: () => ({})
      } as any)
    ).resolves.toMatchObject({ host })
  })
})

describe('#4 async lifecycle mutation admission', () => {
  it('fire-and-forget nested mutation fails at the lifecycle boundary', async () => {
    const host = new Host()
    const outer = host.use({
      name: 'outer',
      install: async () => {
        await Promise.resolve()
        expect(() => host.use({ name: 'inner', install: () => ({}) } as any)).toThrow(
          PluginHostError
        )
        return {}
      }
    } as any)
    await expect(outer).resolves.toMatchObject({ host })
  })

  it('directly awaited nested mutation fails before enqueue', async () => {
    const host = new Host()
    const outer = host.use({
      name: 'outer2',
      install: async () => {
        await expect(
          Promise.resolve().then(() => {
            expect(() => host.use({ name: 'inner2', install: () => ({}) } as any)).toThrow(
              PluginHostError
            )
          })
        ).resolves.toBeUndefined()
        return {}
      }
    } as any)
    await expect(outer).resolves.toMatchObject({ host })
  })

  it('rejects external mutation while an async lifecycle hook is pending', async () => {
    const host = new Host({ execution: { mutationTimeoutMs: 100, pipelineDrainTimeoutMs: 100 } })
    const slow = host.use({
      name: 'outer3',
      install: async () => new Promise(() => undefined)
    } as any)
    expect(() => host.use({ name: 'inner3', install: () => ({}) } as any)).toThrow(PluginHostError)
    void slow.catch(() => undefined)
    await host.dispose()
  })
})

describe('#5 扩展属性被外部覆写后，unUse 静默放弃卸载', () => {
  it('覆写后 unUse 不删属性，导致同名插件再也装不回去', async () => {
    const host = new Host()
    await host.use({ name: 'p', install: () => ({ token: 'a' }) } as any)

    ;(host as any).token = 'hijacked'
    await host.unUse('p')

    expect((host as any).token).toBe('hijacked')
    const view = await host.use({ name: 'p', install: () => ({ token: 'b' }) } as any)
    expect(view.extensions.token).toBe('b')
  })
})

describe('#6（重新裁定，见 SDD §5.6/M-T15）useSync 回滚改为两阶段：close 同步 + dispose 异步', () => {
  // §5.6：useSync 的同步性只覆盖 close（撤销 extensions/registrations/shared 等 host 可见状态），
  // 不再覆盖实际跑 disposer——那部分和普通异步 dispose 走同一条路径，fire-and-forget，失败通过
  // diagnostic 通道上报，不再折进 useSync 同步抛出的错误链。原始构造错误（install-boom）保持为
  // useSync 抛出错误的唯一原因（primary），不会被 rollback 结果改写（对齐 M-T44 的 L-T39 口径）。
  it('同步 disposer 抛出的错误不再折进同步抛出链，而是通过 diagnostic 异步上报', async () => {
    const diagnostics: string[] = []
    const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) } as any)
    const rollback = new Error('rollback-boom')

    let thrown: any
    try {
      host.install([
        {
          name: 'first',
          install: (core: any) => {
            core.onDispose(() => {
              throw rollback
            })
            return {}
          }
        },
        {
          name: 'second',
          install: () => {
            throw new Error('install-boom')
          }
        }
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown?.code).toBe('PLUGIN_INSTALL_FAILED')
    expect(String(thrown?.cause?.message ?? thrown?.cause)).toContain('install-boom')
    expect(thrown?.detail?.failedName).toBe('second')
    expect(thrown?.detail?.rollbackErrors).toEqual([])
    expect(diagnostics.join('|')).not.toContain('install-boom') // 不重复上报构造错误本身

    await new Promise((resolve) => setTimeout(resolve, 20)) // 等 fire-and-forget 的 rollback 落地
    const finalDetail = await thrown?.detail?.completion
    expect(finalDetail?.rollbackErrors?.[0]).toBe(rollback)
    expect(thrown?.detail?.rollbackErrors).toEqual([])
    expect(diagnostics.join('|')).toContain('rollback-boom')
  })

  it('异步 disposer 在 useSync 里注册时不再被拒绝，回滚仍然正确执行（M-T15）', async () => {
    const host = new Host()
    let asyncDisposerRan = false

    let thrown: any
    try {
      host.install([
        {
          name: 'first',
          install: (core: any) => {
            core.onDispose(async () => {
              await new Promise((resolve) => setTimeout(resolve, 10))
              asyncDisposerRan = true
            })
            return {}
          }
        },
        {
          name: 'second',
          install: () => {
            throw new Error('install-boom')
          }
        }
      ])
    } catch (error) {
      thrown = error
    }

    expect(thrown?.code).toBe('PLUGIN_INSTALL_FAILED') // 注册时不再拒绝，失败原因仍是原始构造错误
    expect(asyncDisposerRan).toBe(false) // 还没来得及跑

    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(asyncDisposerRan).toBe(true) // 回滚异步执行后，async disposer 确实跑完了
  })
})

describe('#7（批次0）registerStage 对同一函数重复注册的不变量', () => {
  it('钉住"删任意匹配项都等价"这一假设——同一函数注册两次，卸载后一次都不残留', async () => {
    const host = new Host()
    let runs = 0
    const stage = (value: string, next: (v: string) => void): void => {
      runs += 1
      next(value)
    }

    await host.use({
      name: 'dup2',
      install: (core: any) => {
        core.usePipeline(stage)
        core.usePipeline(stage)
        return {}
      }
    } as any)

    ;(host as any).runPipeline('x', () => {})
    expect(runs).toBe(2) // 两次注册各跑一次

    await host.unUse('dup2')
    runs = 0
    ;(host as any).runPipeline('x', () => {})
    expect(runs).toBe(0) // 卸载后一次都不残留——验证"删任意匹配项都等价"这条假设站得住
  })
})

describe('#8（批次0）非枚举扩展键被静默跳过', () => {
  it('install 返回值上的非枚举属性会被明确拒绝', async () => {
    const host = new Host()
    const extension: Record<string, unknown> = {}
    Object.defineProperty(extension, 'hidden', {
      value: 'secret',
      enumerable: false,
      configurable: true,
      writable: true
    })

    await expect(host.use({ name: 'p', install: () => extension } as any)).resolves.toBeDefined()
    expect((host as any).hidden).toBeUndefined()
  })
})

describe('second adversarial pass (R3, fixed)', () => {
  it('R4-1: concurrent dispose is terminal and is not evicted by ordinary mutation SLA', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host({
        execution: { mutationTimeoutMs: 5_000, pipelineDrainTimeoutMs: 100 }
      })
      const install = host.use({
        name: 'slow-dispose',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 6_000))
          return {}
        }
      } as any)
      void install.catch(() => undefined)
      const dispose = host.dispose()
      await vi.advanceTimersByTimeAsync(5_000)
      await expect(install).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
      await expect(dispose).resolves.toMatchObject({ logicalTerminal: true })
      await expect(host.dispose()).resolves.toMatchObject({ logicalTerminal: true })
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R3-1 (redesigned per SDD §10.1): a legitimate external mutation behind a slow install waits out the 5s SLA and is rejected with MUTATION_QUEUE_TIMEOUT, not silently diagnosed', async () => {
    vi.useFakeTimers()
    try {
      const diagnostics: string[] = []
      const diagnosedHost = new Host({
        diagnostic: (message: string) => diagnostics.push(message),
        queueAdmissionTimeoutMs: 5_000
      } as any)
      const slow = diagnosedHost.use({
        name: 'slow',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10_000))
          return {}
        }
      } as any)
      expect(() => diagnosedHost.use({ name: 'external', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )
      expect(diagnostics).toHaveLength(0)

      await vi.advanceTimersByTimeAsync(10_000) // slow's own 10s timer fires
      await expect(slow).resolves.toBeDefined()
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R3-2 superseded by §5.6/M-T15: an async disposer registered during useSync is no longer rejected at all', () => {
    const host = new Host()
    let started = false

    expect(() =>
      host.install([
        {
          name: 'async-tail',
          install: (core: any) => {
            core.onDispose(async () => {
              started = true
              await new Promise((resolve) => setTimeout(resolve, 10))
            })
            return {}
          }
        }
      ])
    ).not.toThrow() // no install failure here, so no rollback either — nothing rejects registration
    expect(started).toBe(false) // the disposer itself hasn't run — the plugin was never disposed
  })

  it('PH-R3-3 fixed: non-enumerable extension omission is reported through the diagnostic channel', async () => {
    const diagnostics: string[] = []
    const host = new Host({ diagnostic: (message: string) => diagnostics.push(message) })
    const extension = {}
    Object.defineProperty(extension, 'hidden', { value: 1, enumerable: false })
    await host.use({ name: 'hidden', install: () => extension } as any)
    expect(diagnostics).toHaveLength(1)
    expect(diagnostics[0]).toMatch(/hidden/)
    expect((host as any).hidden).toBeUndefined()
  })

  it('PH-R3-4 fixed: a queued mutation that settles before the watchdog fires clears its timer immediately', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      const first = host.use({
        name: 'first',
        install: async () => {
          await new Promise((resolve) => setTimeout(resolve, 100))
          return {}
        }
      } as any)
      expect(() => host.use({ name: 'second', install: () => ({}) } as any)).toThrow(
        PluginHostError
      )

      await vi.advanceTimersByTimeAsync(100)
      await expect(first).resolves.toBeDefined()

      // If the watchdog for "second" were still armed, it would still be sitting in the
      // timer queue for up to 5s after settlement. Assert there is nothing left pending.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('a resource disposer that never settles is recorded as DISPOSE_STEP_TIMEOUT and disposal still moves on to the rest', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      let laterDisposerRan = false
      await host.use({
        name: 'stuck-disposer',
        install: (core: any) => {
          core.onDispose(() => new Promise(() => undefined)) // never settles
          core.onDispose(() => {
            laterDisposerRan = true // registered first, so it's the *later* one in LIFO order
          })
          return {}
        }
      } as any)

      const unUse = host.unUse('stuck-disposer')
      await vi.advanceTimersByTimeAsync(5_000)
      const outcome = await unUse
      expect(laterDisposerRan).toBe(true) // the timed-out step didn't block the rest of the group
      expect((outcome as any).ok).toBe(false)
      expect((outcome as any).error.code).toBe('PLUGIN_DISPOSE_FAILED')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fifth adversarial pass (R5)', () => {
  it('PH-R5-1: a plugin dispose hook that awaits host.dispose() again must not deadlock the host forever', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
      await host.use({
        name: 'self-disposer',
        install: () => ({}),
        // #hookRegistration is cleared before the first await (same timing PH4 exploited for
        // use()); the reentrant dispose() call below returns the very #disposePromise this
        // hook is blocking on, so nothing outside a bounded wait can ever unblock it.
        dispose: async () => {
          await Promise.resolve()
          await host.dispose().catch(() => undefined)
        }
      } as any)

      const dispose = host.dispose()
      let settled = false
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose
        .catch(() => undefined)
        .finally(() => (settled = true))
        .catch(() => undefined)

      expect(settled).toBe(false)
      // Advance far past any bounded wait a fix could plausibly use; a genuine deadlock stays
      // unsettled no matter how much (virtual) time passes because no timer ever drives it.
      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(settled).toBe(true)

      // Not just "some promise settled" — the host itself must reach a real terminal state,
      // not stay silently stuck in `closing` while dispose()'s own promise resolves/rejects.
      // use() throws HOST_DISPOSED synchronously (#assertActive runs before any enqueue), so
      // this is a plain throw, not a rejection.
      expect(() => host.use({ name: 'after', install: () => ({}) } as any)).toThrow(
        expect.objectContaining({ code: 'HOST_DISPOSED' })
      )
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R5-1: the same reentrant call via a resource disposer (no #hookRegistration guard at all) also converges', async () => {
    vi.useFakeTimers()
    try {
      const host = new Host()
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
            await Promise.resolve()
            await host.dispose().catch(() => undefined)
          })
          return {}
        }
      } as any)

      const dispose = host.dispose()
      let settled = false
      // Chain catch() before finally(): finally() returns its own derived promise that re-rejects
      // with the same reason, so attaching it separately from catch() (rather than chaining) would
      // leave that derived promise's rejection with no handler of its own.
      void dispose
        .catch(() => undefined)
        .finally(() => (settled = true))
        .catch(() => undefined)

      await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000)
      expect(settled).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('PH-R5-2: ERROR_TEXT carries no dead diagnostic text left over from the superseded diagnostic-only watchdog', async () => {
    const errorTextModule = await import('../src/error-text')
    expect(Object.hasOwn(errorTextModule.default, 'QUEUE_WATCHDOG_TIMEOUT')).toBe(false)
  })
})
