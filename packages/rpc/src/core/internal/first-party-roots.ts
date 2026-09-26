import type { IWebRpcFeature } from '../feature.js'
import { createCanonicalChunkFeature } from '../features/canonical-chunk.js'
import { createControlFeature } from '../features/control.js'
import { createDiscoveryFeature } from '../features/discovery.js'
import { createOneWayFeature } from '../features/one-way.js'
import { createOutboundFeature } from '../features/outbound.js'
import { createProviderFeature } from '../features/provider.js'

/** Names identify selected package-owned roots without carrying legacy EndpointModule tokens. */
export type IWebRpcFirstPartyRootName =
  | 'first-party-chunk'
  | 'first-party-outbound'
  | 'first-party-discovery'
  | 'first-party-control'
  | 'first-party-provider'
  | 'first-party-one-way'

/** Retains the concrete Feature value type produced by each package-owned constructor. */
type IFirstPartyRootValues = Readonly<{
  readonly 'first-party-chunk': ReturnType<typeof createCanonicalChunkFeature>
  readonly 'first-party-outbound': ReturnType<typeof createOutboundFeature>
  readonly 'first-party-discovery': ReturnType<typeof createDiscoveryFeature>
  readonly 'first-party-control': ReturnType<typeof createControlFeature>
  readonly 'first-party-provider': ReturnType<typeof createProviderFeature>
  readonly 'first-party-one-way': ReturnType<typeof createOneWayFeature>
}>
/** Includes only actual closure dependencies required by the selected roots. */
type IFirstPartyClosureNames<TSelected extends IWebRpcFirstPartyRootName> =
  | TSelected
  | (TSelected extends
      | 'first-party-outbound'
      | 'first-party-discovery'
      | 'first-party-control'
      | 'first-party-provider'
      | 'first-party-one-way'
      ? 'first-party-chunk'
      : never)
  | (TSelected extends
      | 'first-party-discovery'
      | 'first-party-control'
      | 'first-party-provider'
      | 'first-party-one-way'
      ? 'first-party-outbound'
      : never)
  | (TSelected extends 'first-party-control' ? 'first-party-discovery' : never)
/** Native record type preserves concrete values; selection itself remains a separate brand. */
type IFirstPartyRootsFor<TSelected extends IWebRpcFirstPartyRootName> = Pick<
  IFirstPartyRootValues,
  IFirstPartyClosureNames<TSelected>
>
/** Projects only selected public roots that are present in the concrete closure record. */
type IFirstPartyPublicRootNames<TSelected extends IWebRpcFirstPartyRootName> = Extract<
  TSelected | ('first-party-provider' extends TSelected ? 'first-party-outbound' : never),
  keyof IFirstPartyRootsFor<TSelected>
>

/** Adds provider's public outbound projection while keeping the selected root union precise. */
function selectPublicRoots<TSelected extends IWebRpcFirstPartyRootName>(
  selected: ReadonlySet<TSelected>
): readonly IFirstPartyPublicRootNames<TSelected>[]
function selectPublicRoots(
  selected: ReadonlySet<IWebRpcFirstPartyRootName>
): readonly IWebRpcFirstPartyRootName[] {
  const values = [...selected]
  return selected.has('first-party-provider') ? [...values, 'first-party-outbound'] : values
}

/**
 * Records caller-selected public roots while the returned record also carries private closure
 * nodes.
 */
const publicRootNames = new WeakMap<object, readonly string[]>()
declare const firstPartyPublicRootsBrand: unique symbol

/** Retains the explicit public root selection in the type system without creating runtime state. */
export type IWebRpcFirstPartyRoots<
  TRoots extends Readonly<Record<string, IWebRpcFeature>>,
  TPublicRoots extends string
> = TRoots & Readonly<{ readonly [firstPartyPublicRootsBrand]: TPublicRoots }>

/** Extracts only roots selected for endpoint projection; unbranded external records remain explicit. */
export type IWebRpcPublicFirstPartyRootNames<TRoots> =
  TRoots extends IWebRpcFirstPartyRoots<
    Readonly<Record<string, IWebRpcFeature>>,
    infer TPublicRoots
  >
    ? TPublicRoots
    : Extract<keyof TRoots, string>

/** Attaches the public selection to a native closure without turning it into a second graph. */
export function registerFirstPartyPublicRoots<
  T extends Readonly<Record<string, IWebRpcFeature>>,
  TPublicRoots extends string
>(roots: T, selected: readonly TPublicRoots[]): IWebRpcFirstPartyRoots<T, TPublicRoots> {
  publicRootNames.set(roots, Object.freeze([...selected]))
  return roots as IWebRpcFirstPartyRoots<T, TPublicRoots>
}

/** Reads the explicit root selection; unmarked caller records remain fully public by contract. */
export function readFirstPartyPublicRoots(
  roots: Readonly<Record<string, IWebRpcFeature>>
): readonly string[] {
  return publicRootNames.get(roots) ?? Object.keys(roots)
}

/** Builds only the selected native Feature closure; dependencies remain private PluginHost edges. */
export function createFirstPartyRoots<const TSelected extends IWebRpcFirstPartyRootName>(
  selected: ReadonlySet<TSelected>
): IWebRpcFirstPartyRoots<IFirstPartyRootsFor<TSelected>, IFirstPartyPublicRootNames<TSelected>> {
  /**
   * Runtime closure construction may query every known root while its return type retains
   * TSelected.
   */
  const selectedRoots: ReadonlySet<IWebRpcFirstPartyRootName> = selected
  const outboundRequired = [
    'first-party-outbound',
    'first-party-discovery',
    'first-party-control',
    'first-party-provider',
    'first-party-one-way'
  ].some((name) => selectedRoots.has(name as IWebRpcFirstPartyRootName))
  const needsChunk = outboundRequired || selectedRoots.has('first-party-chunk')
  const chunk = needsChunk ? createCanonicalChunkFeature() : undefined
  const outbound = chunk && outboundRequired ? createOutboundFeature(chunk) : undefined
  const discovery =
    outbound &&
    (selectedRoots.has('first-party-discovery') || selectedRoots.has('first-party-control'))
      ? createDiscoveryFeature(outbound)
      : undefined
  const roots: Partial<IFirstPartyRootValues> = {
    ...(chunk ? { 'first-party-chunk': chunk } : {}),
    ...(outbound ? { 'first-party-outbound': outbound } : {}),
    ...(discovery ? { 'first-party-discovery': discovery } : {}),
    ...(outbound && discovery && selectedRoots.has('first-party-control')
      ? { 'first-party-control': createControlFeature(outbound, discovery) }
      : {}),
    ...(outbound && selectedRoots.has('first-party-provider')
      ? { 'first-party-provider': createProviderFeature(outbound) }
      : {}),
    ...(outbound && selectedRoots.has('first-party-one-way')
      ? { 'first-party-one-way': createOneWayFeature(outbound) }
      : {})
  }
  /** Provider preserves its historical request/reply projection through the outbound dependency. */
  const publicSelection = selectPublicRoots(selected)
  return registerFirstPartyPublicRoots<
    IFirstPartyRootsFor<TSelected>,
    IFirstPartyPublicRootNames<TSelected>
  >(roots as IFirstPartyRootsFor<TSelected>, [
    ...new Set(publicSelection)
  ]) as IWebRpcFirstPartyRoots<
    IFirstPartyRootsFor<TSelected>,
    IFirstPartyPublicRootNames<TSelected>
  >
}
