import { systemScheduler } from '@migaia/utils/scheduler'
import { describe, expect, it } from 'vitest'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { hostFixture } from './fixtures/host-control.js'
import { RPC_CORE_ERROR_SOURCE } from '@migaia/rpc-contract/errors'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { deferred } from '@migaia/utils/promise'
import { RuntimeEventName } from '../../../rpc-host/dist/remote/runtime-api/constants.js'

/** Advance only existing asynchronous supervisor continuations without changing timer budgets. */
async function settle(): Promise<void> {
  for (let turn = 0; turn < 30; turn += 1) await Promise.resolve()
}

describe('process plugin generation lifetime', () => {
  it('revokes on child exit and rebinds the same native outlet after a new describe', async () => {
    /** Existing fixture supplies real byte handshakes, Peers and independently controlled OS exits. */
    const fixture = hostFixture()
    /** Generation observers keep real host ordering while backoff remains on the original clock. */
    const scheduler = fixture.scheduler
    scheduler.defer = systemScheduler.defer
    /** Only supervisor restart policy changes; source, budget and physical assembly stay canonical. */
    const plugin = processPlugin({
      ...fixture.runtimeOptions,
      spawn: {
        ...fixture.runtimeOptions.spawn,
        supervision: {
          ...fixture.runtimeOptions.spawn.supervision,
          restart: { mode: 'on-failure', initialDelayMs: 1, maxDelayMs: 1, maxRestarts: 1 }
        }
      }
    })
    /** The real committed second-generation event replaces an arbitrary microtask-count guess. */
    const rebound = deferred<void>()
    /** This exact original outlet subscription belongs to the lifecycle case's cleanup. */
    let stopReady: (() => void) | undefined
    try {
      await fixture.host.use(plugin)
      /** This actual Host outlet survives the original process generation's retirement. */
      const outlet = fixture.host.process!
      stopReady = outlet.on(RuntimeEventName.ready, (event) => {
        if (event.name === 'child' && event.generation === 2) rebound.resolve()
      })
      expect(await outlet.request('child', 'p.f.m', ['first'])).toEqual({ ok: true })
      fixture.crashes[0]!({ code: 1, signal: null })
      await settle()
      expect(() => outlet.request('child', 'p.f.m', ['during-exit'])).toThrow(
        expect.objectContaining({
          source: RPC_CORE_ERROR_SOURCE,
          code: RpcCoreErrorCode.targetUnknown
        })
      )
      scheduler.advance(1)
      await rebound.promise
      expect(fixture.launch).toHaveBeenCalledTimes(2)
      expect(fixture.host.process).toBe(outlet)
      expect(await outlet.request('child', 'p.f.m', ['second'])).toEqual({ ok: true })
      expect(
        fixture.send.mock.calls.filter((send) => send[1] === 'migaia.remote.runtime.describe')
      ).toHaveLength(2)
    } finally {
      stopReady?.()
      await fixture.close()
    }
  })
})
