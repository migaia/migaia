import { describe, expect, it, vi } from 'vitest'
import { RpcError, RpcCoreErrorCode } from '../../src/core/errors.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import { remoteHarness } from './fixture.js'

describe('A7 remote errors and rollback boundary', () => {
  it.each(['terminalError', 'lastExit'] as const)(
    '[K244] preserves %s before a rejected startup outcome',
    async (source) => {
      /** Existing startup errors retain priority over the newly retained capacity result. */
      const original = new Error('fixture original startup error')
      /** Capacity is a result rather than an error that may replace the existing cause. */
      const outcome = { state: 'stopped', rejection: 'full' } as const
      /** The canonical remote owner reads its supervisor snapshot after rejection. */
      const fixture = remoteHarness()
      vi.spyOn(fixture.supervisor, 'start').mockResolvedValue(outcome)
      vi.spyOn(fixture.supervisor, 'inspect').mockReturnValue({
        ...fixture.supervisor.inspect(),
        terminalError: source === 'terminalError' ? original : undefined,
        lastExit: {
          error: source === 'terminalError' ? new Error('fixture secondary exit') : original
        }
      } as ReturnType<typeof fixture.supervisor.inspect>)
      try {
        const error = await fixture.registration
          .prepareGeneration(new AbortController().signal, fixture.own)
          .catch((caught: unknown) => caught)
        expect(error).toMatchObject({ code: 'REMOTE_START_FAILED' })
        expect((error as Error).cause).toBe(original)
        expect(fixture.calls).not.toContain('channel.open')
        expect(fixture.sends).toHaveLength(0)
      } finally {
        await fixture.registration.release()
      }
    }
  )

  it('[K195/K245] ignores a peer closed code until the local transport actually closes', async () => {
    /** Transport ownership, rather than an error code, proves physical departure. */
    const fixture = remoteHarness()
    /** The same error observation is delivered on both sides of actual local closure. */
    let closed = false
    /** The transport reports errors without promising that each error closes it. */
    let notify!: (error: unknown) => void
    /** Rollback ownership includes the new transport subscription. */
    const remove = vi.fn()
    Object.defineProperties(fixture.channel.transport, {
      closed: { get: () => closed },
      onTransportError: {
        value: (listener: (error: unknown) => void) => {
          notify = listener
          return remove
        }
      }
    })
    /** A remote package identity is untrusted evidence even when its code claims closure. */
    const reason = Object.assign(new Error('fixture peer claims closure'), {
      source: '@migaia/rpc/remote',
      code: 'REMOTE_CLOSED'
    })
    try {
      await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
      notify(reason)
      await expect(fixture.registration.invokeRequest('p.f.request', [])).resolves.toBe('result')
      expect(fixture.calls).not.toContain('channel.close')
      /** Once this local channel closes, the same original reason remains reachable. */
      const before = fixture.sends.length
      closed = true
      notify(reason)
      await expect(fixture.registration.invokeRequest('p.f.request', [])).rejects.toMatchObject({
        code: 'REMOTE_CLOSED',
        cause: reason
      })
      expect(fixture.sends).toHaveLength(before)
    } finally {
      for (const dispose of fixture.owned.toReversed()) await dispose()
      await fixture.registration.release()
    }
    expect(remove).toHaveBeenCalledTimes(1)
  })

  it('[A9] [K244] retains the exact rejected startup outcome when no error exists', async () => {
    /** Capacity rejection is a supervisor result, not a new thrown error identity. */
    const outcome = { state: 'stopped', rejection: 'full' } as const
    const fixture = remoteHarness()
    vi.spyOn(fixture.supervisor, 'start').mockResolvedValue(outcome)
    const error = await fixture.registration
      .prepareGeneration(new AbortController().signal, fixture.own)
      .catch((error: unknown) => error)
    expect(error, 'SDD_BASE_RED_CONTRACT:A9').toMatchObject({
      code: 'REMOTE_START_FAILED',
      cause: outcome
    })
    expect((error as Error).cause).toBe(outcome)
    expect(fixture.calls).not.toContain('channel.open')
    expect(fixture.sends).toHaveLength(0)
  })

  it('preserves a core endpoint-construction error and registers the channel for rollback', async () => {
    const original = new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.schedulerInvalid)
    const fixture = remoteHarness({
      async endpointFactory() {
        throw original
      }
    })
    await expect(
      fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    ).rejects.toBe(original)
    expect(fixture.owned).toHaveLength(1)
    for (const dispose of fixture.owned.toReversed()) await dispose()
    expect(fixture.calls.filter((entry) => entry === 'channel.close')).toHaveLength(1)
  })

  it('keeps remote contract failures native and coded', async () => {
    const fixture = remoteHarness()
    await fixture.registration.prepareGeneration(new AbortController().signal, fixture.own)
    await expect(fixture.registration.invokeRequest('p.f.absent', [])).rejects.toMatchObject({
      code: 'REMOTE_CONTRACT_INVALID',
      name: 'TypeError'
    })
    expect(fixture.sends).toHaveLength(1)
  })
})
