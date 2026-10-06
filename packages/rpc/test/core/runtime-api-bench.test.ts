import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { it } from 'vitest'

/** Each independent native side loads the shipped module graph outside Vitest's source loader. */
const execute = promisify(execFile)
/** This diagnostic fixture proves routing without putting counters into formal timing. */
const entry = fileURLToPath(new URL('./fixtures/runtime-bench-proof.mjs', import.meta.url))

/** Existing Node/Bun native and two original representative bridge carriers share this oracle. */
const units = [
  ...['stdio-framed', 'socket-framed', 'worker'].flatMap((carrier) =>
    [process.execPath, 'bun'].map((executable) => ({ executable, carrier }))
  ),
  { executable: process.execPath, carrier: 'browser-worker' },
  {
    executable: process.execPath,
    carrier: 'socket-content-length',
    wire: 'jsonrpc',
    peerRuntime: 'rust'
  },
  { executable: 'bun', carrier: 'stdio-content-length', wire: 'jsonrpc', peerRuntime: 'rust' }
]

it.each(units)(
  '[A37][A38] DA1 $executable $carrier business belongs to the canonical public Peer',
  async (unit) => {
    /** Existing physical preparation performs three actual echoes before the provenance assertion. */
    const result = await execute(unit.executable, [entry, JSON.stringify(unit)], {
      env: { ...process.env, IPC_BENCH_STEM: `/tmp/rpc-bench-proof-${randomUUID()}` }
    })
    /** Private canonical connection identity comes from the factory that actually executed business. */
    const receipt = JSON.parse(result.stdout) as {
      echoes: number
      self: { instanceId: string } | null
      peerId: string | null
      methods: string[]
    }
    assert.equal(receipt.echoes, 3)
    assert.ok(
      receipt.self,
      '[A37] successful formal business must use the actual public Peer owner'
    )
    assert.equal(receipt.self.instanceId, unit.carrier === 'browser-worker' ? 'page' : 'parent')
    if (unit.carrier === 'worker' || unit.carrier === 'browser-worker')
      assert.match(receipt.peerId!, /^rpc-thread-(?:web-)?[1-9]\d*$/)
    else assert.equal(receipt.peerId, 'wire' in unit ? 'rust-peer' : 'peer')
    assert.ok(receipt.methods.includes('wire' in unit ? 'p.f.request' : 'bench.echo'))
  }
)
