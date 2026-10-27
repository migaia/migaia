/** Original raw transport ownership and native rollback oracles use the genuine source owner. */
import { defineHost, definePlugin } from '@migaia/plugin-host'
import {
  defineTransportPlugin,
  rpcHostPipelines,
  type IRpcTransportSetupContext
} from '@migaia/rpc-host/sdk'
import type { IRpcTransportDefinition } from '@migaia/rpc-contract/interfaces'
import { walkErrorCauses } from '@migaia/utils/error'
import { assert, expect, it, vi, type MockInstance as IMockInstance } from 'vitest'
import { readRpcDefinition } from '../../dist/sdk/metadata.js'
import { coreMemoryServer } from './core-fixture.js'
import { MemoryCarrier } from '../fixtures/core-carrier.js'

/** Ownership describes only this pre-Session raw native resource, never an attached Session. */
type ISourceInput = Readonly<{
  name: string
  ownership: 'owned' | 'borrowed'
  borrowed?: MemoryCarrier
  primary?: Error
  closeFailure?: Error
}>

/** Use one actual native Host and its cold namespace group declarations. */
function receivingHost(name: string) {
  /** The SDK helper borrows execution lazily from the exact same native receiving Host. */
  const rpc = rpcHostPipelines(
    () => host,
    (key, request) => host.pipeline(key, request)
  )
  /** The runtime owns rollback and its one stable native disposal Promise. */
  const host = defineHost({
    ...rpc,
    host: {
      identity: { name },
      execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
    }
  })
  return host
}

/** Only the original SDK source hook can acquire and transfer ownership of this raw resource. */
class NativeSourceResource {
  /** The genuine fixture listener owns the actual source context and its original release. */
  readonly #server: ReturnType<typeof coreMemoryServer>
  /** Cold inputs distinguish native ownership from an independently supplied caller resource. */
  readonly #input: ISourceInput
  /** The original real listener open callback is lent unchanged, never reimplemented here. */
  readonly #openListener: IRpcTransportDefinition<
    unknown,
    object,
    IRpcTransportSetupContext
  >['open']
  /** Actual native acquisition publishes only this raw resource reference for assertions. */
  carrier: MemoryCarrier | undefined
  /** The observation delegates every physical close to the original stable native method. */
  closed: IMockInstance<MemoryCarrier['close']> | undefined
  /** This is a real SDK definition; its native transaction owns acquisition and rollback. */
  readonly transport

  /** Capture the existing cold listener and install no resource before genuine native open. */
  constructor(input: ISourceInput) {
    this.#input = input
    this.#server = coreMemoryServer(input.name)
    /** Weak SDK identity supplies the exact original listener acquisition callback. */
    const metadata = readRpcDefinition(this.#server.transport)
    assert(metadata?.kind === 'transport')
    this.#openListener = metadata.definition.open
    this.transport = defineTransportPlugin({
      ...metadata.definition,
      open: this.#open
    })
  }

  /** Own raw resources before fallible native preparation; the real listener retains its cleanup. */
  readonly #open = async (context: IRpcTransportSetupContext) => {
    /** Attached Sessions would own their carriers; this fixture intentionally fails before attach. */
    const carrier =
      this.#input.ownership === 'owned'
        ? new MemoryCarrier(`${this.#input.name}-raw`)
        : this.#input.borrowed!
    this.carrier = carrier
    /** Retain the actual native arrow before installing its passthrough observation. */
    const close = carrier.close
    this.closed = vi.spyOn(carrier, 'close')
    if (this.#input.closeFailure) {
      /** One explicit operation context prevents a replacement lifecycle or extra resource owner. */
      const operation = { close, error: this.#input.closeFailure }
      this.closed.mockImplementation(async (reason) => {
        await operation.close(reason)
        throw operation.error
      })
    }
    if (this.#input.ownership === 'owned') context.owner.onDispose(carrier.close)
    /** The existing canonical fixture opens its genuine source/listener under this native core. */
    const installed = await this.#openListener(context)
    if (this.#input.primary) {
      /** Partial acquisition must register the same real listener receipt before throwing. */
      context.owner.onDispose(installed.dispose)
      throw this.#input.primary
    }
    return installed
  }

  /** Remove observation only; ownership and actual physical close remain with the original owner. */
  restoreObservation(): void {
    this.closed?.mockRestore()
  }
}

/** Native install detail is one existing diagnostic edge in addition to canonical cause/errors. */
function errorChainContains(failure: unknown, expected: unknown): boolean {
  if (Array.from(walkErrorCauses(failure)).includes(expected)) return true
  /** Borrow the genuine native detail without manufacturing a new aggregate or error wrapper. */
  const detail = (failure as { detail?: { rollbackErrors?: readonly unknown[] } })?.detail
  return (detail?.rollbackErrors ?? []).some((error) =>
    Array.from(walkErrorCauses(error)).includes(expected)
  )
}

/** The same current source owner releases owned raw resources and preserves external ownership. */
async function closeOwnedAndBorrowed(): Promise<void> {
  /** This source genuinely acquires its raw resource during its original SDK open hook. */
  const owned = new NativeSourceResource({ name: 'owned-success', ownership: 'owned' })
  /** Native disposal remains the actual public API under the original Promise-identity assertion. */
  const ownedHost = receivingHost('owned-success')
  /** This independent external owner keeps the original raw close implementation untouched. */
  const external = new MemoryCarrier('borrowed-success-raw')
  /** The source receives a borrow and does not transfer the caller's native ownership. */
  const borrowed = new NativeSourceResource({
    name: 'borrowed-success',
    ownership: 'borrowed',
    borrowed: external
  })
  /** A separate real Host owns only the borrowed source's actual listener. */
  const borrowedHost = receivingHost('borrowed-success')
  try {
    await ownedHost.use(owned.transport)
    /** Actual acquisition must precede close counting; an unopened source cannot pass as0. */
    assert(owned.carrier && owned.closed)
    const ownedDispose = ownedHost.dispose()
    expect(ownedHost.dispose()).toBe(ownedDispose)
    await ownedDispose
    expect(owned.closed.mock.calls.length).toBe(1)
    await borrowedHost.use(borrowed.transport)
    assert(borrowed.carrier && borrowed.closed)
    expect(borrowed.carrier).toBe(external)
    const borrowedDispose = borrowedHost.dispose()
    expect(borrowedHost.dispose()).toBe(borrowedDispose)
    await borrowedDispose
    expect(borrowed.closed.mock.calls.length).toBe(0)
    expect(external.closed).toBe(false)
    /** The independent caller can still perform the actual native close after Host disposal. */
    await external.close()
    expect(borrowed.closed.mock.calls.length).toBe(1)
    expect(external.closed).toBe(true)
  } finally {
    await Promise.all([ownedHost.dispose(), borrowedHost.dispose()])
    owned.restoreObservation()
    borrowed.restoreObservation()
    if (!external.closed) await external.close()
  }
}

/** Preserve both original fault-position labels without recreating deleted middleware roles. */
async function partialFailure(failedRole: 'authentication' | 'connect'): Promise<void> {
  /** Actual source preparation throws this original native error after resource acquisition. */
  const primary = new Error(`${failedRole} partial failure`)
  /** The owned source transfers its raw native release to its real installation core. */
  const owned = new NativeSourceResource({
    name: `owned-${failedRole}`,
    ownership: 'owned',
    primary
  })
  /** The failed native transaction owns genuine rollback and its stable final completion. */
  const ownedHost = receivingHost(`owned-${failedRole}`)
  /** Borrowed native ownership remains external even if the receiving source preparation rejects. */
  const external = new MemoryCarrier(`borrowed-${failedRole}-raw`)
  /** Retain the original distinct borrowed failure rather than reusing an error from another branch. */
  const borrowedPrimary = new Error(`${failedRole} borrowed partial failure`)
  /** The borrowed source receives the actual external resource without altering carrier.close. */
  const borrowed = new NativeSourceResource({
    name: `borrowed-${failedRole}`,
    ownership: 'borrowed',
    borrowed: external,
    primary: borrowedPrimary
  })
  /** The independent native failure cannot reuse state or cleanup from the owned source. */
  const borrowedHost = receivingHost(`borrowed-${failedRole}`)
  try {
    await expect(ownedHost.use(owned.transport)).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: primary
    })
    assert(owned.carrier && owned.closed)
    expect(owned.closed.mock.calls.length).toBe(1)
    const ownedDispose = ownedHost.dispose()
    expect(ownedHost.dispose()).toBe(ownedDispose)
    await ownedDispose
    await ownedHost.dispose()
    expect(owned.closed.mock.calls.length).toBe(1)
    await expect(borrowedHost.use(borrowed.transport)).rejects.toMatchObject({
      code: 'PLUGIN_INSTALL_FAILED',
      cause: borrowedPrimary
    })
    assert(borrowed.carrier && borrowed.closed)
    expect(borrowed.carrier).toBe(external)
    expect(borrowed.closed.mock.calls.length).toBe(0)
    await borrowedHost.dispose()
    await borrowedHost.dispose()
    expect(borrowed.closed.mock.calls.length).toBe(0)
    expect(external.closed).toBe(false)
    /** Closing the real external resource proves the0 above did not come from a no-op override. */
    await external.close()
    expect(borrowed.closed.mock.calls.length).toBe(1)
  } finally {
    await Promise.all([ownedHost.dispose(), borrowedHost.dispose()])
    owned.restoreObservation()
    borrowed.restoreObservation()
    if (!external.closed) await external.close()
  }
}

/**
 * The native activation primary and original ordered raw close failure stay independently
 * reachable.
 */
async function retainPrimaryAndCloseLeaf(): Promise<void> {
  /** This actual later native participant is the original transaction's primary failure. */
  const primary = new Error('activation install primary')
  /** The owned raw native close rejects with this original distinct cleanup error. */
  const closeFailure = new Error('owned transport close cleanup failure')
  /** The genuine source acquires its raw resource before the later native install starts. */
  const source = new NativeSourceResource({
    name: 'activation-cleanup',
    ownership: 'owned',
    closeFailure
  })
  /** One actual native owner controls source rollback and the final repeated disposal. */
  const host = receivingHost('activation-cleanup')
  /** The label is an original failure position, not a rebuilt RPC activation port. */
  const activation = definePlugin({
    name: 'activation',
    install: () => {
      throw primary
    }
  })
  /** The exact native error object is captured only after canonical rollback has finished. */
  let failure: unknown
  try {
    failure = await host.use(source.transport, activation).catch((error: unknown) => error)
  } finally {
    await host.dispose()
  }
  try {
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect((failure as { readonly cause?: unknown }).cause).toBe(primary)
    expect(errorChainContains(failure, primary)).toBe(true)
    expect(errorChainContains(failure, closeFailure)).toBe(true)
    /** The original native detail retains real raw leaves in their actual cleanup order. */
    const rollbackErrors = (
      failure as { readonly detail?: { readonly rollbackErrors?: readonly unknown[] } }
    ).detail?.rollbackErrors
    const orderedCleanup = (rollbackErrors ?? []).flatMap((error) =>
      error instanceof AggregateError ? [...error.errors] : [error]
    )
    expect(orderedCleanup).toEqual([closeFailure])
    assert(source.carrier && source.closed)
    expect(source.closed.mock.calls.length).toBe(1)
  } finally {
    source.restoreObservation()
  }
}

// All four original disposal/count assertions retain their values.
it(
  'closes owned success once, borrowed success zero, and repeats Host dispose Promise',
  closeOwnedAndBorrowed
)

// Two original rows retain owned/borrowed failure and repeated cleanup.
it.each(['authentication', 'connect'] as const)(
  'closes owned transport once and leaves borrowed %s partial failure closed',
  partialFailure
)

// Primary, ordered cleanup identity and actual raw close count remain.
it(
  'keeps activation primary while ordered owned close cleanup remains reachable',
  retainPrimaryAndCloseLeaf
)

/** Later native failure rolls back one actually attached Session and its original subscription. */
async function rollbackAttachedSubscription(): Promise<void> {
  /** The exact original activation failure must survive native rollback unchanged. */
  const primary = new Error('activation participant failed')
  /** One real physical endpoint supplies the original receiver and its native unsubscribe receipt. */
  const carrier = new MemoryCarrier('outbound-publication-rollback')
  /** Passthrough observation counts actual Session acquisition without a substitute active counter. */
  const subscribed = vi.spyOn(carrier, 'subscribe')
  /** The existing receiving runtime owns source staging, publication and final disposal. */
  const host = receivingHost('outbound-publication-rollback')
  /** Genuine source acquisition attaches this exact endpoint before the later native failure. */
  const transport = defineTransportPlugin({
    name: 'outbound-publication-source',
    namespace: 'memory',
    open: (context) => {
      /** No remote readiness is invented; the actual pending Session owns its normal lifetime. */
      const session = context.attach(carrier)
      return { dispose: session.close }
    }
  })
  /** This is an actual later native install participant, not a deleted activation-port proxy. */
  const activation = definePlugin({
    name: 'activation',
    install: () => {
      throw primary
    }
  })
  try {
    /** Native rejection is observed only after the real rollback has joined source cleanup. */
    const failure = await host.use(transport, activation).catch((error: unknown) => error)
    expect(failure).toMatchObject({ code: 'PLUGIN_INSTALL_FAILED', cause: primary })
    expect((failure as { readonly cause?: unknown }).cause).toBe(primary)
    expect(subscribed.mock.calls.length).toBe(1)
    expect(subscribed.mock.calls.length - carrier.unsubscribed).toBe(0)
    expect(carrier.closed).toBe(true)
    /** The true public namespace cannot escape the native batch's failed atomic publication. */
    expect(Reflect.get(host, 'memory')).toBeUndefined()
  } finally {
    await host.dispose()
    subscribed.mockRestore()
    if (!carrier.closed) await carrier.close()
  }
}

// Preserve actual failure/subscription business; old ports get no credit.
it(
  'later activation failure rolls back outbound publication and leaves zero subscription residue',
  rollbackAttachedSubscription
)
