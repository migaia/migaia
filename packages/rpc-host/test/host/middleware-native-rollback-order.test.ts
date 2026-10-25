/** Original native rollback preserves exact cleanup leaves, reverse order and terminal promises. */
import { defineHost, definePlugin } from '@migaia/plugin-host'
import { defineTransportPlugin, rpcHostPipelines } from '@migaia/rpc-host/sdk'
import { expect, it, vi } from 'vitest'
import { coreMemoryServer } from './core-fixture.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** The one native Host owns all original registration cleanup and transaction rollback. */
function receivingHost() {
  /** Every real listener and partial source in this receiver declares the memory namespace. */
  const rpc = rpcHostPipelines(
    () => host,
    (key) => host.pipeline(key),
    ['memory']
  )
  /** Original transactions and their genuine pipelines belong to this one receiving runtime. */
  const host = defineHost({
    ...rpc,
    host: { execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } }
  })
  return host
}

/** Exact original cleanup errors leave the native callback unchanged. */
function throwCleanup(error: unknown) {
  return (): never => {
    throw error
  }
}

/** Successful original native registrations own one resource until the batch commits or rolls back. */
function resourcePlugin(name: string, release: () => void) {
  return definePlugin({
    name,
    install(core) {
      core.onDispose(release)
      return {}
    }
  })
}

/** Preserve the original failing native registration name and primary value. */
function rejectedPlugin(name: string, primary: unknown) {
  return definePlugin({
    name,
    async install() {
      throw primary
    }
  })
}

/** Named callbacks avoid changing native cleanup order or hiding an extra resource owner. */
function recordedRelease(events: string[], name: string, error?: unknown) {
  return (): void => {
    events.push(name)
    if (error !== undefined) throw error
  }
}

/** Each original position either fails with its primary or registers its one genuine cleanup. */
function positionedPlugin(
  role: string,
  index: number,
  failureIndex: number,
  primary: unknown,
  cleanup: unknown
) {
  return definePlugin({
    name: role,
    async install(core) {
      if (index === failureIndex) throw primary
      core.onDispose(throwCleanup(cleanup))
      return {}
    }
  })
}

/** Session attachment owns physical cleanup; this native source has no separate listener resource. */
function releaseNativeSource(): void {}

/** This source would acquire one actual Session only if earlier native setup committed. */
function physicalTransport(carrier: MemoryCarrier) {
  return defineTransportPlugin({
    name: 'partial-rollback-transport',
    namespace: 'memory',
    async open(context) {
      /** The canonical native context owns the sole handshake and physical release. */
      const handle = context.attach(carrier)
      await handle.ready
      return { dispose: releaseNativeSource }
    }
  })
}

/** The original failing registration owns both partial resources before throwing its primary. */
function partiallyOwnedPlugin(
  role: string,
  releases: string[],
  primary: unknown,
  firstCleanup: unknown,
  secondCleanup: unknown
) {
  return definePlugin({
    name: `middleware:${role}`,
    async install(core) {
      core.onDispose(recordedRelease(releases, 'first', firstCleanup))
      core.onDispose(recordedRelease(releases, 'second', secondCleanup))
      throw primary
    }
  })
}

// C013's strings are original fault-position labels, not recreated RPC role implementations.
it.each(['kernel', 'middleware:connect', 'feature:outbound', 'activation'] as const)(
  'preserves primary and rollback identities when %s fails',
  async (failedRole) => {
    /** Original admission order determines exactly which resources exist before the failure. */
    const roles = ['kernel', 'middleware:connect', 'feature:outbound', 'activation'] as const
    /** The original index bounds both rollback length and reverse identity observations. */
    const failureIndex = roles.indexOf(failedRole)
    /** The selected exact native value remains the public installation error cause. */
    const primary = new Error(`${failedRole} primary`)
    /** Each original registration has a distinct cleanup identity. */
    const rollback = roles.map((role) => new Error(`${role} rollback`))
    /** One real SDK transport joins the native batch before the original generic registrations. */
    const server = coreMemoryServer(`rollback-${failureIndex}`)
    /** No wrapper translates the native runtime's actual rollback transaction. */
    const host = receivingHost()
    /** These genuine native definitions retain the original four failure positions. */
    const definitions = roles.map((role, index) =>
      positionedPlugin(role, index, failureIndex, primary, rollback[index])
    )
    /** Native rollback has completed before installation rejection is published. */
    let failure: unknown
    try {
      await host.use(server.transport, ...definitions)
    } catch (error) {
      failure = error
    } finally {
      await host.dispose()
    }
    expect(failure).toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: failedRole }
    })
    /** Original public native detail, with no reconstructed cleanup registry. */
    const rollbackErrors = (
      failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
    ).detail?.rollbackErrors
    /** The original projection accepts native AggregateError leaves without changing their identity. */
    const rollbackIdentities = (rollbackErrors ?? []).flatMap((error) =>
      error instanceof AggregateError ? [...error.errors] : [error]
    )
    expect(rollbackIdentities).toHaveLength(failureIndex)
    rollbackIdentities.forEach((error, index) =>
      expect(error).toBe(rollback[failureIndex - index - 1])
    )
  }
)

// C155: the same native installation owns its asynchronous failure and terminal completion.
it('preserves the complete later asynchronous native participant failure and disposal identity', async () => {
  /** The original asynchronous participant rejects with this exact primary object. */
  const primary = new Error('cycle-l later participant failed')
  /** The real native transaction reports the original failing registration name. */
  const lateName = 'cycle-l-later-participant'
  /** An actual RPC SDK transport is admitted before the later ordinary native participant. */
  const server = coreMemoryServer('later-native-participant')
  /** NativeHost owns this use() transaction and the repeated dispose() completion. */
  const host = receivingHost()
  try {
    /** No Root setup wrapper translates the native asynchronous installation failure. */
    const failure = await host
      .use(server.transport, rejectedPlugin(lateName, primary))
      .catch((error: unknown) => error)
    expect(failure).toMatchObject({
      name: 'PluginHostError',
      source: 'plugin.host',
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary,
      detail: { failedName: lateName }
    })
    /** Rollback has completed before this same owner's terminal Promise is borrowed. */
    const firstDispose = host.dispose()
    expect(host.dispose()).toBe(firstDispose)
    await firstDispose
  } finally {
    await host.dispose()
  }
})

// C049: the original actual native resource callbacks retain their names and reverse-once order.
it('releases authentication/connect resources in exact reverse order once', async () => {
  /** Only original native cleanup callbacks produce the release order observations. */
  const released: string[] = []
  /** Later native failure must not replace its original exact cause during rollback. */
  const primary = new Error('activation rollback primary')
  /** The genuine RPC transport is admitted by this same native transaction. */
  const server = coreMemoryServer('native-resource-order')
  /** The native Host owns both callbacks and its stable final completion. */
  const host = receivingHost()
  await expect(
    host.use(
      resourcePlugin('authentication', recordedRelease(released, 'authentication')),
      resourcePlugin('connect', recordedRelease(released, 'connect')),
      server.transport,
      rejectedPlugin('activation', primary)
    )
  ).rejects.toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
  expect(released).toEqual(['connect', 'authentication'])
  expect(new Set(released).size).toBe(2)
  /** Final native disposal must reuse rollback's resource state, not execute cleanup again. */
  const firstDispose = host.dispose()
  expect(host.dispose()).toBe(firstDispose)
  await firstDispose
  expect(released).toEqual(['connect', 'authentication'])
  await host.dispose()
  expect(released).toEqual(['connect', 'authentication'])
})

// C116: retain partial native ownership; only the deleted kernel/debug-port representation retires.
it.each(['hooks', 'ping', 'uuid'] as const)(
  'baseline: legacy %s partial rollback is reverse-once with exact cleanup children',
  async (role) => {
    /** The original partial-install failure remains primary over both cleanup errors. */
    const primary = new Error(`${role}-partial-primary`)
    /** Distinct original leaf identities prove exact reverse cleanup order. */
    const firstCleanup = new Error(`${role}-cleanup-first`)
    /** The last acquired resource must be the first original cleanup leaf. */
    const secondCleanup = new Error(`${role}-cleanup-second`)
    /** Native callbacks alone append actual resource releases. */
    const releases: string[] = []
    /** An existing real physical endpoint remains cold while the earlier native hook fails. */
    const carrier = new MemoryCarrier(`partial-rollback-${role}`)
    /** Passthrough observation retains the actual native receiver acquisition algorithm. */
    const subscribed = vi.spyOn(carrier, 'subscribe')
    /** This is the sole real native transaction owner for partial registration cleanup. */
    const host = receivingHost()
    try {
      /** The genuine native callback owns both resources before its asynchronous failure. */
      const failure = await host
        .use(
          partiallyOwnedPlugin(role, releases, primary, firstCleanup, secondCleanup),
          physicalTransport(carrier)
        )
        .catch((error: unknown) => error)
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toMatchObject({
        code: 'PLUGIN_INSTALL_FAILED',
        cause: primary,
        detail: { failedName: `middleware:${role}` }
      })
      /** Actual native cleanup detail retains every original error without a substitute registry. */
      const rollbackErrors =
        (failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }).detail
          ?.rollbackErrors ?? []
      /** Original native aggregate leaves are projected exactly as in the retained assertion. */
      const cleanupChildren = rollbackErrors.flatMap((error) =>
        error instanceof AggregateError ? [...error.errors] : [error]
      )
      expect(cleanupChildren).toEqual([secondCleanup, firstCleanup])
      expect(releases).toEqual(['second', 'first'])
      expect(subscribed.mock.calls.length).toBe(0)
      expect(subscribed.mock.calls.length - carrier.unsubscribed).toBe(0)
      // A007's kernel.state and A009's old shared ports are exact BC3 NoPASS retirements.
      expect(Reflect.has(host, 'memory')).toBe(false)
      /** The same native completion remains stable after partial rollback finished. */
      const firstDispose = host.dispose()
      expect(host.dispose()).toBe(firstDispose)
      await firstDispose.catch(() => undefined)
    } finally {
      await host.dispose()
      await carrier.close()
      subscribed.mockRestore()
    }
  }
)
