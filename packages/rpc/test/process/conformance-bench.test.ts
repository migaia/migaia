import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

/** Focused startup receipts use three echoes; they never execute an A10 performance window. */
const execute = promisify(execFile)
/** Dynamic module loading keeps MJS helpers outside the package's TypeScript source graph. */
const driverUrl = new URL('../../bench/ipc.mjs', import.meta.url).href
/** Supported candidate definitions precede startup; failed candidates stay required failures. */
const candidates = [
  { executable: process.execPath, runtime: 'node', carrier: 'stdio-framed', codec: 'json' },
  { executable: process.execPath, runtime: 'node', carrier: 'socket-framed', codec: 'json' },
  { executable: process.execPath, runtime: 'node', carrier: 'worker', codec: 'identity' },
  { executable: 'bun', runtime: 'bun', carrier: 'stdio-framed', codec: 'json' },
  { executable: 'bun', runtime: 'bun', carrier: 'socket-framed', codec: 'json' },
  ...['node', 'bun'].flatMap((runtime) =>
    ['python', 'rust', 'go'].flatMap((peerRuntime) =>
      ['stdio-content-length', 'socket-content-length'].map((carrier) => ({
        executable: runtime === 'node' ? process.execPath : 'bun',
        runtime,
        peerRuntime,
        wire: 'jsonrpc',
        carrier,
        codec: 'json'
      }))
    )
  )
]

/** Complete deterministic receipts test the ratio oracle without running real performance work. */
function receipt(unit: object, factor = 1) {
  return {
    unit,
    samples: 1000,
    latenciesNs: Array.from({ length: 1000 }, () => 10 * factor),
    p99Ns: 10 * factor,
    throughputPerSecond: 1000 / factor,
    cpuNsPerRequest: factor,
    rssAbsolutePeakSumBytes: 20 * factor,
    cpuByPid: [
      { pid: 1, cpuNs: 500 * factor },
      { pid: 2, cpuNs: 500 * factor }
    ],
    rssPeaksByPid: [
      { pid: 1, rssBytes: 10 * factor },
      { pid: 2, rssBytes: 10 * factor }
    ],
    parentPid: 1,
    peerPid: 2,
    encodedBytes: 66,
    concurrency: 1,
    runtime: 'v24.16.0'
  }
}

describe('[A10] IPC pairing contract', () => {
  it('uses medians of alternating complete pairs and preserves immutable targets', async () => {
    const { judgePairs, IpcBenchThreshold } = await import(/* @vite-ignore */ driverUrl)
    const unit = { codec: 'json', carrier: 'stdio-framed', payloadBytes: 64 }
    const rounds = [1, 2, 4].map((factor, index) => ({
      order: index % 2 ? ['rpc', 'bare'] : ['bare', 'rpc'],
      bare: receipt(unit),
      rpc: receipt(unit, factor)
    }))
    expect(judgePairs(rounds)).toMatchObject({
      status: 'pass',
      ratios: { p99: 2, throughput: 0.5, cpu: 2, rss: 2 }
    })
    expect(IpcBenchThreshold).toEqual({ p99: 3, throughput: 0.5, cpu: 3, rss: 2 })
    expect(Object.isFrozen(IpcBenchThreshold)).toBe(true)
    for (const round of rounds) round.rpc = receipt(unit, 4)
    expect(judgePairs(rounds)).toMatchObject({
      status: 'fail',
      samples: { bare: 1000, rpc: 1000 },
      ratios: { p99: 4, throughput: 0.25, cpu: 4, rss: 4 }
    })
  })

  it('rejects insufficient data, missing endpoint RSS, mismatched payload and nonpositive CPU', async () => {
    const { pairedRatios, judgePairs } = await import(/* @vite-ignore */ driverUrl)
    const unit = { codec: 'json', payloadBytes: 64 }
    expect(() => pairedRatios({ ...receipt(unit), samples: 999 }, receipt(unit))).toThrow(
      'Incomplete'
    )
    expect(() => pairedRatios({ ...receipt(unit), rssPeaksByPid: [] }, receipt(unit))).toThrow(
      'Incomplete'
    )
    expect(() => pairedRatios(receipt(unit), receipt({ ...unit, payloadBytes: 1024 }))).toThrow(
      'mismatch'
    )
    expect(() => pairedRatios({ ...receipt(unit), cpuNsPerRequest: 0 }, receipt(unit))).toThrow(
      'Incomplete'
    )
    expect(() => judgePairs([])).toThrow('three')
    expect(() =>
      judgePairs(
        [0, 1, 2].map(() => ({ order: ['bare', 'rpc'], bare: receipt(unit), rpc: receipt(unit) }))
      )
    ).toThrow('alternate')
  })

  it.each(
    candidates.flatMap((candidate) =>
      [64, 1024, 65536, 1048576].map((payloadBytes) => ({ ...candidate, payloadBytes }))
    )
  )(
    'starts independent $runtime $carrier $peerRuntime $payloadBytes bare/RPC endpoints',
    async (candidate) => {
      const unit = { ...candidate, payloadBytes: candidate.payloadBytes, concurrency: 1 }
      for (const side of ['bare', 'rpc']) {
        const { stdout } = await execute(
          candidate.executable,
          [
            new URL('../../bench/ipc-side.mjs', import.meta.url).pathname,
            JSON.stringify({ unit, side, options: { check: true } })
          ],
          { timeout: 15000 }
        )
        const result = JSON.parse(stdout)
        expect(result).toMatchObject({ type: 'ipc-preparation', echoes: 3, side, unit })
        expect(result.parentPid).toBeGreaterThan(0)
        if (candidate.carrier === 'worker') expect(result.peerPid).toBe(result.parentPid)
        else expect(result.peerPid).not.toBe(result.parentPid)
        for (const rows of [result.first, result.last]) {
          expect(rows).toHaveLength(candidate.carrier === 'worker' ? 1 : 2)
          expect(
            rows.every(
              (row: { rssBytes: number; cpuNs: number }) => row.rssBytes > 0 && row.cpuNs >= 0
            )
          ).toBe(true)
        }
      }
    },
    30000
  )

  it('keeps bench explicit and within fmt/lint paths', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../../package.json', import.meta.url), 'utf8')
    )
    expect(manifest.scripts['bench:ipc']).toBe('node bench/ipc.mjs')
    expect(manifest.scripts.fmt.split(' ')).toContain('bench')
    expect(manifest.scripts.lint.split(' ')).toContain('bench')
    expect(manifest.scripts.test).not.toContain('bench')
  })
})
