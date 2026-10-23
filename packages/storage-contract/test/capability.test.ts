import { describe, expect, expectTypeOf, it, vi } from 'vitest'
import {
  defineStorageCapability,
  implement,
  provideCapabilities,
  hasStorageCapability,
  useStorageCapability,
  kv,
  records,
  StorageContractErrorCode,
  type ICapabilityInstallPort,
  type IStorageBase,
  type IStorageStore,
  type IStorageCapabilitySet,
  type IStorageImplementationsOf,
  type IKeyValueApi,
  type ICapabilityStore,
  type ICapabilityImpl,
  type IRecordsApi,
  type ITransactionBuilder,
  type IWithChainMethods
} from '../src/index.js'

/** Builds a resource-backed base without assuming any KV or transaction behavior. */
function createBase() {
  /** Both cleanup entries reuse one local lifetime without owning any external client. */
  const primary = Promise.resolve()
  /** Symbol cleanup retains a distinct cached Promise. */
  const symbolic = primary.then(() => undefined)
  /** Disposal is observed so failed admission cannot silently acquire ownership. */
  const dispose = vi.fn(() => primary)
  return {
    backend: 'example-catalog',
    capabilities: {
      syncRead: false,
      binary: false,
      records: false,
      transactions: false,
      iteration: false,
      secondaryIndexes: false,
      changeFeed: false,
      maxValueBytes: undefined,
      opaqueEntries: false
    },
    dispose,
    [Symbol.asyncDispose]: () => symbolic
  } satisfies IStorageBase
}

describe('capability identity and provider ownership', () => {
  it('admits the original six synchronous methods while retaining the complete root API', () => {
    /** Sync owns exactly its public six-method channel, without an invented clearAll method. */
    const sync: NonNullable<IKeyValueApi['sync']> = {
      get: () => null,
      set: () => undefined,
      remove: () => undefined,
      has: () => false,
      keys: () => [],
      clearValues: () => undefined
    }
    /** The async root still requires its separate clearAll endpoint. */
    const api: IKeyValueApi = {
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined,
      sync
    }
    const store = provideCapabilities(createBase(), [implement(kv, api)])
    expect(store.sync).toBe(sync)
    expect(store.use(kv)).toBe(api)
    expect(Object.keys(store.sync!)).toHaveLength(6)
    expect(() =>
      provideCapabilities(createBase(), [
        implement(kv, { ...api, sync: { ...sync, clearValues: undefined } } as never)
      ])
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    expect(() =>
      provideCapabilities(createBase(), [implement(kv, { ...api, clearAll: undefined } as never)])
    ).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
  })

  it('shares read-only token access for provided, raw and frozen resources without modifying them', () => {
    /** A native refinement must survive the read-only type projection as it does on store.use. */
    const token = defineStorageCapability<{ read(): string }>()('readonly-catalog')
    /** Exact implementation identity is retained through both public paths. */
    const api = { read: () => 'value', native: () => 7 }
    /** Backend identity must stay captured even when its getter later changes. */
    let reads = 0
    const base = {
      ...createBase(),
      get backend() {
        reads++
        return reads === 1 ? 'original-backend' : 'changed-backend'
      }
    }
    const store = provideCapabilities(base, [implement(token, api)])
    Object.freeze(store)
    expect(hasStorageCapability(store, token)).toBe(store.has(token))
    expect(useStorageCapability(store, token)).toBe(store.use(token))
    expect(useStorageCapability(store, token)).toBe(api)
    expectTypeOf(useStorageCapability(store, token)).toEqualTypeOf<typeof api>()
    expect(useStorageCapability(store, token).native()).toBe(7)
    const missing = defineStorageCapability<{ read(): string }>()('missing')
    for (const read of [
      () => store.use(missing as never),
      () => useStorageCapability(store, missing)
    ]) {
      expect(read).toThrowError(
        expect.objectContaining({
          source: '@migaia/storage-contract',
          code: 'UNSUPPORTED_CAPABILITY',
          backend: 'original-backend',
          message: 'backend original-backend does not provide capability missing'
        })
      )
    }
    expect(reads).toBe(1)
    const forged = { name: token.name } as typeof token
    expect(hasStorageCapability(store, forged)).toBe(store.has(forged))
    for (const read of [() => store.use(forged), () => useStorageCapability(store, forged)])
      expect(read).toThrowError(expect.objectContaining({ code: 'INVALID_ARGUMENT' }))
    for (const raw of [createBase(), Object.freeze(createBase())]) {
      /** Reads leave raw own-property descriptors and cleanup call counts unchanged. */
      const descriptors = Object.getOwnPropertyDescriptors(raw)
      expect(hasStorageCapability(raw, token)).toBe(false)
      expect(() => useStorageCapability(raw, token)).toThrowError(
        expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY', backend: 'example-catalog' })
      )
      expect(Object.getOwnPropertyDescriptors(raw)).toEqual(descriptors)
      expect(raw.dispose).not.toHaveBeenCalled()
    }
  })

  it('observes late Feature publication through the same read-only lookup while retaining key has', async () => {
    const token = defineStorageCapability<{ value(): number }>()('late-readonly')
    const api = { value: () => 3 }
    let installer!: ICapabilityInstallPort
    const store = provideCapabilities(createBase(), [], {
      onInstaller: (port) => {
        installer = port
      }
    })
    const publication = installer.prepare([implement(token, api)])
    expect(hasStorageCapability(store, token)).toBe(false)
    expect(() => useStorageCapability(store, token)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    publication.publish()
    expect(hasStorageCapability(store, token)).toBe(store.has(token))
    expect(useStorageCapability(store, token)).toBe(store.use(token as never))
    expect(useStorageCapability(store, token)).toBe(api)
    publication.release()
    expect(hasStorageCapability(store, token)).toBe(store.has(token))
    expect(() => useStorageCapability(store, token)).toThrowError(
      expect.objectContaining({ code: 'UNSUPPORTED_CAPABILITY' })
    )
    const keyHas = vi.fn(async (key: string) => key === 'present')
    const kvApi: IKeyValueApi = {
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: keyHas,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined
    }
    const kvStore = provideCapabilities(createBase(), [implement(kv, kvApi)])
    await expect(kvStore.has('present')).resolves.toBe(true)
    expect(keyHas).toHaveBeenCalledOnce()
    expect(hasStorageCapability(kvStore, kv)).toBe(true)
    expect(useStorageCapability(kvStore, kv)).toBe(kvApi)
  })
  it('freezes tokens and implementation records without trusting matching names', () => {
    /** Equal diagnostic names deliberately do not imply equal capability authority. */
    const first = defineStorageCapability<{ read(): string }>()('catalog')
    /** This independent token must remain unsupported by the first token provider. */
    const other = defineStorageCapability<{ read(): string }>()('catalog')
    /** The backend owns this API; provider returns this exact object. */
    const api = { read: () => 'value' }
    /** Frozen public descriptor is authenticated by its private identity. */
    const descriptor = implement(first, api)
    /** Base owns resource cleanup; token registration adds no data store. */
    const base = createBase()
    /** Provider modifies this same base without cloning extra members. */
    const store = provideCapabilities(base, [descriptor])
    expect(Object.isFrozen(first)).toBe(true)
    expect(Object.isFrozen(descriptor)).toBe(true)
    expect(store === base).toBe(true)
    expect(store.use(first)).toBe(api)
    expect(store.has(first)).toBe(true)
    expect(store.has(other)).toBe(false)
    expect(store.has({ name: first.name } as never)).toBe(false)
    expect(() => store.use({ name: first.name } as never)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
    expect(() => store.use(other)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.unsupported, backend: base.backend })
    )
    expect(() => store.use(other)).toThrow(/catalog/)
    expect(() => implement({ name: 'catalog' } as typeof first, api)).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
    expect(base.dispose).not.toHaveBeenCalled()
  })

  it('retains class members and nonenumerable descriptors', () => {
    /** Contract base provides the complete lifecycle implementation for this fixture. */
    const resource = createBase()
    /** A legitimate class provider may expose methods through its prototype. */
    class Catalog {
      /** Preserve backend identity and capability facts without changing their ownership. */
      readonly backend = resource.backend
      /** Facts are the same complete descriptor used by any other backend base. */
      readonly capabilities = resource.capabilities
      /** Explicit cleanup delegates to the existing resource owner. */
      dispose(): Promise<void> {
        return resource.dispose()
      }
      /** Symbolic cleanup delegates to the same resource's distinct cached Promise. */
      [Symbol.asyncDispose](): Promise<void> {
        return resource[Symbol.asyncDispose]()
      }
      /** A provider must not erase unrelated class behavior by spreading the instance. */
      label(): string {
        return 'catalog'
      }
    }
    /** Hidden metadata is intentionally outside Object.keys and object spread. */
    const base = new Catalog()
    Object.defineProperty(base, 'hidden', { value: 42, enumerable: false })
    /** Empty capabilities still establish a valid specialized resource-backed base. */
    const store = provideCapabilities(base, [])
    expect(store === base).toBe(true)
    expect(store.label()).toBe('catalog')
    expect(Object.getOwnPropertyDescriptor(store, 'hidden')).toEqual({
      value: 42,
      enumerable: false,
      writable: false,
      configurable: false
    })
  })

  it('rejects complete invalid batches before acquiring or modifying the base', () => {
    /** Only authentic implementations can supply this business API. */
    const token = defineStorageCapability<{ get(): number }>()('number')
    /** Valid descriptor is duplicated and imitated in separate admission failures. */
    const descriptor = implement(token, { get: () => 1 })
    for (const entries of [
      [descriptor, descriptor],
      [{ capability: token, api: descriptor.api }]
    ]) {
      /** Every failed admission receives an independent unmodified resource base. */
      const base = createBase()
      expect(() => provideCapabilities(base, entries as never)).toThrow(
        expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
      )
      expect(Object.hasOwn(base, 'use')).toBe(false)
      expect(Object.hasOwn(base, 'has')).toBe(false)
      expect(base.dispose).not.toHaveBeenCalled()
      expect(provideCapabilities(base, [descriptor]).has(token)).toBe(true)
    }
  })

  it('refuses unreplaceable admission methods and duplicate provider ownership', () => {
    /** Nonconfigurable use cannot be replaced atomically by the provider. */
    const locked = createBase()
    Object.defineProperty(locked, 'use', { value: () => undefined, configurable: false })
    expect(() => provideCapabilities(locked, [])).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
    expect(locked.dispose).not.toHaveBeenCalled()
    /** A real provided store cannot acquire a second capability map. */
    const base = createBase()
    provideCapabilities(base, [])
    expect(() => provideCapabilities(base, [])).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
  })

  it('does not modify the base when the installer callback fails', () => {
    /** Callback failure is a construction failure before any store methods are published. */
    const original = new Error('installer capture failed')
    /** Base remains owned by its factory when capture fails. */
    const base = createBase()
    expect(() =>
      provideCapabilities(base, [], {
        onInstaller() {
          throw original
        }
      })
    ).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument, cause: original })
    )
    expect(Object.hasOwn(base, 'use')).toBe(false)
    expect(base.dispose).not.toHaveBeenCalled()
    expect(provideCapabilities(base, []).has({ name: 'fake' } as never)).toBe(false)
  })
})

describe('capability publication', () => {
  it('normalizes a Feature API getter failure without publishing a partial batch', () => {
    /** Parent host captures this store's only installation port. */
    let installer!: ICapabilityInstallPort
    /** Specialized base has no native KV implementation to mask a failed Feature. */
    const store = provideCapabilities(createBase(), [], {
      onInstaller: (port) => {
        installer = port
      }
    })
    /** Preserve the exact reflected API failure on the contract error cause. */
    const original = new Error('feature method getter failed')
    /** A typed descriptor can still expose an accessor that fails during standard admission. */
    const api = {
      get get() {
        throw original
      }
    } as unknown as IKeyValueApi
    expect(() => installer.prepare([implement(kv, api)])).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument, cause: original })
    )
    expect(store.has(kv)).toBe(false)
    expect(Object.hasOwn(store, 'get')).toBe(false)
  })

  it('prepares invisibly, publishes into the original map and releases once', () => {
    /** Feature capability lives beside native capabilities in one provider table. */
    const token = defineStorageCapability<{ value(): number }>()('feature')
    /** Captures only the original provider-issued authority. */
    let installer!: ICapabilityInstallPort
    /** No initial capabilities are statically granted to this store. */
    const store = provideCapabilities(createBase(), [], {
      onInstaller: (port) => {
        installer = port
      }
    })
    /** Native implementation record remains the same through preparation and publication. */
    const descriptor = implement(token, { value: () => 42 })
    /** Preparation reserves the token while keeping it unavailable to callers. */
    const publication = installer.prepare([descriptor])
    expect(store.has(token)).toBe(false)
    expect(() => installer.prepare([descriptor])).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
    publication.publish()
    publication.publish()
    expect(store.has(token)).toBe(true)
    expect(store.use(token as never)).toBe(descriptor.api)
    publication.release()
    publication.release()
    publication.publish()
    expect(store.has(token)).toBe(false)
    /** Released authority cannot prevent a later independent publication of the same token. */
    const replacement = installer.prepare([descriptor])
    replacement.publish()
    publication.release()
    expect(store.has(token)).toBe(true)
  })
})

describe('standard KV capability forwarding', () => {
  it('captures a transaction binder privately without executing it during provider admission', () => {
    /** Root API remains independent of the transaction-owned projection callback. */
    const api: IKeyValueApi = {
      get: async () => null,
      set: async () => undefined,
      remove: async () => undefined,
      has: async () => false,
      keys: async () => [],
      clearValues: async () => undefined,
      clearAll: async () => undefined
    }
    /** Only the original transaction owner may invoke this binder after scope admission. */
    const forTransaction = vi.fn(() => ({
      ...api,
      getMany: async () => [],
      setMany: async () => undefined,
      removeMany: async () => 0,
      removeByPrefix: async () => 0
    }))
    /** Public implementation records expose only token and root API. */
    const descriptor = implement(kv, api, { forTransaction })
    /** Ordinary provider admission performs no scope or transaction work. */
    const store = provideCapabilities(createBase(), [descriptor])
    expect(store.use(kv)).toBe(api)
    expect(Object.hasOwn(descriptor, 'forTransaction')).toBe(false)
    expect(forTransaction).not.toHaveBeenCalled()
  })

  it('publishes and releases a Feature-provided KV surface through the same installation port', async () => {
    /** Specialized bases gain no string methods until a real KV implementation is published. */
    const base = createBase()
    /** Host captures the single provider-owned installer instead of creating another registry. */
    let installer!: ICapabilityInstallPort
    /** The actual store remains the original base through every publication state. */
    const store = provideCapabilities(base, [], {
      onInstaller: (port) => {
        installer = port
      }
    })
    /** A complete Feature API supplies ordinary KV behavior without a second store object. */
    const api: IKeyValueApi = {
      get: async () => 'value',
      set: async () => undefined,
      remove: async () => undefined,
      has: async (key) => key === 'saved',
      keys: async () => ['saved'],
      clearValues: async () => undefined,
      clearAll: async () => undefined
    }
    /** Preparation is invisible; the original publication point makes both views available. */
    const publication = installer.prepare([implement(kv, api)])
    expect(Object.hasOwn(store, 'get')).toBe(false)
    publication.publish()
    expect(store.use(kv as never)).toBe(api)
    await expect((store as unknown as IKeyValueApi).get('saved')).resolves.toBe('value')
    await expect((store as unknown as IKeyValueApi).has('saved')).resolves.toBe(true)
    publication.release()
    expect(Object.hasOwn(store, 'get')).toBe(false)
    expect(store.has(kv)).toBe(false)
  })

  it('preserves method receivers, Promise identity and both has domains', async () => {
    /** One Promise makes accidental async wrappers observable. */
    const pending = Promise.resolve('value')
    /** Capture contexts and receiver identity at the backend operation boundary. */
    const calls: unknown[] = []
    /** Complete standard KV surface remains owned by this API object. */
    const api: IKeyValueApi & { readonly tag: string } = {
      tag: 'original receiver',
      get(key, context) {
        calls.push([this.tag, key, context])
        return pending
      },
      set: async () => undefined,
      remove: async () => undefined,
      has(key, context) {
        calls.push([this.tag, key, context])
        return Promise.resolve(key === 'saved')
      },
      keys: async () => ['saved'],
      clearValues: async () => undefined,
      clearAll: async () => undefined
    }
    /** Provider flattens only the real standard KV implementation. */
    const store = provideCapabilities(createBase(), [implement(kv, api)])
    /** Exact operation options must reach the original implementation once. */
    const context = { timeoutMs: 1 }
    expect(store.get('saved', context)).toBe(pending)
    expect(store.use(kv)).toBe(api)
    expect(store.has(kv)).toBe(true)
    await expect(store.has('saved', context)).resolves.toBe(true)
    expect(calls).toEqual([
      ['original receiver', 'saved', context],
      ['original receiver', 'saved', context]
    ])
    expectTypeOf(store.use(kv).tag).toEqualTypeOf<string>()
  })

  it('rejects a falsely declared KV API before installing any capability', () => {
    /** Base remains untouched when a standard contract's required methods are absent. */
    const base = createBase()
    expect(() => provideCapabilities(base, [implement(kv, {} as IKeyValueApi)])).toThrow(
      expect.objectContaining({ code: StorageContractErrorCode.invalidArgument })
    )
    expect(Object.hasOwn(base, 'use')).toBe(false)
    expect(base.dispose).not.toHaveBeenCalled()
  })
})

describe('capability type boundaries', () => {
  it('preserves concrete transaction scopes and both builder augmentation layers', () => {
    /** Concrete backend scope members must survive provider and host type projection. */
    type IScope = {
      readonly native: 'same-connection'
      getRecord(key: string): Promise<string | undefined>
    }
    /** The original backend has a precise option and an existing chain method. */
    type IBackend = IStorageBase & {
      transaction<T>(
        run: (scope: IScope) => T,
        options?: { readonly isolation: 'native' }
      ): Promise<Awaited<T>>
      tx(): ITransactionBuilder<IScope, { existing(): string }>
    }
    /** Capability publication must preserve the original complete scope and options. */
    type IProvided = ICapabilityStore<IBackend, never>
    /** Host additions extend the original builder's second generic instead of replacing it. */
    type IEnhanced = IWithChainMethods<IProvided, { readonly tx: { added(): number } }>
    expectTypeOf<
      Pick<Parameters<Parameters<IProvided['transaction']>[0]>[0], keyof IScope>
    >().toEqualTypeOf<IScope>()
    expectTypeOf<Parameters<IProvided['transaction']>[1]>().toEqualTypeOf<
      { readonly isolation: 'native' } | undefined
    >()
    expectTypeOf<ReturnType<IEnhanced['tx']>['existing']>().toEqualTypeOf<() => string>()
    expectTypeOf<ReturnType<IEnhanced['tx']>['added']>().toEqualTypeOf<() => number>()
    expectTypeOf<
      Pick<
        Parameters<Parameters<ReturnType<ReturnType<IEnhanced['tx']>['lock']>['run']>[0]>[0],
        keyof IScope
      >
    >().toEqualTypeOf<IScope>()
    /** A specialized transaction builder has no lock method and keeps that public shape. */
    type ISpecializedBuilder = {
      run<T>(run: (scope: IScope) => T): Promise<Awaited<T>>
      specialized(): string
    }
    /** Native no-lock builders must survive both provider and authoring projections. */
    type ISpecialized = IWithChainMethods<
      ICapabilityStore<Omit<IBackend, 'tx'> & { tx(): ISpecializedBuilder }, never>,
      { readonly tx: { added(): number } }
    >
    expectTypeOf<ReturnType<ISpecialized['tx']>['specialized']>().toEqualTypeOf<() => string>()
    expectTypeOf<ReturnType<ISpecialized['tx']>['added']>().toEqualTypeOf<() => number>()
  })

  it('retains exact APIs and rejects capability-set widening', () => {
    /** Distinct names make static capability-set boundaries observable. */
    const read = defineStorageCapability<{ read(): string }>()('read')
    /** This independently declared capability is absent from read-only stores. */
    const write = defineStorageCapability<{ write(): void }>()('write')
    /** Superset store can be passed to a component requiring only read. */
    const complete = provideCapabilities(createBase(), [
      implement(read, { read: () => 'value' }),
      implement(write, { write: () => undefined })
    ])
    /** Subset store must not claim the additional write capability. */
    const subset = provideCapabilities(createBase(), [implement(read, { read: () => 'value' })])
    /** A component's static requirement does not create its own registration table. */
    const consumeRead = (store: IStorageStore<typeof read>): string => store.use(read).read()
    expect(consumeRead(complete)).toBe('value')
    expectTypeOf<IStorageCapabilitySet<typeof complete>>().toEqualTypeOf<
      typeof read | typeof write
    >()
    expectTypeOf<IStorageImplementationsOf<typeof subset>[0]['api']['read']>().toEqualTypeOf<
      () => string
    >()
    /** These compile-only calls cannot run because they intentionally violate public contracts. */
    function invalidTypes(): void {
      // @ts-expect-error Missing write cannot be widened into a full-capability component.
      const widened: IStorageStore<typeof read | typeof write> = subset
      void widened
      // @ts-expect-error NoInfer keeps a missing API member from changing the token's contract.
      implement(read, { write: () => undefined })
      // @ts-expect-error A non-KV specialized store has no string-key has overload.
      subset.has('saved')
      // @ts-expect-error Subset use cannot claim an uninstalled token.
      subset.use(write)
    }
    void invalidTypes
  })
})

describe('record query Feature type projection', () => {
  it('keeps native capability members and other tokens while carrying query methods through selection', () => {
    /** An unrelated token must retain the exact supplied native API. */
    const native = defineStorageCapability<{ readonly value: 'native' }>()('projection-native')
    /** Original capability metadata owns the APIs; no runtime brand or method is fabricated. */
    type IOriginal = ICapabilityStore<
      IStorageBase,
      typeof records | typeof native,
      readonly [
        ICapabilityImpl<
          typeof records,
          IRecordsApi<{ readonly id: string }> & { readonly nativeApi: 'kept' }
        >,
        ICapabilityImpl<typeof native, { readonly value: 'native'; readonly extra: 7 }>
      ]
    >
    /** Host pure metadata carries only the actual selected method group. */
    type IEnhanced = IWithChainMethods<
      IOriginal,
      { readonly query: { tag(): 'tagged'; live(): Promise<string> } }
    >
    /** Compile-only calls model the real host's explicit entity row domain. */
    function validTypes(store: IEnhanced, original: IOriginal): void {
      const query = store
        .use(records)
        .query<{ id: string; active: boolean }>()
        .where({ active: true })
      expectTypeOf(query.tag()).toEqualTypeOf<'tagged'>()
      expectTypeOf(query.select('id').tag()).toEqualTypeOf<'tagged'>()
      expectTypeOf(query.select((row) => row.id).live()).toEqualTypeOf<Promise<string>>()
      expectTypeOf(store.use(records).nativeApi).toEqualTypeOf<'kept'>()
      expectTypeOf(store.use(native).extra).toEqualTypeOf<7>()
      // @ts-expect-error Zero-Feature queries have no selected Feature method.
      original.use(records).query().tag()
    }
    void validTypes
  })
})
