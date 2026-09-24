import type { IStorageChange } from '@migaia/storage-contract'
import {
  createEventChannel,
  EventDispatchPolicy,
  type IEventChannel
} from '@migaia/event-subscriber'
import { isPlainObject } from '@migaia/utils/object'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '../core/key-domain.js'
import { safeJsonPayloadByteLength } from '../utils/json.js'
import { StorageErrorText } from '../error-text.js'
import { StorageErrorCode, createStorageTypeError } from '../types/errors.js'

/** Versioned metadata-only message shape used by admitted IndexedDB transports. */
type IIndexedDbWireHint = {
  readonly version: 1
  readonly origin: string
  readonly sequence: number
  readonly channel: IStorageChange['channel']
  readonly kind: IStorageChange['kind']
  readonly scope?: string
  readonly keys?: readonly string[]
}

type IQueuedIndexedDbHint = {
  readonly change: IStorageChange
  readonly exclude?: symbol
}

type IIndexedDbCoordinationEntry = {
  readonly registryKey: string
  readonly fanout: IEventChannel<IQueuedIndexedDbHint>
  /** Number of live coordination handles; event-subscriber owns their listener registrations. */
  memberCount: number
  readonly seenOrigins: Map<string, number>
  readonly pending: IQueuedIndexedDbHint[]
  readonly pendingScopes: Set<string>
  channel: BroadcastChannel | undefined
  onMessage: (event: MessageEvent<unknown>) => void
  readonly report: (error: unknown) => void
  drainScheduled: boolean
  disposed: boolean
}

type IIndexedDbCoordinationOptions = {
  readonly factory: IDBFactory
  readonly realmDefaultFactory: IDBFactory | undefined
  readonly broadcastChannel: typeof BroadcastChannel | undefined
  readonly dbName: string
  readonly layoutFingerprint: string
  readonly ownOrigin: string
  readonly onChange: (change: IStorageChange) => void
  readonly report: (error: unknown) => void
}

/** Maximum encoded wire payload; larger hints degrade to coarse invalidation. */
const MAX_HINT_BYTES = 16 * 1024
/** Maximum number of encoded keys carried by one hint. */
const MAX_HINT_KEYS = 128
/** Maximum origin length accepted from an untrusted transport. */
const MAX_ORIGIN_LENGTH = 128
/** Maximum scope length accepted from an untrusted transport. */
const MAX_SCOPE_LENGTH = 512
/** Maximum origin buckets retained by the bounded duplicate filter. */
const MAX_DEDUPE_ORIGINS = 256
/** Maximum pending scopes before invalidation collapses to one coarse hint. */
const MAX_PENDING_SCOPES = 256

/** One realm-local identity token per factory; the token never enters persistence or wire data. */
const factoryTokens = new WeakMap<object, symbol>()
/** One coordination registry per factory data universe. */
const factoryRegistries = new WeakMap<object, Map<string, IIndexedDbCoordinationEntry>>()

/** Return a stable opaque token for one factory object without exposing it to callers. */
const factoryTokenOf = (factory: IDBFactory): symbol => {
  const object = factory as unknown as object
  const existing = factoryTokens.get(object)
  if (existing !== undefined) return existing
  const token = Symbol('indexed-db-factory')
  factoryTokens.set(object, token)
  return token
}

/** Hash a physical identity into a channel name without putting database details on the wire. */
const hashChannelIdentity = (value: string): string => {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

/** Return the canonical allowed property names for strict wire-shape validation. */
const isAllowedWireKey = (key: string): boolean =>
  key === 'version' ||
  key === 'origin' ||
  key === 'sequence' ||
  key === 'channel' ||
  key === 'kind' ||
  key === 'scope' ||
  key === 'keys'

type IIndexedDbWireSnapshot = {
  readonly version: unknown
  readonly origin: unknown
  readonly sequence: unknown
  readonly channel: unknown
  readonly kind: unknown
  readonly scope?: unknown
  readonly keys?: unknown
}

/** Capture every wire accessor once into immutable plain data for both sizing and decoding. */
const snapshotWireHint = (value: object): IIndexedDbWireSnapshot => {
  /** Reads the untrusted DTO through one stable source object. */
  const source = value as Record<string, unknown>
  /** Captures the optional key collection before any size or decode pass. */
  const sourceKeys = source.keys
  /** Copies key arrays so nested mutable values cannot change between consumers. */
  const keys = Array.isArray(sourceKeys)
    ? Object.freeze(sourceKeys.map((encodedKey) => encodedKey))
    : sourceKeys
  /** Captures optional scope once while omitting absent fields from the snapshot. */
  const scope = source.scope
  return Object.freeze({
    version: source.version,
    origin: source.origin,
    sequence: source.sequence,
    channel: source.channel,
    kind: source.kind,
    ...(scope === undefined ? {} : { scope }),
    ...(keys === undefined ? {} : { keys })
  })
}

/** Validate one metadata-only message and decode its bounded canonical storage keys. */
const decodeWireHint = (
  value: unknown,
  ownOrigin: string,
  report: (error: unknown) => void
): IStorageChange | undefined => {
  try {
    if (!isPlainObject(value)) return
    const keys = Reflect.ownKeys(value)
    if (!keys.every((key) => typeof key === 'string' && isAllowedWireKey(key))) return
    const snapshot = snapshotWireHint(value)
    if (safeJsonPayloadByteLength(snapshot) > MAX_HINT_BYTES) return
    const { version, origin, sequence, channel, kind, scope, keys: encodedKeys } = snapshot
    if (
      version !== 1 ||
      typeof origin !== 'string' ||
      origin.length === 0 ||
      origin.length > MAX_ORIGIN_LENGTH ||
      origin === ownOrigin ||
      typeof sequence !== 'number' ||
      !Number.isSafeInteger(sequence) ||
      sequence <= 0 ||
      (channel !== 'value' && channel !== 'bytes' && channel !== 'record' && channel !== 'all') ||
      (kind !== 'put' &&
        kind !== 'remove' &&
        kind !== 'clear' &&
        kind !== 'batch' &&
        kind !== 'migrate')
    )
      return
    if (scope !== undefined && (typeof scope !== 'string' || scope.length > MAX_SCOPE_LENGTH))
      return
    if (encodedKeys !== undefined) {
      if (
        !Array.isArray(encodedKeys) ||
        encodedKeys.length > MAX_HINT_KEYS ||
        encodedKeys.some((encoded) => typeof encoded !== 'string')
      )
        return
    }
    let decodedKeys: IStorageChange['keys']
    if (encodedKeys !== undefined) {
      decodedKeys = encodedKeys.map((encoded) => {
        const decoded = decodeFlatStorageKey(encoded)
        if (decoded === undefined)
          throw createStorageTypeError(
            StorageErrorCode.deserializeFailed,
            StorageErrorText.indexedDbChangeHintKeyInvalid
          )
        return decoded
      })
    }
    return { origin, sequence, channel, kind, scope, keys: decodedKeys }
  } catch (error) {
    report(error)
    return
  }
}

/** Build a bounded DTO, degrading oversized key batches to a coarse metadata-only hint. */
const encodeWireHint = (
  change: IStorageChange,
  report: (error: unknown) => void
): IIndexedDbWireHint | undefined => {
  if (
    change.origin.length === 0 ||
    change.origin.length > MAX_ORIGIN_LENGTH ||
    !Number.isSafeInteger(change.sequence) ||
    change.sequence <= 0
  )
    return
  const scope =
    change.scope !== undefined && change.scope.length <= MAX_SCOPE_LENGTH ? change.scope : undefined
  let encodedKeys: readonly string[] | undefined
  try {
    if (change.keys !== undefined && change.keys.length <= MAX_HINT_KEYS)
      encodedKeys = change.keys.map(encodeFlatStorageKey)
  } catch (error) {
    report(error)
  }
  const candidate: IIndexedDbWireHint = {
    version: 1,
    origin: change.origin,
    sequence: change.sequence,
    channel: change.channel,
    kind: change.kind,
    ...(scope === undefined ? {} : { scope }),
    ...(encodedKeys === undefined ? {} : { keys: encodedKeys })
  }
  if (safeJsonPayloadByteLength(candidate) <= MAX_HINT_BYTES) return candidate
  return {
    version: 1,
    origin: change.origin,
    sequence: change.sequence,
    channel: change.channel,
    kind: change.kind,
    ...(scope === undefined ? {} : { scope })
  }
}

/** Accept only strictly newer sequence values and evict the oldest bounded origin bucket. */
const rememberHint = (entry: IIndexedDbCoordinationEntry, change: IStorageChange): boolean => {
  const existing = entry.seenOrigins.get(change.origin)
  if (existing !== undefined && change.sequence <= existing) return false
  if (existing === undefined) {
    if (entry.seenOrigins.size >= MAX_DEDUPE_ORIGINS) {
      const oldest = entry.seenOrigins.keys().next().value
      if (oldest !== undefined) entry.seenOrigins.delete(oldest)
    }
    entry.seenOrigins.set(change.origin, change.sequence)
    return true
  }
  entry.seenOrigins.delete(change.origin)
  entry.seenOrigins.set(change.origin, change.sequence)
  return true
}

/** Schedule at most one pending-hint drain per event-loop turn. */
const scheduleDrain = (entry: IIndexedDbCoordinationEntry): void => {
  if (entry.drainScheduled || entry.disposed) return
  entry.drainScheduled = true
  const drain = (): void => {
    entry.drainScheduled = false
    if (entry.disposed) return
    const pending = entry.pending.splice(0)
    entry.pendingScopes.clear()
    for (const queued of pending) {
      try {
        entry.fanout.publish(queued)
      } catch (error) {
        // Channel aggregates synchronous listener failures; transport fanout remains report-only.
        reportCoordinationError(entry, error)
      }
    }
  }
  if (typeof queueMicrotask === 'function') queueMicrotask(drain)
  else void Promise.resolve().then(drain)
}

/** Report transport/listener failures without allowing diagnostics to affect committed writes. */
const reportCoordinationError = (entry: IIndexedDbCoordinationEntry, error: unknown): void => {
  try {
    entry.report(error)
  } catch {
    // A hostile reporter cannot make a transport failure escape the committed operation.
  }
}

/** Enqueue one validated hint, collapsing pending-scope overflow to a global invalidation. */
const enqueueHint = (
  entry: IIndexedDbCoordinationEntry,
  change: IStorageChange,
  exclude?: symbol
): void => {
  const scopeKey = change.scope ?? '*'
  entry.pendingScopes.add(scopeKey)
  if (entry.pendingScopes.size > MAX_PENDING_SCOPES || entry.pending.length >= MAX_PENDING_SCOPES) {
    entry.pending.length = 0
    entry.pendingScopes.clear()
    entry.pending.push({
      change: {
        origin: change.origin,
        sequence: change.sequence,
        channel: 'all',
        kind: 'clear'
      }
    })
  } else entry.pending.push({ change, exclude })
  scheduleDrain(entry)
}

/** Construct the one registry entry and optionally admit one BroadcastChannel transport. */
const createEntry = (
  options: IIndexedDbCoordinationOptions,
  registryKey: string
): IIndexedDbCoordinationEntry => {
  const fanout = createEventChannel<IQueuedIndexedDbHint>({
    dispatchPolicy: EventDispatchPolicy.queued,
    report: ({ error }) => {
      try {
        options.report(error)
      } catch {
        // A hostile reporter cannot make fanout failure escape coordination.
      }
    }
  })
  const entry = {
    registryKey,
    fanout,
    memberCount: 0,
    seenOrigins: new Map<string, number>(),
    pending: [],
    pendingScopes: new Set<string>(),
    channel: undefined,
    onMessage: (_event: MessageEvent<unknown>) => undefined,
    report: options.report,
    drainScheduled: false,
    disposed: false
  } as IIndexedDbCoordinationEntry
  entry.onMessage = (event) => {
    if (entry.disposed) return
    const decoded = decodeWireHint(event.data, options.ownOrigin, options.report)
    if (decoded === undefined || !rememberHint(entry, decoded)) return
    enqueueHint(entry, decoded)
  }
  if (options.factory === options.realmDefaultFactory && options.broadcastChannel !== undefined) {
    try {
      const channelName = `storage-web:${hashChannelIdentity(`${options.dbName}\u0000${options.layoutFingerprint}`)}`
      const channel = new options.broadcastChannel(channelName)
      if (typeof channel.addEventListener === 'function')
        channel.addEventListener('message', entry.onMessage)
      else channel.onmessage = entry.onMessage
      entry.channel = channel
    } catch (error) {
      options.report(error)
    }
  }
  return entry
}

/** Acquire one exact store member from the realm-local coordination registry. */
export const acquireIndexedDbCoordination = (
  options: IIndexedDbCoordinationOptions
): {
  readonly admitted: boolean
  readonly publish: (change: IStorageChange) => void
  readonly dispose: () => void
} => {
  const factoryObject = options.factory as unknown as object
  let registry = factoryRegistries.get(factoryObject)
  if (registry === undefined) {
    registry = new Map()
    factoryRegistries.set(factoryObject, registry)
  }
  factoryTokenOf(options.factory)
  const registryKey = `${options.dbName}\u0000${options.layoutFingerprint}`
  let entry = registry.get(registryKey)
  if (entry === undefined) {
    entry = createEntry(options, registryKey)
    registry.set(registryKey, entry)
  }
  const memberId = Symbol('indexed-db-coordination-member')
  /** Exact event-subscriber handle retained by this coordination member until its own disposal. */
  const subscription = entry.fanout.subscribe((event) => {
    const queued = event.value
    if (queued.exclude === memberId) return
    options.onChange(queued.change)
  })
  entry.memberCount += 1
  let released = false
  return {
    admitted: entry.channel !== undefined && options.factory === options.realmDefaultFactory,
    publish: (change) => {
      if (released || entry!.disposed || !rememberHint(entry!, change)) return
      enqueueHint(entry!, change, memberId)
      const wire = encodeWireHint(change, options.report)
      if (wire === undefined || entry!.channel === undefined) return
      try {
        entry!.channel.postMessage(wire)
      } catch (error) {
        options.report(error)
      }
    },
    dispose: () => {
      if (released) return
      released = true
      subscription()
      entry!.memberCount -= 1
      if (entry!.memberCount > 0) return
      entry!.disposed = true
      entry!.pending.length = 0
      entry!.pendingScopes.clear()
      entry!.fanout.clear()
      if (entry!.channel !== undefined) {
        try {
          if (typeof entry!.channel.removeEventListener === 'function')
            entry!.channel.removeEventListener('message', entry!.onMessage)
          else entry!.channel.onmessage = null
          entry!.channel.close()
        } catch (error) {
          options.report(error)
        }
      }
      registry!.delete(entry!.registryKey)
    }
  }
}
