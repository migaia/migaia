import type { IRuntimePeerSourceContext, IRuntimePeerProvide, IRuntimePeer } from './peer.js'
import type { IAbortSignal } from '@migaia/lifecycle'
import type { IRpcRuntimeGeneration } from '../../contract/index.js'
import type { IProviderAdmissionScope } from '../../core/features/provider.js'

/** Original Host operation and resource ownership travel only through exact internal options. */
export type IRuntimePreparationContext = Readonly<{
  /** Local configuration provenance distinguishes a library default from an explicit self claim. */
  selfDefaulted?: boolean
  /** Native source owner describes only its own connection; metadata grants no operation rights. */
  connectionOrigin?(): import('./overview.js').IRuntimeConnectionOrigin
  /** Native process construction preserves transfer rejection before caller capture. */
  restrictTransfer?(options: object | undefined): void
  /** Adapter-independent node identity is minted by the original Host, never a physical generation. */
  host?: import('@migaia/plugin-host').IPluginRuntimeIntegration
  /** All adapter families on this genuine Host borrow the original logical-provider scope. */
  providerAdmission?: IProviderAdmissionScope
  /** Actual Host reservation keeps commit policy separate from the public quota handle. */
  providerAdmissionRegistration?: Readonly<{
    stagePolicy(maxGlobal?: number, maxPerPeer?: number): void
    isCommitted(): boolean
  }>
  initialSignal?: IAbortSignal
  lifecycleSignal?: IAbortSignal
  own?(dispose: () => Promise<void>): void
  /** New native generations compile current Feature snapshots from the original integration port. */
  readProvide?(): IRuntimePeerProvide
  /** Authenticated listener sessions publish through the same original Plugin install slot. */
  publishPeer?(peer: IRuntimePeer): () => void
}>

/** This table transfers original scope provenance; it owns no lifecycle state or policy. */
const runtimePreparationContexts = new WeakMap<object, IRuntimePreparationContext>()

/** Platform factories read the exact context passed by the genuine Plugin install. */
export function readRuntimePreparationContext(
  options: object
): IRuntimePreparationContext | undefined {
  return runtimePreparationContexts.get(options)
}

/** Keep Host startup cancellation and early resource ownership on the original managed scope. */
export async function withRuntimePreparationContext<T>(
  options: object,
  context: IRuntimePreparationContext,
  prepare: () => Promise<T>
): Promise<T> {
  /** Nested preparation restores the previous exact options context after startup. */
  const previous = runtimePreparationContexts.get(options)
  runtimePreparationContexts.set(options, context)
  try {
    return await prepare()
  } finally {
    if (previous) runtimePreparationContexts.set(options, previous)
    else runtimePreparationContexts.delete(options)
  }
}

/** A supervised process has its existing local unit label in addition to the parent's safe offer. */
type IRuntimeLaunchContext = IRuntimePeerSourceContext &
  Readonly<{
    childName?: string
    /** Original native supervisor reserves this execution ordinal in one stable provider namespace. */
    generation?: IRpcRuntimeGeneration
  }>

/**
 * Exact original launch-request identity carries only cold bootstrap metadata, never lifetime
 * state.
 */
const runtimeLaunchContexts = new WeakMap<object, IRuntimeLaunchContext>()

/** Platform deep adapters read only metadata attached to this genuine supervisor launch request. */
export function readRuntimeLaunchContext(context: object): IRuntimeLaunchContext | undefined {
  return runtimeLaunchContexts.get(context)
}

/**
 * A caller-selected original launcher keeps its context and behavior while bootstrap learns the
 * offer.
 */
export async function withRuntimeLaunchContext<T>(
  context: object,
  runtime: IRuntimeLaunchContext,
  launch: () => Promise<T>
): Promise<T> {
  runtimeLaunchContexts.set(context, runtime)
  try {
    return await launch()
  } finally {
    runtimeLaunchContexts.delete(context)
  }
}
