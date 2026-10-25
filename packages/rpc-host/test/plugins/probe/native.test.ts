import { describe, expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import {
  probe,
  defineProbe,
  RpcProbeDirection,
  RpcProbeStage,
  type IRpcProbeEventView
} from '@migaia/rpc-host/plugins/probe'
import { coreMemoryServer } from '../../host/core-fixture.js'

describe('native readonly probe installation', () => {
  it.each(['absent', 'single', 'array'] as const)(
    'preserves real host results with %s probe inputs',
    async (mode) => {
      /** The public sink observes the actual Session and its unchanged codec/write values. */
      const seen: IRpcProbeEventView[] = []
      /** The existing observer handle is unchanged when supplied to a genuine native plugin. */
      const emit = vi.fn((view: IRpcProbeEventView) => seen.push(Object.freeze({ ...view })))
      /** One original compiled handle retains runtime setStages control independently of host. */
      const handle = defineProbe({
        stages: ['peer', 'envelope', 'encoded', 'frame'],
        capture: ['envelope', 'encoded', 'frame'],
        emit
      })
      /** Reuse the existing real carrier/codec fixture and its native listener owner. */
      const listener = coreMemoryServer('probe-server', 'actual-probe-server')
      /** The legacy array form contributes the same genuine handles to one native installation. */
      const selected = [handle]
      /** Optional observation installs before the real transport without execution hooks. */
      const plugins =
        mode === 'absent' ? [] : [mode === 'single' ? probe(handle) : probe(...selected)]
      /** Actual public provider behavior is the same in all three installation forms. */
      const server = await createRpcHost({
        ...listener.options,
        plugins: [...plugins, ...listener.options.plugins!],
        provide: { double: (value: number) => value * 2 }
      })
      /** A genuine separate host completes the original physical handshake. */
      const client = await listener.connect('probe-client')
      try {
        expect(await client.host.memory.request('double', 21)).toBe(42)
        if (mode === 'absent') expect(emit).not.toHaveBeenCalled()
        else {
          expect(emit).toHaveBeenCalled()
          expect(seen.every((view) => view.endpointId === 'actual-probe-server')).toBe(true)
          expect(
            seen.filter((view) => view.stage === RpcProbeStage.peer).map((view) => view.lifecycle)
          ).toEqual(['handshake', 'ready'])
          /** The actual selected fixture codec keeps the same semantic reference through write. */
          const reply = seen.filter(
            (view) => view.direction === RpcProbeDirection.outbound && view.method === 'double'
          )
          expect(reply.map((view) => view.stage)).toEqual([
            RpcProbeStage.envelope,
            RpcProbeStage.encoded,
            RpcProbeStage.frame
          ])
          expect(reply.every((view) => view.content === reply[0]!.content)).toBe(true)
          expect(reply.map((view) => view.sizeBytes)).toEqual([-1, -1, -1])
        }
      } finally {
        await client.host.close()
        await server.close()
      }
      if (mode === 'absent') expect(emit).not.toHaveBeenCalled()
      else expect(seen.filter((view) => view.lifecycle === 'closing')).toHaveLength(1)
    }
  )
})
