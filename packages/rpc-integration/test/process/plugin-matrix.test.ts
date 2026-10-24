import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { readRuntimeOutletConnection } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'
import { matrixFixture } from './matrix-fixture.js'

describe('real process acceptance matrix', () => {
  it('delays real hello/describe and native installation, then aborts actual stream', async () => {
    const test = await matrixFixture()
    if (!test.spawn) throw new Error('spawn required')
    const plugin = processPlugin({
      ...test.settings,
      spawn: {
        ...test.spawn,
        supervision: {
          ...test.spawn.supervision,
          spec: {
            ...test.spec,
            env: {
              inherit: [],
              set: {
                RPC_HANDSHAKE_GATE: join(test.directory, 'hello'),
                RPC_DESCRIBE_GATE: join(test.directory, 'describe')
              }
            }
          }
        }
      }
    })
    let installed = false
    const use = test.host.use(plugin).then((value) => {
      installed = true
      return value
    })
    try {
      await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:before-handshake'))
      expect(installed).toBe(false)
      expect(test.describes).toBe(0)
      await test.gate('hello')
      await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:describe-entered'))
      expect(installed).toBe(false)
      expect(test.business).toBe(0)
      await test.gate('describe')
      await use
      expect(await test.outlet.request('p', 'p.f.request', ['ready'])).toBe('child:ready')
      expect(test.handles).toHaveLength(1)
      expect(test.hellos).toBe(1)
      expect(test.describes).toBe(1)
      const abort = new AbortController()
      const stream = test.outlet.stream('p', 'p.f.generator', ['ordered'], { signal: abort.signal })
      expect(await stream.next()).toEqual({ done: false, value: 'ordered:1' })
      expect(await stream.next()).toEqual({ done: false, value: 'ordered:2' })
      const pending = stream.next().catch((error: unknown) => error)
      abort.abort('consumer-stop')
      expect(await pending).toBe('consumer-stop')
      await vi.waitFor(() =>
        expect(test.chunks.join('')).toContain('matrix:stream-aborted:ordered')
      )
    } finally {
      await test.cleanup()
    }
    expect(test.budget.inUse).toBe(0)
  }, 20000)

  it('real prewarm keeps hello/describe once and transfers stderr identity across native replacement', async () => {
    const test = await matrixFixture({ warm: true })
    try {
      await vi.waitFor(() => expect(test.pool!.idle).toBe(1))
      await vi.waitFor(() => expect(test.chunks.join('')).toContain('matrix:before-bootstrap'))
      expect(test.logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(0)
      await test.host.use(test.plugin)
      expect(test.callerChunks.join('').split('matrix:before-bootstrap').length - 1).toBe(1)
      expect(test.handles).toHaveLength(1)
      expect(test.hellos).toBe(1)
      expect(test.describes).toBe(1)
      /** Child readiness completes independently from the parent's first accepted directory. */
      await vi.waitFor(() => expect(test.callerChunks.join('')).toContain('matrix:serving-ready'))
      const beforeStderr = test.logs.filter((entry) => entry.name === 'ipc.stderr').length
      await test.outlet.request('p', 'p.f.request', ['stderr'])
      await vi.waitFor(() =>
        expect(test.logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(
          beforeStderr + 1
        )
      )
      expect(test.logs.filter((entry) => entry.name === 'ipc.stderr').at(-1)).toMatchObject({
        ...test.sessions[0],
        processId: test.handles[0]!.identity.fingerprint
      })
      const initialTake = test.take!.mock.calls.length
      expect(
        await test.outlet.replace('p', {
          ...test.spec,
          env: { inherit: [], set: { RPC_VALUE: 'new' } }
        })
      ).toMatchObject({ kind: 'replaced', generation: 2 })
      expect(await test.outlet.request('p', 'p.f.request', ['value'])).toBe('new:value')
      expect(test.take).toHaveBeenCalledTimes(initialTake)
      expect(test.invalidate).toHaveBeenCalledTimes(1)
      /** Both accepted child lifetimes have now emitted their final startup marker. */
      await vi.waitFor(() =>
        expect(test.callerChunks.join('').split('matrix:serving-ready').length - 1).toBe(2)
      )
      const afterReady = test.logs.filter((entry) => entry.name === 'ipc.stderr').length
      await test.outlet.request('p', 'p.f.request', ['stderr'])
      await vi.waitFor(() =>
        expect(test.logs.filter((entry) => entry.name === 'ipc.stderr')).toHaveLength(
          afterReady + 1
        )
      )
      expect(test.logs.filter((entry) => entry.name === 'ipc.stderr').at(-1)).toMatchObject({
        ...test.sessions[1],
        processId: test.handles[1]!.identity.fingerprint
      })
      expect(test.sessions[0]!.sessionId).not.toBe(test.sessions[1]!.sessionId)
      expect(test.hellos).toBe(2)
      expect(test.describes).toBe(2)
    } finally {
      await test.cleanup()
    }
    expect(test.budget.inUse).toBe(0)
  }, 20000)

  it.each([2, 3])(
    'real pool budget %i retains retiring lease and refills original spec',
    async (maxUnits) => {
      const test = await matrixFixture({ maxUnits, warm: true, holdIdle: true })
      try {
        await vi.waitFor(() => expect(test.pool!.idle).toBe(1))
        await test.host.use(test.plugin)
        await vi.waitFor(() => expect(test.handles).toHaveLength(2))
        const initialTake = test.take!.mock.calls.length
        expect(
          await test.outlet.replace('p', {
            ...test.spec,
            env: { inherit: [], set: { RPC_VALUE: 'candidate' } }
          })
        ).toMatchObject({ kind: 'replaced', generation: 2 })
        expect(await test.outlet.request('p', 'p.f.request', ['value'])).toBe('candidate:value')
        expect(test.take).toHaveBeenCalledTimes(initialTake)
        expect(test.invalidate).toHaveBeenCalledTimes(1)
        expect(test.budget.inUse).toBeGreaterThanOrEqual(2)
        test.releaseIdle()
        await vi.waitFor(() => expect(test.pool!.idle).toBe(1))
        expect(test.launchedSpecs.at(-1)).toBe(test.spec)
      } finally {
        await test.cleanup()
      }
      expect(test.budget.inUse).toBe(0)
    },
    20000
  )

  it('native replacement keeps held Peer unavailable until real describe completes', async () => {
    const test = await matrixFixture({ gated: true })
    try {
      await test.host.use(test.plugin)
      const peer = readRuntimeOutletConnection(test.outlet, 'p')!.peer
      expect(await peer.request('p.f.request', ['ready'])).toBe('child:ready')
      await test.closeGate('describe')
      const replacement = test.outlet.replace('p', test.spec)
      await test.handles[0]!.exited
      await vi.waitFor(() =>
        expect(test.chunks.join('').split('matrix:describe-entered').length - 1).toBe(2)
      )
      const before = test.business
      let unavailable: unknown
      try {
        await peer.request('p.f.request', ['blocked'])
      } catch (error) {
        unavailable = error
      }
      expect(unavailable).toMatchObject({ code: 'REMOTE_CLOSED', detail: { generation: 2 } })
      expect(test.business).toBe(before)
      await test.gate('describe')
      expect(await replacement).toMatchObject({ kind: 'replaced', generation: 2 })
      expect(await peer.request('p.f.request', ['restored'])).toBe('child:restored')
      expect(readRuntimeOutletConnection(test.outlet, 'p')!.peer).toBe(peer)
      expect(test.hellos).toBe(2)
      expect(test.describes).toBe(2)
      expect(test.sessions[0]).not.toEqual(test.sessions[1])
    } finally {
      await test.cleanup()
    }
  }, 20000)

  it('native release overlaps candidate preparation without leaking a child or lease', async () => {
    const test = await matrixFixture()
    try {
      await test.host.use(test.plugin)
      const replacing = Promise.allSettled([
        test.outlet.replace('p', {
          ...test.spec,
          env: { inherit: [], set: { RPC_DESCRIBE_GATE: join(test.directory, 'candidate') } }
        })
      ])
      await vi.waitFor(() => expect(test.handles).toHaveLength(2))
      const removing = test.host.unUse('p', { policy: 'cascade' })
      await test.gate('candidate')
      const results = await Promise.allSettled([replacing, removing])
      expect(results[1]).toMatchObject({ status: 'fulfilled', value: { ok: true } })
      for (const handle of test.handles) await handle.exited
      expect(test.budget.inUse).toBe(0)
    } finally {
      await test.cleanup()
    }
  }, 20000)

  it('release first rejects native replacement without touching active processes', async () => {
    const test = await matrixFixture({ maxUnits: 2 })
    try {
      await test.host.use(test.plugin)
      const outlet = test.outlet
      await test.host.unUse('p', { policy: 'cascade' })
      expect(() => outlet.replace('p')).toThrowError(
        expect.objectContaining({ code: 'TARGET_UNKNOWN' })
      )
      expect(test.handles).toHaveLength(1)
    } finally {
      await test.cleanup()
    }
    expect(test.budget.inUse).toBe(0)
  }, 20000)
})
