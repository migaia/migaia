/** Original native cleanup and rollback errors retain their exact observable owner boundaries. */
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { createRpcHost } from '@migaia/rpc-host'
import { defineTransportPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { walkErrorCauses } from '@migaia/utils/error'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** Native disposal remains the native owner's API, separate from public RPC Root.close. */
function receivingHost() {
  /** Both the listener fixture and partial native source declare this actual cold namespace. */
  const rpc = rpcHostPipelines(
    () => host,
    (key) => host.pipeline(key),
    ['memory']
  )
  /** The same native runtime owns authentic pipeline handles, rollback and final disposal. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  return host
}

/** Register one original resource on the actual native registration without an old scope facade. */
function resourcePlugin(name: string, release: () => void) {
  return definePlugin({
    name,
    install(core) {
      core.onDispose(release)
      return {}
    }
  })
}

/** Throw each original cleanup aggregate unchanged, without adding or removing an error shell. */
function rejectedCleanup(error: unknown) {
  return (): never => {
    throw error
  }
}

/** A genuine later native install failure starts canonical rollback with its original primary. */
function rejectedPlugin(name: string, primary: unknown) {
  return definePlugin({
    name,
    install() {
      throw primary
    }
  })
}

/** This source has no separate native listener beyond its actual Session attachment. */
function releaseSource(): void {}

/** Physical acquisition remains real if the preceding native hook permits installation. */
function physicalTransport(carrier: MemoryCarrier) {
  return defineTransportPlugin({
    name: 'cleanup-native-source',
    namespace: 'memory',
    async open(context) {
      /** The installed context is the only authority for this original physical endpoint. */
      const handle = context.attach(carrier)
      await handle.ready
      return { dispose: releaseSource }
    }
  })
}

/** Execute the original two owned native callbacks before failing the same real transaction. */
async function failedCleanupBatch(
  authenticationCleanup: AggregateError,
  connectCleanup: AggregateError,
  primary: Error
): Promise<unknown> {
  /** Real transport installation shares this exact native transaction and rollback. */
  const server = coreMemoryServer('aggregate-native-cleanup')
  /** No RPC Root.close translates or substitutes the native rollback detail. */
  const host = receivingHost()
  try {
    return await host
      .use(
        resourcePlugin('authentication', rejectedCleanup(authenticationCleanup)),
        resourcePlugin('connect', rejectedCleanup(connectCleanup)),
        server.transport,
        rejectedPlugin('activation', primary)
      )
      .catch((error: unknown) => error)
  } finally {
    await host.dispose()
  }
}

// C028: first two branches are native disposal; only the original endpoint factory uses Root.close.
it('releases native protocol resources exactly once on success and failure, and preserves factory disposal identity', async () => {
  /** Actual native receiver acquisitions are observed without a replacement subscription path. */
  const subscribed = vi.spyOn(MemoryCarrier.prototype, 'subscribe')
  try {
    /** Only the original successful native resource callback increments this count. */
    let successfulReleases = 0
    /** One original callback remains owned by the successful native registration. */
    const successfulRelease = (): void => {
      successfulReleases += 1
    }
    /** Real accepted sessions prove the successful native namespace acquired its physical resource. */
    const server = coreMemoryServer('successful-protocol')
    /** The native owner retains its own disposal Promise and resource callbacks. */
    const successful = receivingHost()
    await successful.use(resourcePlugin('protocol', successfulRelease), server.transport)
    /** Genuine public connection supplies the exact actual server-side carrier identity. */
    const connected = await server.connect('protocol-peer')
    /** Count only acquisitions of this actual endpoint from the original passthrough spy. */
    const acquired = subscribed.mock.contexts.filter(
      (carrier) => carrier === connected.pair[0]
    ).length
    try {
      /** Native disposal, not RPC global close, is the original first branch's API. */
      const successfulDispose = successful.dispose()
      expect(successful.dispose()).toBe(successfulDispose)
      await successfulDispose
      expect(successfulReleases).toBe(1)
      expect(acquired - connected.pair[0].unsubscribed).toBe(0)
    } finally {
      await connected.host.close()
      await successful.dispose()
    }

    /** The original successful acquisition before a later failure must release exactly once. */
    let failedReleases = 0
    /** One real native callback records cleanup during rollback. */
    const failedRelease = (): void => {
      failedReleases += 1
    }
    /** This genuine physical endpoint stays cold when an earlier native install fails. */
    const failedCarrier = new MemoryCarrier('failed-protocol')
    /** The second original native transaction owns its own rollback resources. */
    const failed = receivingHost()
    try {
      await expect(
        failed.use(
          resourcePlugin('protocol', failedRelease),
          rejectedPlugin('contract', new Error('contract rollback primary')),
          physicalTransport(failedCarrier)
        )
      ).rejects.toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        detail: { failedName: 'contract' }
      })
      await failed.dispose()
      expect(failedReleases).toBe(1)
      expect(
        subscribed.mock.contexts.filter((carrier) => carrier === failedCarrier).length -
          failedCarrier.unsubscribed
      ).toBe(0)
    } finally {
      await failed.dispose()
      await failedCarrier.close()
    }

    /** This branch originally used the endpoint factory rather than the native Host directly. */
    const endpointServer = coreMemoryServer('native-factory-equivalence')
    /** BC1 maps the factory endpoint's disposal spelling to its actual public Root.close. */
    const endpoint = await createRpcHost(endpointServer.options)
    /** The public factory owns one stable global completion. */
    const endpointDispose = endpoint.close()
    expect(endpoint.close()).toBe(endpointDispose)
    await endpointDispose
  } finally {
    subscribed.mockRestore()
  }
})

// C047: BC11 removes only the deleted RPC scope shell; native aggregates and their order remain.
it('preserves install primary and exact AggregateError rollback identities/order', async () => {
  /** The original primary must remain separate from both original cleanup aggregates. */
  const primary = new Error('authentication-connect install primary')
  /** These original native child identities cannot be flattened or replaced. */
  const authenticationCleanup = new AggregateError(
    [new Error('authentication cleanup one'), new Error('authentication cleanup two')],
    'authentication cleanup'
  )
  /** The later original registration must appear first in native rollback. */
  const connectCleanup = new AggregateError(
    [new Error('connect cleanup one'), new Error('connect cleanup two')],
    'connect cleanup'
  )
  /** This result is the actual native install error, without RPC global error translation. */
  const failure = await failedCleanupBatch(authenticationCleanup, connectCleanup, primary)
  expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
  /** Retain the original public detail read and all expected nested error shapes. */
  const rollbackErrors = (
    failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
  ).detail?.rollbackErrors
  expect(rollbackErrors).toHaveLength(2)
  /**
   * Native rollback directly retains both original cleanup aggregates in reverse registration
   * order.
   */
  const rollbackEntries = rollbackErrors ?? []
  expect(rollbackEntries).toEqual([connectCleanup, authenticationCleanup])
  expect(rollbackEntries[0]).toBe(connectCleanup)
  expect(rollbackEntries[1]).toBe(authenticationCleanup)
  expect((rollbackEntries[0] as AggregateError).errors).toBe(connectCleanup.errors)
  expect((rollbackEntries[1] as AggregateError).errors).toBe(authenticationCleanup.errors)
})

// C048: both original hostile-role variants keep every matcher and original nested native leaf.
it.each(['authentication', 'connect'] as const)(
  'preserves each hostile %s cleanup AggregateError children and outer order',
  async (hostileRole) => {
    /** The hostile original cleanup must not replace the selected install primary. */
    const primary = new Error(`${hostileRole} aggregate primary`)
    /** Preserve the exact original hostile aggregate children and their order. */
    const hostileChildren = [
      new Error(`${hostileRole} cleanup one`),
      new Error(`${hostileRole} cleanup two`)
    ]
    /** Original admission order independently chooses which aggregate rolls back first. */
    const otherRole = hostileRole === 'authentication' ? 'connect' : 'authentication'
    /** The second aggregate has distinct original child identities. */
    const otherChildren = [
      new Error(`${otherRole} cleanup one`),
      new Error(`${otherRole} cleanup two`)
    ]
    /** Neither actual cleanup aggregate is wrapped by the test to satisfy an old expectation. */
    const hostileCleanup = new AggregateError(hostileChildren, `${hostileRole} cleanup`)
    /** This original aggregate remains intact even when it is not the hostile role. */
    const otherCleanup = new AggregateError(otherChildren, `${otherRole} cleanup`)
    /** Native order follows original role registration, not the order of helper arguments. */
    const failure = await failedCleanupBatch(
      hostileRole === 'authentication' ? hostileCleanup : otherCleanup,
      hostileRole === 'connect' ? hostileCleanup : otherCleanup,
      primary
    )
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    /** Actual native rollback detail is consumed through the same original assertion projection. */
    const rollbackErrors = (
      failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
    ).detail?.rollbackErrors
    expect(rollbackErrors).toHaveLength(2)
    /** The original expected native aggregate identities retain reverse registration order. */
    const expectedOuter =
      hostileRole === 'authentication'
        ? [otherCleanup, hostileCleanup]
        : [hostileCleanup, otherCleanup]
    expect(rollbackErrors).toEqual(expectedOuter)
    /** BC11 removes only the old RPC scope shell, keeping the exact hostile native aggregate. */
    const hostileAggregate = rollbackErrors?.find((error) => error === hostileCleanup) as
      | AggregateError
      | undefined
    expect(hostileAggregate).toBe(hostileCleanup)
    /** Native original children retain exact identities and order independently of scope layering. */
    const hostileErrors = hostileAggregate!.errors
    expect(hostileErrors).toEqual(hostileChildren)
    expect(hostileErrors[0]).toBe(hostileChildren[0])
    expect(hostileErrors[1]).toBe(hostileChildren[1])
  }
)

// C151: BC11 receives native.dispose's real result; RpcRoot.close remains a separate public contract.
it('native result cleanup failure preserves identity and terminal Promise identity', async () => {
  /** The original native resource failure must retain its exact identity if disposal rejects. */
  const cleanup = new Error('native observation result cleanup failure')
  /** Only the original actual native callback increments cleanup attempts. */
  let disposeCalls = 0
  /** This callback is owned by the real native registration. */
  const release = (): never => {
    disposeCalls += 1
    throw cleanup
  }
  /** A genuine SDK transport joins the same canonical native disposal owner. */
  const server = coreMemoryServer('native-result-cleanup')
  /** Native Host.dispose is deliberately retained instead of global RPC error translation. */
  const host = receivingHost()
  await host.use(server.transport, resourcePlugin('native-observation-result-failure', release))
  /** Borrow the original native completion before repeated calls. */
  const dispose = host.dispose()
  expect(host.dispose()).toBe(dispose)
  /** The canonical native summary retains the original leaf without an RPC translation shell. */
  const result = await dispose
  expect(result.logicalTerminal).toBe(true)
  expect(result.cleanupErrors).toHaveLength(1)
  expect(Array.from(walkErrorCauses(result.cleanupErrors[0]))).toContain(cleanup)
  expect(disposeCalls).toBe(1)
  expect(host.dispose()).toBe(dispose)
  await expect(dispose).resolves.toBe(result)
})
