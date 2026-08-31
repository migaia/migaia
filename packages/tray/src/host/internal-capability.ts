import type { IProvisionalScope } from '@migaia/lifecycle'

/** Private artifact custody handed from Loader to the managed Graph generation. */
export type ITrayArtifactCustody = Readonly<{
  readonly scope: IProvisionalScope
  readonly rollback: () => Promise<void>
}>

/** Module-private transfer map; only the exact adapted plugin identity can claim custody. */
const custodyByPlugin = new WeakMap<object, ITrayArtifactCustody>()
/** Host-local bridge lets Runtime lease one exact generation without exposing Graph internals. */
const runtimeBridges = new WeakMap<object, IRuntimeBridge>()

/** Exact generation lease and extension snapshot returned to Runtime. */
export type IRuntimeBridge = Readonly<{
  readonly acquire: (name: string) => Readonly<{
    readonly extensions: Readonly<Record<PropertyKey, unknown>>
    /** Opaque exact-generation identity used only by the Runtime self-ticket delegate. */
    readonly generation: object
    readonly release: () => void
  }>
  /** Marks a named callback as active so Host mutation can enforce reentrancy fences. */
  readonly beginRun?: (name: string) => void
  /** Clears the active callback marker after the exact generation lease is released. */
  readonly endRun?: (name: string) => void
  /** Marks the synchronous callback invocation for same-run mutation detection. */
  readonly enterCallback?: (name: string) => void
  /** Clears the synchronous callback invocation marker after callback return. */
  readonly exitCallback?: (name: string) => void
  /** Rejects same-name mutation from inside its own active callback. */
  readonly assertMutationAllowed?: (name: string) => void
  /** Applies a self-removal only when its exact run and generation remain current. */
  readonly selfUnUse?: (name: string, generation: object, runId: number) => Promise<unknown>
  /** Applies a self-replacement only when its exact run and generation remain current. */
  readonly selfReplace?: (
    name: string,
    generation: object,
    plugin: object,
    runId: number
  ) => Promise<unknown>
}>

/** Registers one provisional scope for transfer at the managed mutation commit point. */
export const registerArtifactCustody = (plugin: object, custody: ITrayArtifactCustody): void => {
  custodyByPlugin.set(plugin, custody)
}

/** Claims one exact artifact scope, preventing duplicate ownership paths. */
export const claimArtifactCustody = (plugin: object): ITrayArtifactCustody | undefined => {
  const custody = custodyByPlugin.get(plugin)
  custodyByPlugin.delete(plugin)
  return custody
}

/** Installs one private Runtime bridge for the exact managed Host instance. */
export const registerRuntimeBridge = (host: object, bridge: IRuntimeBridge): void => {
  runtimeBridges.set(host, bridge)
}

/** Reads the private Runtime bridge for one managed Host instance. */
export const readRuntimeBridge = (host: object): IRuntimeBridge | undefined =>
  runtimeBridges.get(host)
