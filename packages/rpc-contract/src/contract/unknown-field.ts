import { identifyContractCallbackFailure } from './contract-error.js'

/** A bounded endpoint-owned warning cache for additive protocol fields. */
export type IRpcUnknownFieldWarner = Readonly<{
  /** Warn once per normalized field key, then emit at most one overflow marker per cache entry. */
  note: (connection: string, kind: string, pointer: string, field: string) => void
  /** Drop retained identities so later notes may warn again. */
  clear: () => void
}>

/** Connection-local state retained in endpoint LRU order. */
type IConnectionWarnings = {
  readonly fields: Set<string>
  overflowWarned: boolean
}

/** Truncate by UTF-16 code units, marking a lost suffix for hook consumers. */
function bounded(value: string, limit: number): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}…`
}

/** Normalize array indexes so many repeated elements share a warning identity. */
function normalizedPointer(pointer: string): string {
  return pointer.replace(/\/[0-9]+(?=\/|$)/gu, '/*')
}

/**
 * Deduplicate unknown fields per inbound connection with bounded LRU retention. Numeric pointer
 * indexes share one identity; overflow emits `*` once. A failing warn hook propagates with
 * Contract's callback-failure identity. This owns only diagnostic cache state, not connection
 * cleanup.
 */
/** Allocate bounded per-connection warning retention before installing behavior callbacks. */
function unknownFieldWarnerState(options: {
  /** Maximum distinct retained keys per connection; defaults to 256. */
  readonly maxKeysPerConnection?: number
  /** Maximum retained connection entries in least-recently-used order; defaults to 1024. */
  readonly maxConnections?: number
  /** Required diagnostic sink, receiving bounded normalized keys or the overflow marker. */
  readonly warn: (connection: string, fieldKey: string) => void
}) {
  /** A connection is refreshed on each message and evicted from the oldest end. */
  const connections = new Map<string, IConnectionWarnings>()
  /** Local caps let a connection's unknown fields use bounded memory. */
  const maxKeys = options.maxKeysPerConnection ?? 256
  /** The configured retention bound limits how many connection warning histories this owner keeps. */
  const maxConnections = options.maxConnections ?? 1024

  return { connections, maxKeys, maxConnections, options }
}

/** Own bounded per-connection warning retention; callbacks access only this explicit instance. */
class UnknownFieldWarner {
  /** All mutable storage and original construction inputs belong to this operation. */
  #state: ReturnType<typeof unknownFieldWarnerState>
  /** Preserve the original stable resource surface and callback identities. */
  readonly value: IRpcUnknownFieldWarner
  /** Initialize owned storage before publishing the resource's callbacks. */
  constructor(options: {
    /** Maximum distinct retained keys per connection; defaults to 256. */
    readonly maxKeysPerConnection?: number
    /** Maximum retained connection entries in least-recently-used order; defaults to 1024. */
    readonly maxConnections?: number
    /** Required diagnostic sink, receiving bounded normalized keys or the overflow marker. */
    readonly warn: (connection: string, fieldKey: string) => void
  }) {
    this.#state = unknownFieldWarnerState(options)

    this.value = {
      note: (connection, kind, pointer, field) => {
        let state = this.#state.connections.get(connection)
        if (state) this.#state.connections.delete(connection)
        else {
          state = { fields: new Set<string>(), overflowWarned: false }
          if (this.#state.connections.size >= this.#state.maxConnections) {
            const oldest = this.#state.connections.keys().next().value
            if (oldest !== undefined) this.#state.connections.delete(oldest)
          }
        }
        this.#state.connections.set(connection, state)
        const fieldKey =
          pointer === '' && (kind === 'kind' || kind === 'variation')
            ? `${kind}:${bounded(field, 64)}`
            : `${bounded(kind, 32)}${bounded(normalizedPointer(pointer), 128)}#${bounded(field, 64)}`
        if (state.fields.has(fieldKey) || state.overflowWarned) return
        if (state.fields.size >= this.#state.maxKeys) {
          state.overflowWarned = true
          this.#warn(connection, '*')
          return
        }
        state.fields.add(fieldKey)
        this.#warn(connection, fieldKey)
      },
      clear: () => {
        this.#state.connections.clear()
      }
    }
  }
  /** The callback retains its original read/call timing and one semantic failure boundary. */
  #warn = (connection: string, fieldKey: string): void => {
    try {
      this.#state.options.warn(connection, fieldKey)
    } catch (error) {
      throw identifyContractCallbackFailure(error)
    }
  }
}

/** Construct the single owner for bounded per-connection warning retention. */
export function createRpcUnknownFieldWarner(options: {
  /** Maximum distinct retained keys per connection; defaults to 256. */
  readonly maxKeysPerConnection?: number
  /** Maximum retained connection entries in least-recently-used order; defaults to 1024. */
  readonly maxConnections?: number
  /** Required diagnostic sink, receiving bounded normalized keys or the overflow marker. */
  readonly warn: (connection: string, fieldKey: string) => void
}): IRpcUnknownFieldWarner {
  return new UnknownFieldWarner(options).value
}
