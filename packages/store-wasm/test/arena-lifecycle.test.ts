import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { createWasmModuleMock } from './support/wasm-fake.ts'
import { makeFieldContext } from './support/field-context.ts'

/** Only the public allocator exports are replaceable; the helper owns real linear memory. */
type IWasmModule = ReturnType<typeof createWasmModuleMock> & {
  alloc_bytes: ReturnType<typeof vi.fn<(byteLen: number) => number>>
  dealloc_bytes: ReturnType<typeof vi.fn<(id: number) => boolean>>
}

vi.mock('@migaia/wasm', async () => {
  /** The established allocator fixture retains its allocation table and real Memory internally. */
  const { createWasmModuleMock } = await import('./support/wasm-fake.ts')
  /** Wrap only the native exports whose failure contracts this package must preserve. */
  const native = createWasmModuleMock()
  return {
    ...native,
    alloc_bytes: vi.fn(native.alloc_bytes),
    dealloc_bytes: vi.fn(native.dealloc_bytes)
  }
})

/** Public module instances must not share initialization or poison state between independent cases. */
beforeEach(() => vi.resetModules())

/** Reset the existing native fixture and import the public field entry into a fresh module owner. */
async function fixture() {
  /** Mocked native exports keep the exact same shape as the dependency's public functions. */
  const native = (await import('@migaia/wasm')) as unknown as IWasmModule
  native.__control.reset()
  vi.clearAllMocks()
  /** Public construction, readiness, and field operations remain real package code. */
  const api = await import('../src/index.ts')
  return { native, ...api }
}

describe('public WASM initialization and allocation lifetime', () => {
  it('shares pending and settled readiness while rejecting construction before memory is ready', async () => {
    /** A native initialization promise remains pending until this case publishes actual memory. */
    const owner = await fixture()
    /** Resolve the dependency's public initialization result without touching arena state. */
    let finish!: (value: { memory: WebAssembly.Memory }) => void
    /** The original loader promise models asynchronous module instantiation. */
    const pending = new Promise<{ memory: WebAssembly.Memory }>((resolve) => {
      finish = resolve
    })
    owner.native.__control.queueInit(() => pending)
    /** Readiness identity is the public React/SSR generation token. */
    const ready = owner.ensureWasm()
    expect(owner.ensureWasm()).toBe(ready)
    /** Real graph Sources are acquired only after linear memory exists. */
    const { context } = makeFieldContext()
    expect(() => owner.number().create(context)).toThrow(
      expect.objectContaining({
        source: 'store.wasm',
        code: 'NOT_INITIALIZED'
      })
    )
    expect(owner.native.alloc_bytes).not.toHaveBeenCalled()
    finish({ memory: owner.native.__control.memory })
    await expect(ready).resolves.toBe(owner.native.__control.memory)
    expect(owner.ensureWasm()).toBe(ready)
    expect(owner.native.__control.initCallCount).toBe(1)
    /** A successful ready barrier permits the same public field's normal data and cleanup path. */
    const field = await owner.number().create(context)
    try {
      field.value = 7
      expect(field.value).toBe(7)
    } finally {
      field.dispose()
    }
    expect(owner.native.dealloc_bytes).toHaveBeenCalledOnce()
    expect(() => field.value).toThrow(
      expect.objectContaining({
        source: 'store.wasm',
        code: 'FIELD_DISPOSED'
      })
    )
    expect(() => {
      field.value = 8
    }).toThrow(
      expect.objectContaining({
        source: 'store.wasm',
        code: 'FIELD_DISPOSED'
      })
    )
  })

  it('preserves initialization rejection and retries through a fresh shared readiness promise', async () => {
    /** A loader failure must not permanently poison the wrapper's readiness cache. */
    const owner = await fixture()
    /** The caller must receive the exact native initialization failure. */
    const failure = new Error('native module initialization failed')
    owner.native.__control.queueInit(async () => {
      throw failure
    })
    /** Both callers share one failing generation before a later retry begins. */
    const failed = owner.ensureWasm()
    expect(owner.ensureWasm()).toBe(failed)
    await expect(failed).rejects.toBe(failure)
    /** The next invocation retries initialization instead of returning the rejected generation. */
    const retry = owner.ensureWasm()
    expect(retry).not.toBe(failed)
    expect(owner.ensureWasm()).toBe(retry)
    await expect(retry).resolves.toBe(owner.native.__control.memory)
    expect(owner.ensureWasm()).toBe(retry)
    expect(owner.native.__control.initCallCount).toBe(2)
    /** The retried memory must support observable field writes, not only a resolved Promise. */
    const { context } = makeFieldContext()
    /** The ordinary public boolean field owns its resulting allocation. */
    const field = await owner.boolean().create(context)
    try {
      field.value = true
      expect(field.value).toBe(true)
    } finally {
      field.dispose()
    }
    expect(() => {
      field.value = false
    }).toThrow(
      expect.objectContaining({
        source: 'store.wasm',
        code: 'FIELD_DISPOSED'
      })
    )
  })

  it('rejects a native zero allocation without creating a Source or releasing the sentinel', async () => {
    /** A zero native allocation is the allocator's documented failure result. */
    const owner = await fixture()
    await owner.ensureWasm()
    owner.native.alloc_bytes.mockReturnValueOnce(0)
    /** Source construction remains observable through the supported field context capability. */
    const { context } = makeFieldContext()
    /** No graph resource may be acquired for a missing native allocation. */
    const createSource = vi.fn(context.createSource)
    expect(() => owner.number().create({ ...context, createSource })).toThrow(
      expect.objectContaining({ source: 'store.wasm', code: 'ALLOCATION_FAILED' })
    )
    expect(createSource).not.toHaveBeenCalled()
    expect(owner.native.dealloc_bytes).not.toHaveBeenCalled()
    /** Allocation exhaustion does not poison a healthy instance or block later successful work. */
    const field = await owner.number().create(context)
    try {
      field.value = 11
      expect(field.value).toBe(11)
    } finally {
      field.dispose()
    }
    expect(owner.native.dealloc_bytes).toHaveBeenCalledOnce()
  })

  it('retains the first native trap and prevents later allocation or release exports', async () => {
    /** This existing live field proves poisoning also changes cleanup's native ownership boundary. */
    const owner = await fixture()
    await owner.ensureWasm()
    /** Real Runtime and Source ownership remains independent from native allocator health. */
    const { context } = makeFieldContext()
    /** The first native allocation succeeds before a later arena call traps. */
    const live = await owner.number().create(context)
    /** The trap crosses the declared WebAssembly boundary unchanged on its first occurrence. */
    const trap = new WebAssembly.RuntimeError('native arena trapped')
    owner.native.alloc_bytes.mockImplementationOnce(() => {
      throw trap
    })
    /** Capture original exceptions so identity is checked independently from their text. */
    let original: unknown
    try {
      owner.number().create(context)
    } catch (error) {
      original = error
    }
    expect(original).toBe(trap)
    /** Later public construction reports poisoning without invoking another native export. */
    let poisoned: unknown
    try {
      owner.boolean().create(context)
    } catch (error) {
      poisoned = error
    }
    expect(poisoned).toMatchObject({ source: 'store.wasm', code: 'INSTANCE_POISONED' })
    expect((poisoned as Error).cause).toBe(trap)
    expect(owner.native.alloc_bytes).toHaveBeenCalledTimes(2)
    live.dispose()
    expect(live.disposed).toBe(true)
    expect(owner.native.dealloc_bytes).not.toHaveBeenCalled()
    live.dispose()
    expect(owner.native.dealloc_bytes).not.toHaveBeenCalled()
  })
})
