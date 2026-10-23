import { RpcError, createRpcError, isLocalRpcError, localRpcErrorCode } from '../../core/errors.js'
import { RpcWireLimit } from '@migaia/rpc-contract'
import {
  checkRuntimeDescription,
  type IRuntimePeerIdentity,
  type IRuntimeMethodDescription,
  type IRuntimePeerDescription,
  type IRuntimeDirectoryDiff
} from '@migaia/rpc-contract/runtime'
import type { IRpcShapeCheck } from '@migaia/rpc-contract/remote'
import type { IRuntimeMethodEntry } from './catalog.js'
import { RpcCoreErrorCode } from '../../core/index.js'
import {
  RuntimeApiErrorText,
  RuntimeApiMode,
  RuntimeApiModeSource,
  RuntimeReportKind
} from './constants.js'

/** Existing runtime owners consume the canonical wire shapes through their original internal module. */
export type {
  IRuntimePeerIdentity,
  IRuntimeMethodDescription,
  IRuntimePeerDescription,
  IRuntimeDirectoryDiff
} from '@migaia/rpc-contract/runtime'

/** Project the original compiled routes once for Peer and listener directories before any query. */
export function describeRuntimeMethods(
  methods: readonly IRuntimeMethodEntry[],
  supportsStream: boolean
): readonly IRuntimeMethodDescription[] {
  return methods.flatMap((entry) => {
    /** Automatic namespaces are described from the current accepted physical generation only. */
    if (entry.kind === 'forward' && entry.readDescription) {
      const current = entry.readDescription()
      return current === undefined
        ? []
        : [{ ...current, name: entry.name, forwardedVia: entry.forwardedVia }]
    }
    return [
      {
        name: entry.name,
        supportedModes: entry.supportedModes ?? [
          RuntimeApiMode.request,
          RuntimeApiMode.notify,
          ...(supportsStream ? [RuntimeApiMode.stream] : [])
        ],
        modeSource: entry.supportedModes
          ? RuntimeApiModeSource.declared
          : RuntimeApiModeSource.generatedRoutes,
        ...(entry.declaration ? { idempotent: entry.declaration.idempotent } : {}),
        ...(entry.kind === 'forward' ? { forwardedVia: entry.forwardedVia } : {}),
        ...(entry.declaration?.input === undefined ? {} : { input: entry.declaration.input }),
        ...(entry.declaration?.output === undefined ? {} : { output: entry.declaration.output }),
        ...(entry.declaration?.yield === undefined ? {} : { yield: entry.declaration.yield })
      }
    ]
  })
}

/** Compare actual route sets only at accepted replacement; erased TS signatures cannot participate. */
export function runtimeDirectoryDiff(
  previous: IRuntimePeerDescription,
  current: IRuntimePeerDescription
): IRuntimeDirectoryDiff | undefined {
  /** Both bounded directories have already passed canonical cold description admission. */
  const before = new Map(previous.methods.map((method) => [method.name, method]))
  /** The replacement's method index exists only for this cold comparison, never dispatch. */
  const after = new Map(current.methods.map((method) => [method.name, method]))
  /** Reports contain safe method names, not handlers, payloads or native configuration. */
  const added = [...after.keys()].filter((name) => !before.has(name)).sort()
  /** Removed routes remain an observation; the new accepted whitelist rejects their actual use. */
  const removed = [...before.keys()].filter((name) => !after.has(name)).sort()
  /** Mode order is immaterial: only an actual set difference is an incompatible route change. */
  const modeChanged: IRuntimeDirectoryDiff['modeChanged'][number][] = []
  for (const name of [...after.keys()].sort()) {
    /** Missing old entries are additions rather than changed modes. */
    const old = before.get(name)
    /** This name comes from the admitted replacement index. */
    const next = after.get(name)!
    if (
      old &&
      (old.supportedModes.length !== next.supportedModes.length ||
        old.supportedModes.some((mode) => !next.supportedModes.includes(mode)))
    )
      modeChanged.push(
        Object.freeze({
          name,
          previous: Object.freeze([...old.supportedModes].sort()),
          current: Object.freeze([...next.supportedModes].sort())
        })
      )
  }
  if (!added.length && !removed.length && !modeChanged.length) return undefined
  return Object.freeze({
    type: RuntimeReportKind.contractDiff,
    previous: previous.self,
    current: current.self,
    added: Object.freeze(added),
    removed: Object.freeze(removed),
    modeChanged: Object.freeze(modeChanged)
  })
}

/** Reject a malformed directory without copying untrusted keys or values into public diagnostics. */
function invalid(cause?: unknown): never {
  throw createRpcError(
    RpcCoreErrorCode.contractInvalid,
    RuntimeApiErrorText.descriptionInvalid,
    cause
  )
}

/** The local source-identity boundary retains its original own-data admission and throw timing. */
function localIdentityRecord(
  value: unknown,
  allowed: readonly string[]
): Readonly<Record<string, unknown>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid()
  /** A descriptor snapshot is the only read of the remote object graph at this level. */
  const descriptors = Object.getOwnPropertyDescriptors(value)
  /** Admitted values enter a fresh record, so an unexpected field can never enter the projection. */
  const result: Record<string, unknown> = Object.create(null)
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key)) invalid()
    /** No getter executes during description parsing. */
    const descriptor = descriptors[key]!
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) invalid()
    result[key] = descriptor.value
  }
  return result
}

/** Validate safe identity using the existing protocol identifier budget. */
export function runtimeIdentity(value: unknown): IRuntimePeerIdentity {
  /** Only the two identity fields are accepted on the description wire. */
  const identity = localIdentityRecord(value, ['name', 'instanceId'])
  for (const field of ['name', 'instanceId'] as const) {
    if (
      typeof identity[field] !== 'string' ||
      identity[field].length === 0 ||
      identity[field].length > RpcWireLimit.maxIdentifierChars
    )
      invalid()
  }
  return Object.freeze({ name: identity.name as string, instanceId: identity.instanceId as string })
}

/** Every directory-check reason retains the original core error family, text and original cause. */
export function acceptRuntimeDescription(
  result: IRpcShapeCheck<IRuntimePeerDescription>
): IRuntimePeerDescription {
  if (result.ok) return result.value
  if (
    isLocalRpcError(result.cause, RpcError) &&
    localRpcErrorCode(result.cause) === RpcCoreErrorCode.contractInvalid &&
    result.cause.message === RuntimeApiErrorText.descriptionInvalid
  )
    throw result.cause
  return invalid(result.cause)
}

/**
 * The pure checker reads input once; this boundary only maps its captured diagnostic to the
 * original error.
 */
export function normalizeRuntimeDescription(value: unknown): IRuntimePeerDescription {
  return acceptRuntimeDescription(checkRuntimeDescription(value))
}
