import type { IKeyValueStore } from '@migaia/storage-contract'
import type { IStorageOrgBinding } from '@migaia/storage-host'
import { resolveStorageNamespace } from '@migaia/storage-host/authoring/backend'
import type { IBackendConstruction, IBackendRuntime } from './construction.js'

/** Retain only physical constructions; registration cleanup and all native behavior stay original. */
export function createBrowserOrgBinding<S extends IKeyValueStore, C>(
  runtime: IBackendRuntime,
  configuredTarget: string,
  initial: IBackendConstruction<S, C>,
  create: (target: string, runtime: IBackendRuntime) => IBackendConstruction<S, C>,
  drop: (physical: IBackendConstruction<S, C>) => Promise<void> = (physical) =>
    physical.dropData?.() ?? physical.store.clearAll()
): IStorageOrgBinding {
  /** Only the original installation may capture this bounded author authority. */
  const author = runtime.createOrgAuthoringPort()
  /** The configured default and explicit default organization share this exact initial object. */
  const physical = new Map<string, IBackendConstruction<S, C>>([[configuredTarget, initial]])
  /** Resolve the same canonical target for lookup and deletion, without a second key codec. */
  const forOrg = (orgId: string): IBackendConstruction<S, C> => {
    initial.controller.assertLive()
    /** The host namespace owner alone defines both the default and UUID-suffixed physical target. */
    const target = resolveStorageNamespace(configuredTarget, orgId, runtime.defaultOrgId)
    /** Reuse the original physical identity, including after its data is dropped. */
    const existing = physical.get(target)
    if (existing !== undefined) return existing
    /** Immutable invocation ports carry this org through every original operation and observer. */
    const context = runtime.getOrgContext(orgId)
    /** Child construction receives only captured installation authority and original native options. */
    const child = create(target, { ...runtime, ...author, ...context, defaultOrgId: orgId })
    author.registerChangeController(child.store, child.controller)
    if (child.commitValueWrite !== undefined)
      author.registerValueCommit(child.store, child.commitValueWrite)
    physical.set(target, child)
    return child
  }
  return Object.freeze({
    backend: (orgId: string) => forOrg(orgId).store,
    drop: (orgId: string) => drop(forOrg(orgId))
  })
}
