import type { IKeyValueStore } from '@migaia/storage-contract'
import type { IStorageOrgBinding } from '@migaia/storage-host'
import { resolveStorageNamespace } from '@migaia/storage-host/authoring/backend'
import type { IBackendConstruction, IBackendRuntime } from './construction.js'

/** One org registry retains physical constructions while original native owners retain cleanup. */
class BrowserOrgBinding<
  S extends IKeyValueStore,
  C,
  P extends IBackendConstruction<S, C>
> implements IStorageOrgBinding {
  /** Original registration ports retain installation and organization authority. */
  readonly #runtime: IBackendRuntime
  /** Canonical namespace derivation starts from this exact configured target. */
  readonly #configuredTarget: string
  /** The initial physical owner supplies default-org identity and shared closure state. */
  readonly #initial: P
  /** Native construction remains backend-owned and receives the original captured options. */
  readonly #create: (target: string, runtime: IBackendRuntime) => P
  /** Physical data deletion remains the original backend operation. */
  readonly #dropPhysical: (physical: P) => Promise<void>
  /** Only installation captures this finite authoring authority. */
  readonly #author: ReturnType<IBackendRuntime['createOrgAuthoringPort']>
  /** Original physical identities remain stable across lookup and data deletion. */
  readonly #physical: Map<string, P>

  /** Capture original ports and the default construction without opening another native owner. */
  constructor(
    runtime: IBackendRuntime,
    configuredTarget: string,
    initial: P,
    create: (target: string, runtime: IBackendRuntime) => P,
    drop: (physical: P) => Promise<void>
  ) {
    this.#runtime = runtime
    this.#configuredTarget = configuredTarget
    this.#initial = initial
    this.#create = create
    this.#dropPhysical = drop
    this.#author = runtime.createOrgAuthoringPort()
    this.#physical = new Map([[configuredTarget, initial]])
  }

  /** Resolve the original physical target and construct a new org only on its first access. */
  readonly resolve = (orgId: string): P => {
    this.#initial.controller.assertLive()
    /** The host's namespace owner is shared by lookup, construction and deletion. */
    const target = resolveStorageNamespace(
      this.#configuredTarget,
      orgId,
      this.#runtime.defaultOrgId
    )
    /** Reuse original identity even after its data is dropped. */
    const existing = this.#physical.get(target)
    if (existing !== undefined) return existing
    /** One immutable invocation context carries this org through original operations. */
    const context = this.#runtime.getOrgContext(orgId)
    /** This backend alone creates the actual native construction. */
    const child = this.#create(target, {
      ...this.#runtime,
      ...this.#author,
      ...context,
      defaultOrgId: orgId
    })
    this.#author.registerChangeController(child.store, child.controller)
    if (child.commitValueWrite !== undefined)
      this.#author.registerValueCommit(child.store, child.commitValueWrite)
    this.#physical.set(target, child)
    return child
  }

  /** Publish only the original physical store selected by the authentic organization id. */
  readonly backend = (orgId: string): S => this.resolve(orgId).store

  /** Delete data through the native owner while retaining its reusable physical construction. */
  readonly drop = (orgId: string): Promise<void> => this.#dropPhysical(this.resolve(orgId))
}

/** Retain physical constructions without acquiring a second cleanup or namespace owner. */
export function createBrowserOrgBinding<
  S extends IKeyValueStore,
  C,
  P extends IBackendConstruction<S, C> = IBackendConstruction<S, C>
>(
  runtime: IBackendRuntime,
  configuredTarget: string,
  initial: P,
  create: (target: string, runtime: IBackendRuntime) => P,
  drop: (physical: P) => Promise<void> = (physical) =>
    physical.dropData?.() ?? physical.store.clearAll()
): IStorageOrgBinding & { readonly resolve: (orgId: string) => P } {
  return new BrowserOrgBinding(runtime, configuredTarget, initial, create, drop)
}
