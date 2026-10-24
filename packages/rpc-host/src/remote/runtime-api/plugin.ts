import type { IAbortSignal } from '@migaia/utils/promise'
import { deferred } from '@migaia/utils/promise'
import { createRpcError, RpcCoreErrorCode } from '../../core/errors.js'
import {
  PluginHostError,
  PluginHostErrorCode,
  type IPluginRuntimeFeatureSnapshot
} from '@migaia/plugin-host'
import { readRuntimeOutletConnection, type IRuntimePluginConnection } from './outlet.js'
import { RuntimeApiErrorText, RuntimePluginKey } from './constants.js'
import type { IRuntimePeerMethod, IRuntimePeerProvide } from './peer.js'
import { attachCommitGate, type ICommitGate, type IRuntimeForwardMethodEntry } from './catalog.js'
import { createProviderAdmissionScope } from '../../core/internal/provider-admission.js'
import { attachProviderPreflight } from '../../core/internal/provider.js'
import { registerLocalErrorWireSummary } from '../../core/internal/error-wire-metadata.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'

/** A private extension uses the original atomic shared-slot owner across both adapter families. */
const providerAdmissionSlot = Symbol('runtime-provider-admission')

/** One Host logical provider keeps the same shared family identity across physical adapters. */
const providerAdmissionFamily = Object.freeze({})

/** An absent ordinary exposed method keeps the existing runtime whitelist error. */
function unavailableExposedMethod(): never {
  throw createRpcError(RpcCoreErrorCode.providerNotFound, RuntimeApiErrorText.methodUnavailable)
}

/** One original Host commit and lifecycle signal own the admission state shared by held calls. */
class RuntimeCommitGate implements ICommitGate {
  /** Fulfilled failure data avoids unobserved rejection when an install has no held calls. */
  readonly #completion = deferred<ReturnType<typeof createRpcError> | undefined>()
  /** Only the original slot commit opens admission; later generations reuse the open gate. */
  #open = false
  /** The native lifecycle, rather than an install failure wrapper, supplies rollback cause identity. */
  readonly #lifecycle: IAbortSignal
  /** Rollback records its original native reason before releasing the same shared completion. */
  readonly #onAbort = (): void => {
    const failure = createRpcError(
      RpcCoreErrorCode.targetUnknown,
      RuntimeApiErrorText.targetUnknown,
      resolveAbortReason(this.#lifecycle)
    )
    registerLocalErrorWireSummary(
      failure,
      RpcCoreErrorCode.targetUnknown,
      RuntimeApiErrorText.targetUnknown,
      { preserveSerializedError: true }
    )
    this.#completion.resolve(failure)
  }
  /** Subscribe once to the actual Host lifetime, retaining its initial already-aborted behavior. */
  constructor(lifecycle: IAbortSignal) {
    this.#lifecycle = lifecycle
    if (lifecycle.aborted) this.#onAbort()
    else lifecycle.addEventListener('abort', this.#onAbort, { once: true })
  }
  /** Availability can be read without materializing any invocation resource. */
  readonly isOpen = (): boolean => this.#open
  /** Commit releases the original waiters before publication of the ready event. */
  readonly open = (): void => {
    if (this.#lifecycle.aborted) return
    this.#open = true
    this.#lifecycle.removeEventListener('abort', this.#onAbort)
    this.#completion.resolve(undefined)
  }
  /** Each natural Promise/abort callback retains only this original invocation's settlement. */
  readonly wait = (signal: IAbortSignal): Promise<void> => {
    if (signal.aborted) return Promise.reject(resolveAbortReason(signal))
    return new Promise<void>((resolve, reject) => {
      /** Cancellation releases exactly this call's native listener, not other held invocations. */
      const cancel = (): void => {
        signal.removeEventListener('abort', cancel)
        reject(resolveAbortReason(signal))
      }
      signal.addEventListener('abort', cancel, { once: true })
      this.#completion.promise.then((failure) => {
        signal.removeEventListener('abort', cancel)
        if (signal.aborted) reject(resolveAbortReason(signal))
        else if (failure) reject(failure)
        else resolve()
      })
    })
  }
}

/** Construct the commit boundary consumed by native transport installation and actual methods. */
export function createCommitGate(lifecycle: IAbortSignal): ICommitGate & { open(): void } {
  return new RuntimeCommitGate(lifecycle)
}

/** A cold method whitelist resolves current Feature availability through its original Host owner. */
function exposedMethod(
  readCurrent: () => object | undefined,
  key: string,
  unavailable: () => never = unavailableExposedMethod,
  gate?: ICommitGate
): IRuntimePeerMethod {
  /** Both whole-group admission and invocation consult the same live Host permission owner. */
  const current = () => {
    /** Replacement may change output identity; no physical generation preparation reads it. */
    const receiver = readCurrent()
    /** Only a current enumerable data method can satisfy the already compiled whitelist. */
    const descriptor = receiver && Object.getOwnPropertyDescriptor(receiver, key)
    if (
      !descriptor?.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'function'
    )
      unavailable()
    return { receiver: receiver!, method: descriptor.value }
  }
  /** Invocation keeps the original guard; only preflight is delayed while the install is pending. */
  const method: IRuntimePeerMethod = attachProviderPreflight(
    (payload, context) => {
      /** A lifecycle change after admission still obeys the original invocation-time guard. */
      const { receiver, method } = current()
      return Reflect.apply(method, receiver, [payload, context])
    },
    () => {
      if (!gate || gate.isOpen()) current()
    }
  )
  return gate ? attachCommitGate(method, gate) : method
}

/** Compile only explicitly exposed real Feature methods, flattening away their local Feature name. */
export function exposedProvide(
  expose: readonly string[],
  read: (name: string) => IPluginRuntimeFeatureSnapshot,
  resolve: (name: string) => IRuntimePluginConnection | undefined,
  forwards: Map<string, IRuntimeForwardMethodEntry>,
  nodeId: string,
  gate: ICommitGate
): IRuntimePeerProvide {
  /** One group per Plugin gives the stable plugin.method public namespace. */
  const provide: Record<string, IRuntimePeerProvide> = Object.create(null)
  /** Overlapping whole/single entries share one cold inventory and one callable per Feature path. */
  const snapshots = new Map<string, IPluginRuntimeFeatureSnapshot>()
  /** Same-name methods from different Features remain an actual ambiguity, rather than a union. */
  const owners = new Map<string, string>()
  for (const path of expose) {
    /** The first segment owns the Plugin; a local single-method entry selects the remaining name. */
    const separator = path.indexOf('.')
    /** A whole Plugin has no method selector; forwarding may later contain further remote segments. */
    const name = separator < 0 ? path : path.slice(0, separator)
    /** Local method spelling is checked against descriptors, never a mutable property lookup. */
    const selectedMethod = separator < 0 ? undefined : path.slice(separator + 1)
    /** A genuine ready connection contributes its accepted remote catalog, never Feature reflection. */
    const connection = resolve(name)
    if (connection) {
      /** An explicit miss is a configuration failure before acquiring the exposing source. */
      const methods =
        connection.description?.methods.filter(
          (entry) => selectedMethod === undefined || selectedMethod === entry.name
        ) ?? []
      if (selectedMethod !== undefined && methods.length === 0)
        throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
      for (const entry of methods) {
        /** A whole-plus-method union owns exactly one entry and retains no prepared Peer. */
        const fullName = `${name}.${entry.name}`
        forwards.set(
          fullName,
          Object.freeze({
            kind: 'forward',
            name: fullName,
            method: entry.name,
            forwardedVia: name,
            nodeId,
            supportedModes: entry.supportedModes,
            slot: () => {
              /** The receiving registration's original Feature guard still owns call admission. */
              try {
                read(name)
              } catch (cause) {
                /** An uninstalled connection is an unavailable target, retaining its Host cause. */
                if (
                  cause instanceof PluginHostError &&
                  cause.code === PluginHostErrorCode.pluginNotInstalled
                )
                  throw createRpcError(
                    RpcCoreErrorCode.targetUnknown,
                    RuntimeApiErrorText.targetUnknown,
                    cause
                  )
                throw cause
              }
              const current = resolve(name)
              if (!current)
                throw createRpcError(
                  RpcCoreErrorCode.targetUnknown,
                  RuntimeApiErrorText.targetUnknown
                )
              return current
            }
          })
        )
      }
      continue
    }
    /** Both connection permission and output identity come from the original managed Host. */
    const snapshot = snapshots.get(name) ?? read(name)
    snapshots.set(name, snapshot)
    /** Repeated method names across Features reject before any source or resource is acquired. */
    const group = (provide[name] ?? Object.create(null)) as Record<string, IRuntimePeerMethod>
    /** An explicit missing method rejects configuration rather than silently reducing the whitelist. */
    let found = selectedMethod === undefined
    for (const [feature, output] of Object.entries(snapshot.outputs)) {
      /** Descriptor inspection never evaluates an application getter while building authority. */
      const descriptors = Object.getOwnPropertyDescriptors(output)
      for (const key of Reflect.ownKeys(descriptors)) {
        if (selectedMethod !== undefined && key !== selectedMethod) continue
        /** Symbol/accessor paths cannot silently enter the public callable directory. */
        const descriptor = descriptors[key as string]
        if (
          typeof key !== 'string' ||
          !descriptor ||
          !descriptor.enumerable ||
          !('value' in descriptor)
        )
          throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
        if (typeof descriptor.value !== 'function') continue
        /** A same-Feature overlap is a union; a distinct Feature remains an ambiguous public method. */
        const fullName = `${name}.${key}`
        if (owners.has(fullName) && owners.get(fullName) !== feature)
          throw createRpcError(
            RpcCoreErrorCode.capabilityConflict,
            RuntimeApiErrorText.featureConflict
          )
        found = true
        if (!Object.hasOwn(group, key))
          group[key] = exposedMethod(() => snapshot.readCurrent(feature), key, undefined, gate)
        owners.set(fullName, feature)
      }
    }
    if (!found)
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RuntimeApiErrorText.featureInvalid)
    provide[name] = group
  }
  for (const group of Object.values(provide)) Object.freeze(group)
  return Object.freeze(provide)
}

/** One Host reservation owns staged provider policy until its original slot is committed. */
class RuntimeProviderAdmissionReservation {
  /** The original shared slot remains sole provider scope and commit-index owner. */
  #admission: import('@migaia/plugin-host').IPluginRuntimeSharedSlot<
    ReturnType<typeof createProviderAdmissionScope>
  >
  /** Policy identity is registered before mutation; failed candidates never publish these limits. */
  #policy: { maxGlobal?: number; maxPerPeer?: number } = {}
  /** The returned data borrows actual scope/registration ports without copying lifecycle state. */
  readonly value

  /** Reserve one original shared provider resource and register its cold policy identity. */
  constructor(integration: import('@migaia/plugin-host').IPluginRuntimeIntegration) {
    this.#admission = integration.acquireSharedSlot(
      providerAdmissionSlot,
      providerAdmissionFamily,
      () => createProviderAdmissionScope()
    )
    this.#admission.register(this.#policy, () =>
      this.#admission.facade.constrain(this.#policy.maxGlobal, this.#policy.maxPerPeer)
    )
    this.value = {
      providerAdmission: this.#admission.facade,
      providerAdmissionRegistration: Object.freeze({
        stagePolicy: this.#stagePolicy,
        isCommitted: this.#isCommitted
      })
    }
  }

  /** Stage only this reservation's original minima before Core reads the actual committed index. */
  #stagePolicy = (maxGlobal?: number, maxPerPeer?: number): void => {
    if (maxGlobal !== undefined)
      this.#policy.maxGlobal = Math.min(this.#policy.maxGlobal ?? maxGlobal, maxGlobal)
    if (maxPerPeer !== undefined)
      this.#policy.maxPerPeer = Math.min(this.#policy.maxPerPeer ?? maxPerPeer, maxPerPeer)
  }

  /** Commit authority comes from exact policy membership in the original shared slot index. */
  #isCommitted = (): boolean => this.#admission.registered().includes(this.#policy)
}

/** Borrow the original Host reservation and shared provider owner for each transport installation. */
export function acquireRuntimeProviderAdmission(
  integration: import('@migaia/plugin-host').IPluginRuntimeIntegration
) {
  return new RuntimeProviderAdmissionReservation(integration).value
}

/** Resolve current connections through the original shared outlets and ambiguity policy. */
export function resolveRuntimePluginConnection(
  integration: import('@migaia/plugin-host').IPluginRuntimeIntegration,
  target: string
): IRuntimePluginConnection | undefined {
  for (const key of Object.values(RuntimePluginKey)) {
    /** The canonical outlet owns both ready membership and duplicate-instance detection. */
    const current = readRuntimeOutletConnection(integration.readSharedExtension(key), target)
    if (current === null)
      throw createRpcError(RpcCoreErrorCode.capabilityConflict, RuntimeApiErrorText.targetAmbiguous)
    if (current) return current
  }
  return undefined
}
