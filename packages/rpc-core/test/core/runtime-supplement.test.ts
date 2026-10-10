import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { it } from 'vitest'

/** The original diagnostic completes three real echoes before the topology provenance assertion. */
const execute = promisify(execFile)
/** Shared actual carrier probe rejects a fake managed or forwarded facade through canonical readers. */
const entry = fileURLToPath(new URL('./fixtures/runtime-bench-proof.mjs', import.meta.url))

for (const topology of ['managed', 'one-hop'] as const) {
  it(`[A37][A116] runtime measurement uses real ${topology} ownership`, async () => {
    const result = await execute(
      process.execPath,
      [
        entry,
        JSON.stringify({
          carrier: topology === 'managed' ? 'worker' : 'stdio-framed+worker',
          topology
        })
      ],
      { env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-runtime-proof-${randomUUID()}` } }
    )
    const receipt = JSON.parse(result.stdout) as {
      echoes: number
      managed: boolean
      forwardedVia: string | null
    }
    assert.equal(receipt.echoes, 3)
    assert.equal(
      topology === 'managed' ? receipt.managed : receipt.forwardedVia === 'leaf',
      true,
      '[A37][A116] requested topology must be the actual committed runtime route'
    )
  })
}

it('[A37][A38] reverse measurement originates in the actual Worker isolate', async () => {
  const result = await execute(
    process.execPath,
    [entry, JSON.stringify({ carrier: 'worker', direction: 'reverse' })],
    { env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-runtime-reverse-${randomUUID()}` } }
  )
  const receipt = JSON.parse(result.stdout) as { echoes: number; initiatorThreadId: number }
  assert.equal(receipt.echoes, 3)
  assert.ok(receipt.initiatorThreadId > 0, '[A38] initiating Worker owns the reverse timing clock')
})
