import { PluginHostError } from './errors.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { FeatureOverlayText } from './feature-overlay-text.ts'

/** Consumer-owned finite role vocabulary; native issuance never gains role fields. */
export type IFeatureOverlayRole = Readonly<{ role: PropertyKey; repeatable: boolean }>
/** Alias identity belongs to a role; values remain the original installed objects. */
export type IFeatureOverlayEntry<T> = Readonly<{ alias: PropertyKey; value: T }>
/** False disables inheritance for a consumer-owned role. */
export type IFeatureOverlaySelection<T> =
  | IFeatureOverlayEntry<T>
  | Readonly<{ role: PropertyKey; value: false }>
/** Project role metadata once at declaration admission. */
type ICaptured<T> = IFeatureOverlayEntry<T> & IFeatureOverlayRole
/** A native receipt owns one atomic prepared contribution. */
type IContribution<T> = { entries: readonly ICaptured<T>[]; published: boolean }
/** Normalized immutable consumer input is independent of later global changes. */
type ILocal<T> = {
  replacedRoles: ReadonlySet<PropertyKey>
  replacedAliases: ReadonlyMap<PropertyKey, ReadonlySet<PropertyKey>>
  roles: ReadonlyMap<PropertyKey, readonly ICaptured<T>[]>
}
/** Shared empty declaration avoids allocating a new cache key for each default compilation. */
const emptySelection = Object.freeze([])

/** Single rule owner; optional native publication and notifications extend this class. */
export class FeatureOverlay<T> {
  /** Consumer projection defines its compile-time constant role domain. */
  readonly #roleOf: (value: T) => IFeatureOverlayRole
  /** Receipt identity owns both reservations and published entries. */
  readonly #contributions = new Map<object, IContribution<T>>()
  /** Singular roles have exactly one prepared or published provider. */
  readonly #singular = new Map<PropertyKey, object>()
  /** Repeatable role reservations reject aliases before any publication occurs. */
  readonly #aliases = new Map<PropertyKey, Map<PropertyKey, object>>()
  /** Published buckets preserve installation order without rescanning unrelated roles. */
  readonly #buckets = new Map<PropertyKey, Map<PropertyKey, ICaptured<T>>>()
  /** A declaration is normalized once; notifications reuse its exact immutable array identity. */
  readonly #locals = new WeakMap<readonly IFeatureOverlaySelection<T>[], ILocal<T>>()

  /** Capture the consumer's finite role projection without importing native runtime ownership. */
  constructor(roleOf: (value: T) => IFeatureOverlayRole) {
    this.#roleOf = roleOf
  }

  /** Validate one complete contribution before mutating any reservation. */
  prepare(owner: object, values: readonly IFeatureOverlayEntry<T>[]): void {
    if (this.#contributions.has(owner))
      throw new PluginHostError(
        PluginHostErrorCode.featureRoleConflict,
        FeatureOverlayText.duplicateOwner
      )
    /** Batch-local reservations make a failed prepare atomic. */
    const singular = new Set<PropertyKey>()
    /** Aliases are unique within each repeatable role, including unpublished reservations. */
    const aliases = new Map<PropertyKey, Set<PropertyKey>>()
    /** Captured metadata belongs to this exact receipt until removal. */
    const entries: ICaptured<T>[] = []
    for (const entry of values) {
      /** Role projection is evaluated once for this original installed value. */
      const role = this.#roleOf(entry.value)
      if (!role.repeatable) {
        if (this.#singular.has(role.role) || singular.has(role.role))
          throw new PluginHostError(
            PluginHostErrorCode.featureRoleConflict,
            FeatureOverlayText.conflict
          )
        singular.add(role.role)
      } else {
        /** Local aliases reserve nothing globally until all entries pass. */
        let selected = aliases.get(role.role)
        if (!selected) aliases.set(role.role, (selected = new Set()))
        if (selected.has(entry.alias) || this.#aliases.get(role.role)?.has(entry.alias))
          throw new PluginHostError(
            PluginHostErrorCode.featureRoleConflict,
            FeatureOverlayText.aliasConflict
          )
        selected.add(entry.alias)
      }
      entries.push(Object.freeze({ alias: entry.alias, value: entry.value, ...role }))
    }
    if (entries.length === 0) return
    for (const entry of entries) {
      if (!entry.repeatable) this.#singular.set(entry.role, owner)
      else {
        /** One indexed reservation owner per role and alias. */
        let reserved = this.#aliases.get(entry.role)
        if (!reserved) this.#aliases.set(entry.role, (reserved = new Map()))
        reserved.set(entry.alias, owner)
      }
    }
    this.#contributions.set(owner, { entries, published: false })
  }

  /** Publish only this receipt; each entry is inserted once into its role's ordered bucket. */
  commit(owner: object): boolean {
    /** Missing or already committed receipts have no additional visible effect. */
    const contribution = this.#contributions.get(owner)
    if (!contribution || contribution.published) return false
    contribution.published = true
    for (const entry of contribution.entries) {
      /** Map insertion order is the installation order within this role. */
      let bucket = this.#buckets.get(entry.role)
      if (!bucket) this.#buckets.set(entry.role, (bucket = new Map()))
      bucket.set(entry.alias, entry)
    }
    return true
  }

  /** Withdraw one exact receipt in time proportional to its entries; repeated removal is inert. */
  remove(owner: object): boolean {
    /** Rollback removes reservations even when the receipt never published. */
    const contribution = this.#contributions.get(owner)
    if (!contribution) return false
    this.#contributions.delete(owner)
    for (const entry of contribution.entries) {
      if (!entry.repeatable) this.#singular.delete(entry.role)
      else {
        /** Empty reservations must not accumulate retired role state. */
        const aliases = this.#aliases.get(entry.role)!
        aliases.delete(entry.alias)
        if (aliases.size === 0) this.#aliases.delete(entry.role)
      }
      if (contribution.published) {
        /** Removing one alias does not disturb surviving installation order. */
        const bucket = this.#buckets.get(entry.role)!
        bucket.delete(entry.alias)
        if (bucket.size === 0) this.#buckets.delete(entry.role)
      }
    }
    return contribution.published
  }

  /** Compile role-first output, skipping disabled buckets and reusing normalized local declarations. */
  compile(
    local: readonly IFeatureOverlaySelection<T>[] = emptySelection
  ): readonly IFeatureOverlayEntry<T>[] {
    /** Local declaration identity is stable for the consumer's lifetime. */
    let selected = this.#locals.get(local)
    if (!selected) {
      selected = this.#normalize(local)
      this.#locals.set(local, selected)
    }
    /** Complete materialization belongs to the cold consumer, never the hot call path. */
    const result: IFeatureOverlayEntry<T>[] = []
    // The role domain is a consumer compile-time constant: log has entry/gate/format plus
    // three delivery policies; RPC has timeout/retry. No role-count growth is supported.
    for (const [role, bucket] of this.#buckets) {
      if (!selected.replacedRoles.has(role))
        for (const entry of bucket.values())
          if (!entry.repeatable || !selected.replacedAliases.get(role)?.has(entry.alias))
            result.push(Object.freeze({ alias: entry.alias, value: entry.value }))
      for (const entry of selected.roles.get(role) ?? emptySelection)
        result.push(Object.freeze({ alias: entry.alias, value: entry.value }))
    }
    // Same fixed role-domain bound as above; local-only roles follow published roles.
    for (const [role, entries] of selected.roles)
      if (!this.#buckets.has(role))
        for (const entry of entries)
          result.push(Object.freeze({ alias: entry.alias, value: entry.value }))
    return Object.freeze(result)
  }

  /** Normalize last-local-wins rules once, preserving local order inside each role. */
  #normalize(local: readonly IFeatureOverlaySelection<T>[]): ILocal<T> {
    /** Disabled and replaced singular roles need no global entry visits. */
    const replacedRoles = new Set<PropertyKey>()
    /** Replaced aliases are scoped to their repeatable role; the same alias may exist elsewhere. */
    const replacedAliases = new Map<PropertyKey, Set<PropertyKey>>()
    /** Captured declarations preserve the original local order. */
    const selected: ICaptured<T>[] = []
    /** Singular last-wins indices include explicit role disables. */
    const localRoles = new Map<PropertyKey, number>()
    /** Repeatable last-wins indices use the declared alias within its role. */
    const localAliases = new Map<PropertyKey, Map<PropertyKey, number>>()
    for (const entry of local) {
      if ('role' in entry) {
        replacedRoles.add(entry.role)
        localRoles.set(entry.role, -1)
      } else {
        /** Projection runs only at declaration, not on subsequent notifications. */
        const role = this.#roleOf(entry.value)
        if (role.repeatable) {
          /** Role-scoped alias sets keep last-local-wins inside one role only. */
          let aliases = replacedAliases.get(role.role)
          if (!aliases) replacedAliases.set(role.role, (aliases = new Set()))
          aliases.add(entry.alias)
          /** Role-scoped index of the last local declaration for each alias. */
          let indices = localAliases.get(role.role)
          if (!indices) localAliases.set(role.role, (indices = new Map()))
          indices.set(entry.alias, selected.length)
        } else {
          replacedRoles.add(role.role)
          localRoles.set(role.role, selected.length)
        }
        selected.push(Object.freeze({ alias: entry.alias, value: entry.value, ...role }))
      }
    }
    /** Group surviving locals by role without sorting or repeatedly copying arrays. */
    const roles = new Map<PropertyKey, ICaptured<T>[]>()
    for (let index = 0; index < selected.length; index += 1) {
      /** A replaced declaration is never materialized. */
      const entry = selected[index]!
      if (
        (entry.repeatable
          ? localAliases.get(entry.role)!.get(entry.alias)
          : localRoles.get(entry.role)) !== index
      )
        continue
      /** Each local role has one installation-ordered output bucket. */
      let bucket = roles.get(entry.role)
      if (!bucket) roles.set(entry.role, (bucket = []))
      bucket.push(entry)
    }
    return { replacedRoles, replacedAliases, roles }
  }
}
