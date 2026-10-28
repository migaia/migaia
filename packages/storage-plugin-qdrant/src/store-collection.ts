// Vector collection class for the Qdrant store (see ./store.ts).
import {
  snapshotStorageVectorCollection,
  snapshotStorageVector,
  snapshotStorageVectorUpsert,
  snapshotStorageVectorSearch,
  snapshotStorageDeleteCountMode,
  snapshotStorageWhere,
  recommendStorageVector
} from '@migaia/storage-host/sdk'
import {
  assertStorageVector,
  assertStringStorageKey,
  assertStorageTtlDuration,
  VectorQueryOriginKind,
  DeleteCountMode,
  type IStorageVectorConfiguration,
  type IVectorCollection,
  type IVectorHit,
  type IStorageKey
} from '@migaia/storage-contract'
import type { ICodecValue } from '@migaia/serialize/codec'
import { QdrantRoute, QdrantText, QdrantManagedVectorName } from './constants.ts'
import { invalidArgument } from './errors.ts'
import { nativeId } from './id.ts'
import { encodePointPayload, assertPointPayload } from './envelope.ts'
import { nativeCondition, orgFilter } from './filter.ts'
import {
  unsupported,
  query,
  retrieve,
  sample,
  idsOf,
  run,
  resolveCollection,
  send,
  deleteWhere,
  vectorCondition
} from './store.ts'
import type { IQdrantOrganizationContext, ICollectionState } from './store.ts'

/** A fixed organization collection owns its canonical schema reference and public vector ports. */
export class QdrantVectorCollection<TPayload> implements IVectorCollection<TPayload, true> {
  /** The original organization supplies admission, native calls and lifetime. */
  readonly #organization: IQdrantOrganizationContext
  /** All organization views borrow one physical schema reference for this logical collection. */
  readonly #current: ICollectionState
  /** Resolve descriptor identity synchronously without opening a native collection. */
  constructor(
    organizationContext: IQdrantOrganizationContext,
    name: string,
    options?: IStorageVectorConfiguration
  ) {
    this.#organization = organizationContext
    organizationContext.backendContext.controller.assertLive()
    /** Schema configuration is retained by the collection across later async discovery. */
    const captured = snapshotStorageVectorCollection(name, options, QdrantText.backend)
    let state = organizationContext.backendContext.collections.get(name)
    if (state) {
      if (
        captured.options &&
        state.configuration &&
        (captured.options.metric !== state.configuration.metric ||
          captured.options.dimensions !== state.configuration.dimensions)
      )
        throw invalidArgument()
      state.configuration ??= captured.options
    } else {
      state = { name, configuration: captured.options }
      organizationContext.backendContext.collections.set(name, state)
    }
    this.#current = state!
  }

  /** Execute the existing near port using this fixed organization and schema. */
  near: IVectorCollection<TPayload, true>['near'] = (input, options) => {
    this.#organization.backendContext.controller.assertLive()
    const exact = options?.exact ?? false,
      metric = options?.metric
    if (typeof exact !== 'boolean') throw invalidArgument()
    if (
      metric !== undefined &&
      this.#current.configuration &&
      metric !== this.#current.configuration.metric
    )
      unsupported()
    /** A deferred query must keep the direction accepted before caller mutation. */
    const direction = snapshotStorageVector(input, this.#current.configuration, QdrantText.backend)
    return query<TPayload>(
      this.#organization,
      this.#current,
      async () => ({ query: direction, exclude: [] }),
      exact,
      metric,
      [],
      { kind: VectorQueryOriginKind.near, vector: direction }
    )
  }

  /** Execute the existing similarTo port using this fixed organization and schema. */
  similarTo: IVectorCollection<TPayload, true>['similarTo'] = (id) => {
    assertStringStorageKey(id, QdrantText.backend)
    return query<TPayload>(
      this.#organization,
      this.#current,
      async (name, configuration, ctx, now) => {
        const row = (await retrieve(this.#organization, name, [id], ctx, configuration))[0]
        if (!row || (row.expiresAt !== undefined && row.expiresAt <= now)) throw invalidArgument()
        return { query: sample(this.#organization, row.point, configuration), exclude: [id] }
      },
      false,
      undefined,
      [],
      { kind: VectorQueryOriginKind.similarTo, id }
    )
  }

  /** Execute the existing recommend port using this fixed organization and schema. */
  recommend: IVectorCollection<TPayload, true>['recommend'] = (examples) => {
    const captured = (function readAcceptedInput() {
      const { positive, negative } = examples,
        pos = idsOf(positive),
        neg = idsOf(negative ?? [])
      if (!pos.length || new Set([...pos, ...neg]).size !== pos.length + neg.length)
        throw invalidArgument()
      return { pos, neg }
    })()
    return query<TPayload>(
      this.#organization,
      this.#current,
      async (name, configuration, ctx, now) => {
        const rows = await retrieve(
            this.#organization,
            name,
            [...captured.pos, ...captured.neg],
            ctx,
            configuration
          ),
          byId = new Map(rows.map((row) => [row.id, row]))
        const load = (id: string) => {
          const row = byId.get(id)
          if (!row || (row.expiresAt !== undefined && row.expiresAt <= now)) throw invalidArgument()
          return sample(this.#organization, row.point, configuration)
        }
        return {
          query: recommendStorageVector(
            captured.pos.map(load) as [readonly number[], ...(readonly number[])[]],
            captured.neg.map(load)
          ),
          exclude: [...captured.pos, ...captured.neg]
        }
      },
      false,
      undefined,
      [],
      {
        kind: VectorQueryOriginKind.recommend,
        positive: captured.pos,
        negative: captured.neg
      }
    )
  }

  /** Execute the existing upsert port using this fixed organization and schema. */
  upsert: IVectorCollection<TPayload, true>['upsert'] = (points, ctx) => {
    const configuration = this.#current.configuration
    /** Points and payloads must remain stable across schema and native-ID awaits. */
    const captured = snapshotStorageVectorUpsert(points, configuration, QdrantText.backend),
      options = { ttlMs: ctx?.ttlMs, policy: ctx?.concurrency }
    if (options.ttlMs !== undefined) assertStorageTtlDuration(options.ttlMs, QdrantText.backend)
    for (const point of captured) assertPointPayload(point.payload as ICodecValue | undefined)
    return run(
      this.#organization,
      QdrantText.upsert,
      captured,
      ctx,
      true,
      async (input, context) => {
        const prepared =
            input === captured
              ? input
              : snapshotStorageVectorUpsert(input, this.#current.configuration, QdrantText.backend),
          facts = prepared.map((point) => ({
            point,
            payload: encodePointPayload(
              this.#organization.orgId,
              point.id,
              point.payload as ICodecValue | undefined
            )
          }))
        const { name, configuration } = await resolveCollection(
            this.#organization,
            this.#current,
            context
          ),
          now = Date.now(),
          ids = await Promise.all(
            prepared.map((point) => nativeId([this.#organization.orgId, point.id]))
          ),
          previous =
            options.ttlMs === undefined && ids.length
              ? await retrieve(
                  this.#organization,
                  name,
                  prepared.map((point) => point.id),
                  context
                )
              : [],
          expiries = new Map(
            previous
              .filter((point) => point.expiresAt !== undefined && point.expiresAt > now)
              .map((point) => [point.id, point.expiresAt!])
          )
        for (const point of prepared)
          assertStorageVector(point.vector, configuration, QdrantText.backend)
        const native = facts.map(({ point, payload: encoded }, index) => {
          const expiry = options.ttlMs === undefined ? expiries.get(point.id) : now + options.ttlMs
          const payload = {
            ...encoded,
            ...(expiry === undefined
              ? {}
              : { [QdrantText.expiresAt]: new Date(expiry).toISOString() })
          }
          return {
            id: ids[index]!,
            vector: {
              [QdrantManagedVectorName.search]: [...point.vector],
              ...(configuration.metric === 'cosine'
                ? { [QdrantManagedVectorName.source]: [...point.vector] }
                : {})
            },
            payload
          }
        })
        if (native.length)
          await send(
            this.#organization,
            QdrantRoute.upsert.name,
            [name, { points: native, wait: true }],
            context
          )
      },
      options.policy
    )
  }

  /** Execute the existing delete port using this fixed organization and schema. */
  delete: IVectorCollection<TPayload, true>['delete'] = (ids, ctx) => {
    /** Native-ID hashing awaits, so retain the original ordered ID selection. */
    const captured = idsOf(ids),
      policy = ctx?.concurrency
    return run(
      this.#organization,
      QdrantText.delete,
      captured,
      ctx,
      true,
      async (input, context) => {
        const { name } = await resolveCollection(this.#organization, this.#current, context),
          physical = await Promise.all(input.map((id) => nativeId([this.#organization.orgId, id])))
        if (physical.length)
          await send(
            this.#organization,
            'delete',
            [
              name,
              {
                filter: orgFilter(this.#organization.orgId, [{ must: [{ has_id: physical }] }]),
                wait: true
              }
            ],
            context
          )
      },
      policy
    )
  }

  /** Execute the existing deleteWhere port using this fixed organization and schema. */
  deleteWhere: IVectorCollection<TPayload, true>['deleteWhere'] = (where, ctx) => {
    const condition = snapshotStorageWhere(where),
      options = {
        count: snapshotStorageDeleteCountMode(ctx?.count ?? undefined, QdrantText.backend),
        policy: ctx?.concurrency
      }
    if (options.count === DeleteCountMode.precount && nativeCondition(condition) === undefined)
      unsupported()
    return run(
      this.#organization,
      QdrantText.deleteWhere,
      condition,
      ctx,
      true,
      (input, context) =>
        deleteWhere(this.#organization, this.#current, input, options.count, context),
      options.policy
    )
  }

  /** Execute the existing search port using this fixed organization and schema. */
  search: IVectorCollection<TPayload, true>['search'] = async (input, options, ctx) => {
    const configuration = this.#current.configuration
    const captured = snapshotStorageVectorSearch(input, options, configuration, QdrantText.backend)
    if (captured.options.k === 0)
      return run(
        this.#organization,
        QdrantText.search,
        captured,
        ctx,
        false,
        async (input, context) => {
          const { configuration } = await resolveCollection(
            this.#organization,
            this.#current,
            context
          )
          assertStorageVector(input.query, configuration, QdrantText.backend)
          return []
        }
      )
    // Public search delegates to the exact same immutable query source and terminal owner.
    const chain = query<TPayload>(
      this.#organization,
      this.#current,
      async () => ({ query: captured.query, exclude: [] }),
      captured.options.exact,
      undefined,
      captured.options.filter ? [vectorCondition(captured.options.filter)] : []
    )
    const hits = await chain.topK(captured.options.k).all(ctx)
    return hits.map((hit) => ({
      id: hit.id,
      score: hit.score,
      ...(captured.options.withPayload && hit.payload !== undefined ? { payload: hit.payload } : {})
    }))
  }
}

/** A vector query emits logical keys and original backend hit metadata. */
export type IQdrantQueryRow<TPayload> = readonly [IStorageKey, IVectorHit<TPayload, boolean>]
