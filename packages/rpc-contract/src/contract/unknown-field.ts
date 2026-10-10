/** A bounded endpoint-owned warning cache for additive protocol fields. */
export type IRpcUnknownFieldWarner = Readonly<{
  note: (connection: string, kind: string, pointer: string, field: string) => void
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

/** Deduplicate unknown fields per inbound connection with bounded LRU admission. */
export function createRpcUnknownFieldWarner(options: {
  readonly maxKeysPerConnection?: number
  readonly maxConnections?: number
  readonly warn: (connection: string, fieldKey: string) => void
}): IRpcUnknownFieldWarner {
  /** A connection is refreshed on each message and evicted from the oldest end. */
  const connections = new Map<string, IConnectionWarnings>()
  /** Local caps let a connection's unknown fields use bounded memory. */
  const maxKeys = options.maxKeysPerConnection ?? 256
  const maxConnections = options.maxConnections ?? 1024
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
        options.warn(connection, '*')
        return
      }
      state.fields.add(fieldKey)
      options.warn(connection, fieldKey)
    },
    clear() {
      connections.clear()
    }
  }
}
