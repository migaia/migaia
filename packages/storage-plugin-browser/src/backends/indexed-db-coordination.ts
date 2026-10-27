import { acquireIndexedDbLocks } from './indexed-db-locks.js'
import { assertOperationContext, type IStorageChange } from '@migaia/storage-contract'
import {
  createEventChannel,
  EventDispatchPolicy,
  type IEventChannel
} from '@migaia/event-subscriber'
import { isPlainObject } from '@migaia/utils/object'
import { decodeFlatStorageKey, encodeFlatStorageKey } from '@migaia/storage-host/authoring/backend'
import {
  safeJsonPayloadByteLength,
  reportCleanupError
} from '@migaia/storage-host/authoring/backend'
import type { IBackendKeyLockPort } from '@migaia/storage-host/authoring/backend'
import { StorageErrorText } from '../error-text.js'
import { StorageErrorCode, createStorageTypeError } from '../types/errors.js'
/** Versioned metadata-only message shape used by admitted IndexedDB transports. */
type IIndexedDbWireHint = {
  readonly version: 1
  readonly origin: string
  readonly orgId?: string
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

/** One physical database shares logical locks while its existing layouts keep separate transports. */
type IIndexedDbCoordinationGroup = {
  readonly keyPort: IBackendKeyLockPort
  readonly layouts: Map<string, IIndexedDbCoordinationEntry>
}

type IIndexedDbCoordinationOptions = {
  readonly factory: IDBFactory
  readonly realmDefaultFactory: IDBFactory | undefined
  readonly broadcastChannel: typeof BroadcastChannel | undefined
  readonly dbName: string
  readonly layoutFingerprint: string
  readonly ownOrigin: string
  readonly orgId: string
  readonly onChange: (change: IStorageChange) => void
  readonly report: (error: unknown) => void
  readonly createKeyLockPort: () => IBackendKeyLockPort
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
const factoryRegistries = new WeakMap<object, Map<string, IIndexedDbCoordinationGroup>>()

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
  key === 'orgId' ||
  key === 'sequence' ||
  key === 'channel' ||
  key === 'kind' ||
  key === 'scope' ||
  key === 'keys'

type IIndexedDbWireSnapshot = {
  readonly version: unknown
  readonly origin: unknown
  readonly orgId?: unknown
  readonly sequence: unknown
  readonly channel: unknown
  readonly kind: unknown
  readonly scope?: unknown
  readonly keys?: unknown
}

/** Validate one metadata-only message and decode its bounded canonical storage keys. */
const decodeWireHint = (
  value: unknown,
  ownOrigin: string,
  defaultOrgId: string,
  report: (error: unknown) => void
): IStorageChange | undefined => {
  try {
    if (!isPlainObject(value)) return
    const keys = Reflect.ownKeys(value)
    if (!keys.every((key) => typeof key === 'string' && isAllowedWireKey(key))) return
    /** Native structured-clone messages are already detached; decoding remains synchronous. */
    const snapshot = value as IIndexedDbWireSnapshot
    if (safeJsonPayloadByteLength(snapshot) > MAX_HINT_BYTES) return
    const { version, origin, orgId, sequence, channel, kind, scope, keys: encodedKeys } = snapshot
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
    if (orgId !== undefined) assertOperationContext({ orgId: orgId as string })
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
    /** Legacy version-one hints belong to this already-admitted physical database's organization. */
    return {
      origin,
      orgId: orgId === undefined ? defaultOrgId : (orgId as string),
      sequence,
      channel,
      kind,
      scope,
      keys: decodedKeys
    }
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
    ...(change.orgId === undefined ? {} : { orgId: change.orgId }),
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
    ...(change.orgId === undefined ? {} : { orgId: change.orgId }),
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
  reportCleanupError(entry.report, error)
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
        ...(change.orgId === undefined ? {} : { orgId: change.orgId }),
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
      reportCleanupError(options.report, error)
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
    const decoded = decodeWireHint(event.data, options.ownOrigin, options.orgId, options.report)
    if (decoded === undefined || !rememberHint(entry, decoded)) return
    enqueueHint(entry, decoded)
  }
  if (options.factory === options.realmDefaultFactory && options.broadcastChannel !== undefined) {
    try {
      const channelName = `storage-plugin-browser:${hashChannelIdentity(`${options.dbName}\u0000${options.layoutFingerprint}`)}`
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

/** A member borrows one shared physical key port and owns only its native subscription. */
type IIndexedDbCoordinationMember = {
  readonly admitted: boolean
  readonly keyPort: IBackendKeyLockPort
  publish(change: IStorageChange): void
  dispose(): Promise<void>
}

/** Acquire one exact store member from the realm-local coordination registry. */

/** One coordination member owns only its existing registry row, subscription and cleanup result. */
type IIndexedDbCoordinationMemberContext = {
  /** Canonical physical lock borrow released with this member's notification subscription. */
  locks: ReturnType<typeof acquireIndexedDbLocks>
  /** Original options is captured before native construction begins. */
  readonly options: IIndexedDbCoordinationOptions

  /** Original factory identity selects the existing realm-local coordination registry. */
  factoryObject: object

  /** The factory registry retains only live physical database groups. */
  registry: Map<string, IIndexedDbCoordinationGroup> | undefined

  /** Database identity governs locks even when two layouts share only some native stores. */
  /** This original database group shares one canonical key-lock port across layouts. */
  group: IIndexedDbCoordinationGroup | undefined

  /** Notification isolation retains the original layout fingerprint unchanged. */
  /** The original layout fingerprint isolates notification transports. */
  registryKey: string

  /** This same live entry owns native fanout, duplicate observations and transport state. */
  entry: IIndexedDbCoordinationEntry | undefined

  /** Only this member is excluded from its own local transport fanout. */
  memberId: symbol

  /** Exact event-subscriber handle retained by this coordination member until its own disposal. */
  /** The original event-channel disposer releases this exact member subscription. */
  subscription: () => void

  /** Member cleanup seals only this projection before shared ownership can be released. */
  released: boolean

  /** Each member waits for its original cleanup without closing a still-shared physical port. */
  /** Every cleanup caller waits for the original shared-port release result. */
  disposal: Promise<void> | undefined
}
/** Acquire one physical member without adding a second lock or notification lifetime. */
export function acquireIndexedDbCoordination(
  options: IIndexedDbCoordinationOptions
): IIndexedDbCoordinationMember {
  /** Initialize native facts in original construction order before publishing any port. */
  const memberState = { options } as IIndexedDbCoordinationMemberContext

  memberState.locks = acquireIndexedDbLocks(options)

  memberState.factoryObject = memberState.options.factory as unknown as object

  memberState.registry = factoryRegistries.get(memberState.factoryObject)

  if (memberState.registry === undefined) {
    memberState.registry = new Map()
    factoryRegistries.set(memberState.factoryObject, memberState.registry)
  }

  factoryTokenOf(memberState.options.factory)

  /** Database identity governs locks even when two layouts share only some native stores. */
  memberState.group = memberState.registry.get(memberState.options.dbName)

  if (memberState.group === undefined) {
    memberState.group = { keyPort: memberState.locks.keyPort, layouts: new Map() }
    memberState.registry.set(memberState.options.dbName, memberState.group)
  }

  /** Notification isolation retains the original layout fingerprint unchanged. */
  memberState.registryKey = memberState.options.layoutFingerprint

  memberState.entry = memberState.group.layouts.get(memberState.registryKey)

  if (memberState.entry === undefined) {
    memberState.entry = createEntry(memberState.options, memberState.registryKey)
    memberState.group.layouts.set(memberState.registryKey, memberState.entry)
  }

  memberState.memberId = Symbol('indexed-db-coordination-member')

  /** Exact event-subscriber handle retained by this coordination member until its own disposal. */
  memberState.subscription = memberState.entry.fanout.subscribe((event) => {
    const queued = event.value
    if (queued.exclude === memberState.memberId) return
    memberState.options.onChange(queued.change)
  })

  memberState.entry.memberCount += 1

  memberState.released = false
  return createCoordinationMemberMethods(memberState)
}
/** Publish one member over its original shared physical coordination entry. */
function createCoordinationMemberMethods(
  memberState: IIndexedDbCoordinationMemberContext
): IIndexedDbCoordinationMember {
  return {
    keyPort: memberState.group!.keyPort,
    admitted:
      memberState.entry!.channel !== undefined &&
      memberState.options.factory === memberState.options.realmDefaultFactory,
    publish: (change) => coordinationMemberPublish(memberState, change),
    dispose: () => coordinationMemberDispose(memberState)
  }
}

/** Perform publish on this owner's original physical coordination member state. */
function coordinationMemberPublish(
  memberState: IIndexedDbCoordinationMemberContext,
  change: IStorageChange
) {
  if (
    memberState.released ||
    memberState.entry!.disposed ||
    !rememberHint(memberState.entry!, change)
  )
    return
  enqueueHint(memberState.entry!, change, memberState.memberId)
  const wire = encodeWireHint(change, memberState.options.report)
  if (wire === undefined || memberState.entry!.channel === undefined) return
  try {
    memberState.entry!.channel.postMessage(wire)
  } catch (error) {
    memberState.options.report(error)
  }
}
/** Perform dispose on this owner's original physical coordination member state. */
function coordinationMemberDispose(memberState: IIndexedDbCoordinationMemberContext) {
  if (memberState.disposal !== undefined) return memberState.disposal
  memberState.released = true
  memberState.subscription()
  memberState.entry!.memberCount -= 1
  if (memberState.entry!.memberCount > 0)
    return (memberState.disposal = memberState.locks.dispose())
  memberState.entry!.disposed = true
  memberState.entry!.pending.length = 0
  memberState.entry!.pendingScopes.clear()
  memberState.entry!.fanout.clear()
  if (memberState.entry!.channel !== undefined) {
    try {
      if (typeof memberState.entry!.channel.removeEventListener === 'function')
        memberState.entry!.channel.removeEventListener('message', memberState.entry!.onMessage)
      else memberState.entry!.channel.onmessage = null
      memberState.entry!.channel.close()
    } catch (error) {
      memberState.options.report(error)
    }
  }
  memberState.group!.layouts.delete(memberState.entry!.registryKey)
  if (memberState.group!.layouts.size > 0)
    return (memberState.disposal = memberState.locks.dispose())
  memberState.registry!.delete(memberState.options.dbName)
  return (memberState.disposal = memberState.locks.dispose())
}
