/** Original timeout acquisition and immutable policy values use the complete executing feature. */
import { createRpcHost } from '@migaia/rpc-host'
import { timeout } from '@migaia/rpc-host/features/timeout'
import { createManualScheduler } from '@migaia/utils/testing'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'

// C063/C064: captures configuration at the complete feature factory, before installation.
it.each(
  [
    {
      title: 'timeout config getter is read once and legacy middleware remains callable',
      ms: 0
    },
    { title: 'native timeout install snapshots only after factory creation', ms: 10 }
  ].map((row) => [row.title, row] as const)
)('%s', async (_title, { ms }) => {
  /** Exactly one acquisition is retained; the obsolete install-time capture boundary is retired. */
  let reads = 0
  /** The new public duration field is acquired by the actual feature, not a private install shim. */
  const strategy = timeout({
    get ms() {
      reads += 1
      return ms
    }
  })
  /** This installed native namespace borrows the actual complete policy instance. */
  const server = coreMemoryServer('timeout-once', 'timeout-once', 'memory', [strategy])
  /** A real SDK transport installs the original policy without another host or role registry. */
  const host = await createRpcHost(server.options)
  try {
    expect(reads).toBe(1)
  } finally {
    await host.close()
  }
})

// C065: keep original getter receiver and acquisition-order assertions under the new field name.
it('timeout snapshots its configuration in receiver-free order', async () => {
  /** The original fixture tag continues to identify acquisition of the logical timeout setting. */
  const reads: string[] = []
  /** Native property access must preserve the exact caller descriptor as getter receiver. */
  let timeoutReceiver = false
  /** Only the public field changed from timeoutMs to ms; receiver and one acquisition remain. */
  const config = {
    get ms(): number {
      timeoutReceiver = this === config
      reads.push('timeoutMs')
      return 25
    }
  }
  /** The complete factory is the new policy-capture boundary. */
  const strategy = timeout(config)
  /** Genuine native installation consumes the exact captured feature instance. */
  const server = coreMemoryServer('timeout-fields', 'timeout-fields', 'memory', [strategy])
  /** No deleted plugin.install context or result.ports object is recreated. */
  const host = await createRpcHost(server.options)
  try {
    expect(timeoutReceiver).toBe(true)
    expect(reads).toEqual(['timeoutMs'])
  } finally {
    await host.close()
  }
})

// C089: actual public calls prove the original 99ms snapshot survives later caller mutation.
it('native timeout snapshot survives post-install mutation', async () => {
  /** The original logical-setting tag exposes any repeated descriptor read. */
  const reads: string[] = []
  /** Moves capture to factory creation; set the original admitted value before that boundary. */
  let timeoutMs = 99
  /** This existing scheduler owns real timeout tasks and allows inspecting their actual delays. */
  const scheduler = createManualScheduler()
  /** Spying preserves the genuine timer algorithm and its exact cancellation receipts. */
  const scheduled = vi.spyOn(scheduler, 'schedule')
  /** Mutable caller data must not replace the feature's captured policy after admission. */
  const config = {
    get ms() {
      reads.push('timeoutMs')
      return timeoutMs
    },
    scheduler
  }
  /** Policy capture is performed by the complete public factory, with no compatibility port. */
  const strategy = timeout(config)
  timeoutMs = 101
  /** This real transport owns the feature used by both originating namespace calls. */
  const server = coreMemoryServer('timeout-snapshot', 'timeout-snapshot', 'memory', [strategy])
  /** The actual public Host owns session admission and dispatch independently of the policy. */
  const host = await createRpcHost(server.options)
  /** The real peer responds normally, allowing both original snapshot observations to finish. */
  const remote = await server.connect('timeout-peer', { provide: { echo: (value) => value } })
  try {
    await host.memory.request('echo', undefined)
    expect(scheduled.mock.calls.at(-1)?.[1]).toBe(99)
    timeoutMs = 102
    await host.memory.request('echo', undefined)
    expect(scheduled.mock.calls.at(-1)?.[1]).toBe(99)
    expect(reads).toEqual(['timeoutMs'])
  } finally {
    await remote.host.close()
    await host.close()
    scheduled.mockRestore()
  }
})
