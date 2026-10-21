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
export function createRpcUnknownFieldWarner(options: {
  /** Maximum distinct retained keys per connection; defaults to 256. */
  readonly maxKeysPerConnection?: number
  /** Maximum retained connection entries in least-recently-used order; defaults to 1024. */
  readonly maxConnections?: number
  /** Required diagnostic sink, receiving bounded normalized keys or the overflow marker. */
  readonly warn: (connection: string, fieldKey: string) => void
}): IRpcUnknownFieldWarner {
  /** A connection is refreshed on each message and evicted from the oldest end. */
  const connections = new Map<string, IConnectionWarnings>()
  /** Local caps let a connection's unknown fields use bounded memory. */
  const maxKeys = options.maxKeysPerConnection ?? 256
  const maxConnections = options.maxConnections ?? 1024
  /** The callback retains its original read/call timing and one semantic failure boundary. */
  const warn = (connection: string, fieldKey: string): void => {
    try {
      options.warn(connection, fieldKey)
    } catch (error) {
      throw identifyContractCallbackFailure(error)
    }
  }
  return {
    note(connection, kind, pointer, field) {
      let state = connections.get(connection)
      if (state) connections.delete(connection)
      else {
        state = { fields: new Set<string>(), overflowWarned: false }
        if (connections.size >= maxConnections) {
          const oldest = connections.keys().next().value
          if (oldest !== undefined) connections.delete(oldest)
        }
      }
      connections.set(connection, state)
      const fieldKey =
        pointer === '' && (kind === 'kind' || kind === 'variation')
          ? `${kind}:${bounded(field, 64)}`
          : `${bounded(kind, 32)}${bounded(normalizedPointer(pointer), 128)}#${bounded(field, 64)}`
      if (state.fields.has(fieldKey) || state.overflowWarned) return
      if (state.fields.size >= maxKeys) {
        state.overflowWarned = true
        warn(connection, '*')
        return
      }
      state.fields.add(fieldKey)
      warn(connection, fieldKey)
    },
    clear() {
      connections.clear()
    }
  }
}
