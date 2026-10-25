import { readFileSync } from 'node:fs'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { expect, it, vi } from 'vitest'
import { connectedCoreHosts } from '../host/core-fixture.js'

it('reports the original provider failure once with INTERNAL through its public diagnostic owner', async () => {
  /** Preserve the original r71 failure instance rather than rebuilding a report command DTO. */
  const failure = new Error('r71 identity failure')
  /** Only the actual provider Root's public report callback contributes to this original count. */
  const reports: unknown[] = []
  /** Caller diagnostics and provider diagnostics remain separate genuine public owner options. */
  const fixture = await connectedCoreHosts(
    {},
    {
      fail: () => {
        throw failure
      }
    },
    () => undefined,
    undefined,
    (error) => reports.push(error)
  )
  try {
    await expect(fixture.a.memory.send('b', 'fail', null)).rejects.toMatchObject({
      code: RpcCoreErrorCode.internal
    })
    /** The original two delivery turns allowed reporting after its actual correlated response. */
    await vi.waitFor(() => expect(reports).toHaveLength(1))
    expect(reports[0]).toBe(failure)
    expect(reports[0]).toMatchObject({ code: RpcCoreErrorCode.internal })
  } finally {
    await fixture.close()
  }
})

it('keeps the original identity observer callables out of the actual built public declaration', () => {
  /** Read the current normal-built package boundary, without a retired private declaration shim. */
  const declaration = readFileSync(new URL('../../dist/index.d.ts', import.meta.url), 'utf8')
  for (const name of [
    'registerInboundIdentityReleaseObservation',
    'recordInboundIdentityRelease',
    'readInboundIdentityReleaseObservation'
  ])
    expect(declaration).not.toContain(name)
})
