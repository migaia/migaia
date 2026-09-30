import { describe, expect, it } from 'vitest'
import { RpcError, RpcCoreErrorCode } from '../../src/core/errors.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import { remoteHarness } from './fixture.js'

describe('A7 remote errors and rollback boundary', () => {
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
