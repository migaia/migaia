import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

/** The public glue and both initialization results must share one published arena. */
test('D02 concurrent first initialization retains one exports and memory identity', async () => {
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
