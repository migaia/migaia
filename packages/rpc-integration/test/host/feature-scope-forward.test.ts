import { rpcFeaturesPlugin } from '@migaia/rpc-host/sdk'
/** Checks per-namespace flow execution during one actual Process-to-Worker forward. */
import { expect, it } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { RpcFlowPoint } from '@migaia/rpc-host/sdk'
import { FeatureScopeFixture, featureScopeAuth } from './fixtures/feature-scope-child.ts'
import {
  FeatureScopeForwardFixture as Fixture,
  type IFeatureScopeForwardStats
} from './fixtures/feature-scope-middle.ts'

it('forwards a through b to c using only the source and target namespace flow groups', async () => {
  /** Both real physical hops use the same actual auth Feature, independent of scope observation. */
  const host = await createRpcHost({
    plugins: [
      rpcFeaturesPlugin({ features: { feature1: featureScopeAuth(FeatureScopeFixture.hostKey) } }),
      processPlugin({
        name: Fixture.middle,
        spawn: {
          entry: new URL('./fixtures/feature-scope-middle.ts', import.meta.url),
          args: [Fixture.middleRole]
        }
      })
    ] as const
  })
  try {
    /** This original public provider waits for b's actual child directory to become ready. */
    expect(await host.process.send(Fixture.middle, Fixture.ready)).toBe(true)
    expect(await host.process.send(Fixture.middle, Fixture.forwarded, Fixture.marker)).toBe(
      Fixture.marker
    )
    /** Inspection is another real RPC and cannot enter the unique marker-only observation rows. */
    const stats = (await host.process.send(
      Fixture.middle,
      Fixture.stats
    )) as IFeatureScopeForwardStats
    expect(stats.leaf.echoCalls).toBe(1)
    expect(stats.up).toEqual([
      {
        scope: Fixture.up,
        namespace: Fixture.up,
        point: RpcFlowPoint.envelopeInbound,
        method: Fixture.forwarded
      }
    ])
    expect(stats.down).toEqual([
      {
        scope: Fixture.down,
        namespace: Fixture.down,
        point: RpcFlowPoint.envelopeOutbound,
        method: Fixture.echo
      }
    ])
  } finally {
    await host.close()
  }
}, 15000)
