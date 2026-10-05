import type { IRuntimePeerSourceContext, IRuntimePeerProvide, IRuntimePeer } from './peer.js'
import type { IAbortSignal } from '@migaia/lifecycle'

/** Original Host operation and resource ownership travel only through exact internal options. */
export type IRuntimePreparationContext = Readonly<{
  /** Local configuration provenance distinguishes a library default from an explicit self claim. */
  selfDefaulted?: boolean
  /** Adapter-independent node identity is minted by the original Host, never a physical generation. */
  nodeId?: string
  initialSignal: IAbortSignal
  lifecycleSignal: IAbortSignal
  own(dispose: () => Promise<void>): void
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
  runtimePreparationContexts.set(options, context)
  try {
    return await prepare()
  } finally {
    runtimePreparationContexts.delete(options)
  }
}

/** A supervised process has its existing local unit label in addition to the parent's safe offer. */
type IRuntimeLaunchContext = IRuntimePeerSourceContext & Readonly<{ childName?: string }>

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
