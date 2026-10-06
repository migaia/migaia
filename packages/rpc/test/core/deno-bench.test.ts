import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { it } from 'vitest'

/** Deno runs independently of Vitest's Node loader and records its actual native fields. */
const execute = promisify(execFile)

it('[A37] Deno observations do not claim compatibility zeroes as native measurements', async () => {
  const result = await execute('deno', [
    'run',
    '-A',
    fileURLToPath(new URL('./fixtures/deno-observation-proof.mjs', import.meta.url))
  ])
  const observed = JSON.parse(result.stdout) as { elu: null; threadId: null }
  assert.equal(observed.elu, null)
  assert.equal(observed.threadId, null)
})

for (const carrier of ['stdio-framed', 'worker'] as const) {
  it(`[A37][A38] Deno ${carrier} uses actual public Peer and native isolate observations`, async () => {
    const result = await execute(
      'deno',
      [
        'run',
        '-A',
        fileURLToPath(new URL('./fixtures/runtime-bench-proof.mjs', import.meta.url)),
        JSON.stringify({ carrier })
      ],
      { env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-deno-proof-${randomUUID()}` } }
    )
    const receipt = JSON.parse(result.stdout) as {
      echoes: number
      self: { instanceId: string }
      methods: string[]
      parentSnapshot: { pid: number; elu: null; threadId: null; isolateRole: string }
      peerSnapshot: {
        pid: number
        elu: null
        threadId: null
        isolateRole: string
        loaded: { loadedSHA256: string; diskSHA256: string; diagnosticOverlay: boolean }[]
      }
    }
    assert.equal(receipt.echoes, 3)
    assert.equal(receipt.self.instanceId, 'parent')
    assert.ok(receipt.methods.includes('bench.echo'))
    assert.equal(receipt.parentSnapshot.elu, null)
    assert.equal(receipt.peerSnapshot.elu, null)
    assert.equal(receipt.peerSnapshot.threadId, null)
    assert.equal(receipt.peerSnapshot.isolateRole, carrier === 'worker' ? 'worker' : 'peer')
    assert.equal(
      receipt.parentSnapshot.pid === receipt.peerSnapshot.pid,
      carrier === 'worker',
      '[A38] only an actual native Worker shares the parent PID'
    )
    assert.ok(receipt.peerSnapshot.loaded.length > 0)
    assert.ok(
      receipt.peerSnapshot.loaded.every(
        (row) => row.loadedSHA256 === row.diskSHA256 && !row.diagnosticOverlay
      )
    )
  })
}
