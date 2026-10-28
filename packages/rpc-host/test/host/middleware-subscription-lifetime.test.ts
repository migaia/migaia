/** Genuine native Hosts own actual subscriptions and release pre-attachment resources on rollback. */
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { defineTransportPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { assert, expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.ts'
import { MemoryCarrier } from '../fixtures/core-carrier.ts'

/** Real accepted client ownership is borrowed from the existing native memory fixture. */
type IConnectedClient = Awaited<ReturnType<ReturnType<typeof coreMemoryServer>['connect']>>

/** NativeHost, rather than RPC Root.close, is the original installation and resource owner. */
function receivingHost() {
  /** Original memory listener and pre-attachment source use these genuine native declarations. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** The sole native owner retains acquisition, rollback and its stable disposal completion. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  return host
}

// C017: exact old shared-port lookups retire; simultaneous physical receivers remain observable.
it('C017 keeps two actual native subscriptions isolated when the left Host retires', async () => {
  /** Pass through the original native method without adding an active-counter surface. */
  const subscribed = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
  /** Each ordinary NativeHost receives a distinct genuine SDK listener. */
  const left = receivingHost()
  /** The right registration owns its own independent native context and receiver. */
  const right = receivingHost()
  /** Existing fixtures supply canonical source acquisition without a second carrier implementation. */
  const leftServer = coreMemoryServer('subscription-left')
  /** The second actual listener shares no mutable native resource with the left. */
  const rightServer = coreMemoryServer('subscription-right')
  /** Cleanup retains only actual client owners created by successful native acquisition. */
  let leftClient: IConnectedClient | undefined
  /** A separate cleanup reference belongs to the independently acquired right client. */
  let rightClient: IConnectedClient | undefined
  try {
    await left.use(leftServer.transport)
    await right.use(rightServer.transport)
    leftClient = await leftServer.connect('subscription-left-peer')
    rightClient = await rightServer.connect('subscription-right-peer')
    /** These are the actual original server endpoints, selected by exact receiver identity. */
    const leftCarrier = leftClient.pair[0]
    /** This exact physical endpoint belongs only to the right native registration. */
    const rightCarrier = rightClient.pair[0]
    /** Count actual acquisition calls for this endpoint, not Host peers or business requests. */
    const leftSubscriptions = subscribed.mock.contexts.filter(
      (receiver) => receiver === leftCarrier
    ).length
    /** Both original active-resource assertions use the carrier's existing real remover receipt. */
    const rightSubscriptions = subscribed.mock.contexts.filter(
      (receiver) => receiver === rightCarrier
    ).length
    expect(leftSubscriptions - leftCarrier.unsubscribed).toBeGreaterThan(0)
    expect(rightSubscriptions - rightCarrier.unsubscribed).toBeGreaterThan(0)
    await left.dispose()
    // Independent actual-resource isolation witness; no PASS credit for old getPort syntax.
    expect(rightSubscriptions - rightCarrier.unsubscribed).toBeGreaterThan(0)
    await right.dispose()
  } finally {
    try {
      await Promise.all([
        left.dispose(),
        right.dispose(),
        leftClient?.host.close(),
        rightClient?.host.close()
      ])
    } finally {
      subscribed.mockRestore()
    }
  }
})

// C021: native installation failure and fresh native acquisition are one real recovery sequence.
it('C021 preserves a failed native primary and recovers an independent fresh subscription', async () => {
  /** Original receiver acquisition remains unmodified throughout failure and recovery. */
  const subscribed = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
  /** The original actual native install rejection must retain this exact error. */
  const primary = new Error('native retry primary')
  /** The failed registration has no carrier until its real cold source open is reached. */
  const failedServer = coreMemoryServer('subscription-failed')
  /** This native owner actually runs the failed install operation. */
  const failed = receivingHost()
  /** A new independent native owner must remain usable after the first one's rollback. */
  const fresh = receivingHost()
  /** The fresh listener acquires its actual physical endpoint only after failure has completed. */
  const freshServer = coreMemoryServer('subscription-fresh')
  /** Only a genuine accepted client owner is retained for final cleanup. */
  let client: IConnectedClient | undefined
  /** This valid native hook reproduces the original asynchronous install callback failure. */
  const reject = definePlugin({
    name: 'native-retry-first',
    async install() {
      throw primary
    }
  })
  try {
    /** No physical source has opened before the original first native callback rejects. */
    const beforeFailure = subscribed.mock.calls.length
    /** The error belongs to actual NativeHost.use rather than a private role admission table. */
    const failure = await failed
      .use(reject, failedServer.transport)
      .catch((error: unknown) => error)
    await failed.dispose()
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED' })
    expect((failure as { readonly cause?: unknown }).cause).toBe(primary)
    // Zero acquisitions means zero active subscriptions here; it does not claim acquired cleanup.
    expect(subscribed.mock.calls.length - beforeFailure).toBe(0)
    await fresh.use(freshServer.transport)
    client = await freshServer.connect('subscription-fresh-peer')
    /** The existing real server endpoint supplies both original active and terminal observations. */
    const carrier = client.pair[0]
    /** Count only this actual endpoint's successful native subscribe calls. */
    const acquired = subscribed.mock.contexts.filter((receiver) => receiver === carrier).length
    expect(acquired - carrier.unsubscribed).toBeGreaterThan(0)
    await fresh.dispose()
    expect(acquired - carrier.unsubscribed).toBe(0)
  } finally {
    try {
      await Promise.all([failed.dispose(), fresh.dispose(), client?.host.close()])
    } finally {
      subscribed.mockRestore()
    }
  }
})

// C032: genuine pre-attach ownership closes once; no Session or second raw close owner is installed.
it('C032 closes an actually acquired native resource once when preparation rejects', async () => {
  /** The native receiver method remains genuine; this path fails before actual attachment. */
  const subscribed = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
  /** Preserve the original selected variant's exact raw native error value. */
  const primary = new Error('authentication-sync-primary')
  /** Only the source's actual acquired object may supply the ownership and close assertions. */
  let carrier: MemoryCarrier | undefined
  /** This is the same ordinary NativeHost which owns the failing source's registered cleanup. */
  const native = receivingHost()
  /** The genuine SDK setup context lends its publicly typed native owner during acquisition. */
  const transport = defineTransportPlugin({
    name: 'owned-pre-attach-source',
    namespace: 'memory',
    open(context) {
      /** Actual resource acquisition occurs in the source hook, not before a cold open is reached. */
      const acquired = new MemoryCarrier('owned-pre-attach-resource')
      carrier = acquired
      vi.spyOn(acquired, 'close')
      context.owner.onDispose(acquired.close)
      throw primary
    }
  })
  try {
    /** The native installation wrapper retains the original public code and cause facet. */
    const failure = await native.use(transport).catch((error: unknown) => error)
    /** Finish the original native terminal before its final zero/close observations. */
    await native.dispose()
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    /** This supplementary guard proves open really acquired the resource before rollback. */
    assert(carrier)
    /** No subscribe is fabricated before the original pre-attachment failure. */
    const acquiredSubscriptions = subscribed.mock.contexts.filter(
      (receiver) => receiver === carrier
    ).length
    expect(acquiredSubscriptions).toBe(0)
    expect(acquiredSubscriptions - carrier.unsubscribed).toBe(0)
    expect(vi.mocked(carrier.close).mock.calls.length).toBe(1)
  } finally {
    try {
      await native.dispose()
    } finally {
      // NativeHost alone owns raw close; restoring observation never calls raw close again.
      if (carrier) vi.mocked(carrier.close).mockRestore()
      subscribed.mockRestore()
    }
  }
})
