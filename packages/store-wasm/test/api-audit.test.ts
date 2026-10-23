import { beforeAll, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { initSync } from '@migaia/wasm'
import { createRuntime, type IDisposable } from '@migaia/reactive'
import { createStore, type IFieldBuilder, type IFieldContext } from '@migaia/store-light'
import { array, number, boolean, string, record, ensureWasm } from '../src/index.js'

/** Real Rust/WASM memory used by every field in this regression module. */
let memory: WebAssembly.Memory

beforeAll(async () => {
  initSync({
    module: readFileSync(new URL('../../wasm/src/wasm_provider_bg.wasm', import.meta.url))
  })
  memory = await ensureWasm()
})

describe('store-wasm audit regressions', () => {
  it('resolves the native array view after entering its actual Source commit', async () => {
    /** All graph and allocation ownership stays with the real Store/Runtime. */
    const runtime = createRuntime()
    /** Extend the public synchronous builder, forwarding every context/Source capability. */
    const original = array(2, 1)
    if (original.mode !== 'sync') throw new Error('expected synchronous field builder')
    /** Only the supported commit boundary replaces the real WebAssembly buffer. */
    let grow = false
    /** The complete adapter delegates every Source operation to its canonical owner. */
    const adapted = {
      ...original,
      create(context: IFieldContext) {
        return original.create({
          ...context,
          createSource(debugName?: string) {
            /** No fabricated Source or graph identity is involved. */
            const source = context.createSource(debugName)
            return {
              track: () => source.track(),
              notify: () => source.notify(),
              commit<T>(write: () => T): T {
                if (grow) {
                  grow = false
                  memory.grow(1)
                }
                return source.commit(write)
              },
              get observed() {
                return source.observed
              },
              get disposed() {
                return source.disposed
              },
              dispose: () => source.dispose()
            }
          }
        })
      }
    }
    /** The Store owns field cleanup even when an assertion fails. */
    const store = createStore({ values: adapted }, { runtime })
    /** Observe public publication, not only bytes in linear memory. */
    const values: number[] = []
    /** This actual graph observer materializes the field bucket before writing. */
    const effect = runtime.effect(() => {
      values.push(store.values.at(0))
    })
    try {
      /** Native growth must detach this exact previous backing buffer. */
      const before = memory.buffer
      grow = true
      store.values.setAt(0, 5)
      runtime.flush()
      expect(memory.buffer).not.toBe(before)
      expect(store.values.at(0)).toBe(5)
      expect(values).toEqual([0, 5])
    } finally {
      effect.dispose()
      await store.$dispose()
    }
  })

  it.each(['length', 'item'] as const)(
    'codes a real ArrayLike %s getter without partial writes',
    async (part) => {
      /** Native field state remains intact when application input cannot be read. */
      const store = createStore({ values: array(2) })
      /** The original native class/identity/stack must survive boundary classification. */
      const original = new TypeError('array input getter failed')
      /** Both are complete ArrayLike shapes whose supported data accessor throws. */
      const values: ArrayLike<number> =
        part === 'length'
          ? {
              get length(): number {
                throw original
              }
            }
          : {
              length: 1,
              get 0(): number {
                throw original
              }
            }
      try {
        store.values.setRange(0, 2, [1, 2])
        expect(() => store.values.setRange(0, 1, values)).toThrow(original)
        expect(original).toMatchObject({ source: 'store.wasm', code: 'INVALID_OPTION' })
        expect(original.stack).toBeTruthy()
        expect([...store.values.view()]).toEqual([1, 2])
      } finally {
        await store.$dispose()
      }
    }
  )

  it.each([
    { name: 'number', builder: number() },
    { name: 'boolean', builder: boolean() },
    { name: 'string', builder: string() },
    { name: 'array', builder: array(2) },
    { name: 'record', builder: record({ x: number() }) }
  ])('retains the real native abort reason in the $name builder', ({ builder }) => {
    /** All union members implement the same canonical Store field construction protocol. */
    const original: IFieldBuilder<IDisposable> = builder
    if (original.mode !== 'sync') throw new Error('expected synchronous field builder')
    /** Use a genuine already-aborted signal and native reason through the complete Store context. */
    const controller = new AbortController()
    /** A native AbortError keeps its exact identity, class and stack. */
    const reason = new DOMException('field owner aborted', 'AbortError')
    controller.abort(reason)
    expect(() =>
      createStore({
        field: {
          ...original,
          create(context: IFieldContext) {
            return original.create({ ...context, signal: controller.signal })
          }
        }
      })
    ).toThrow(reason)
    expect(reason).toMatchObject({ source: 'store.wasm', code: 'INIT_ABORTED' })
    expect(reason).toBeInstanceOf(DOMException)
    expect(reason.name).toBe('AbortError')
    expect(reason.stack).toBeTruthy()
  })
})
