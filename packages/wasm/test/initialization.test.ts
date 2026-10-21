import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

/** The public glue and both initialization results must share one published arena. */
test('concurrent first initialization retains one exports and memory identity', async () => {
  /** Real local WASM bytes exercise the package entry without fetch or a native adapter. */
  const bytes = new Uint8Array(
    await readFile(new URL('../src/wasm_provider_bg.wasm', import.meta.url))
  )
  /** Both calls begin before either instantiation can publish its result. */
  const [first, second] = await Promise.all([
    init({ module_or_path: bytes }),
    init({ module_or_path: bytes })
  ])
  /** Named exports allocate in the exact same arena returned to each caller. */
  const id = alloc_bytes(8)
  try {
    assert.strictEqual(first, second)
    assert.strictEqual(first.memory, second.memory)
    assert.strictEqual(first.byte_len_of(id), byte_len_of(id))
    assert.strictEqual(second.byte_len_of(id), 8)
  } finally {
    dealloc_bytes(id)
  }
})

/** Promised fetch inputs must follow the same loading path as their resolved values. */
test('initialization resolves promised URL, string, and Request inputs before loading', async (context) => {
  /** A data URL supplies the real package binary without a network service. */
  const bytes = await readFile(new URL('../src/wasm_provider_bg.wasm', import.meta.url))
  /** All three declared fetch input forms refer to the same local binary. */
  const dataUrl = `data:application/wasm;base64,${bytes.toString('base64')}`
  /** Each input gets its own uninitialized glue module so cached exports cannot mask a failure. */
  const inputs = [new URL(dataUrl), dataUrl, new Request(dataUrl)]
  for (const [index, input] of inputs.entries()) {
    await context.test(input.constructor.name, async () => {
      /** Query-specific imports keep initialization state independent for each supported form. */
      const fresh = await import(`${import.meta.resolve('@migaia/wasm')}?promised-url-${index}`)
      /** Initialization must resolve the promised URL before deciding whether fetch is required. */
      const wasm = await fresh.default({ module_or_path: Promise.resolve(input) })
      /** The initialized exports and public wrappers must operate on the same live allocation. */
      const id = fresh.alloc_bytes(8)
      try {
        assert.notStrictEqual(id, 0)
        assert.strictEqual(wasm.byte_len_of(id), 8)
        assert.strictEqual(fresh.byte_len_of(id), 8)
      } finally {
        fresh.dealloc_bytes(id)
      }
    })
  }
})
