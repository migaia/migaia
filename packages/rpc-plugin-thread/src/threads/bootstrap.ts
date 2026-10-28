/**
 * Encodes and admits bounded native Worker bootstrap identity and optional business initialization.
 * Trusted launch relationship facts are handed to Session attachment separately from payload data.
 */
import { normalizeRpcGeneration, RpcWireLimit } from '@migaia/rpc-contract/protocol'
import { normalizeRpcPortable, type IRpcPortableValue } from '@migaia/rpc-contract/portable'
import type { IRpcLocalSourceFacts } from '@migaia/rpc-contract/interfaces'
import { ThreadBootstrap } from './constants.ts'
import { invalidThreadConfig } from './error.ts'
import { ThreadErrorText } from './error-text.ts'
import type { IThreadLaunchFacts } from './types.ts'

/** Business initialization stays separate from trusted native launch relationship facts. */
export type IThreadBootstrapData = Readonly<{ peerId: string; data?: IRpcPortableValue }>
/** A real native parentPort/Worker initial capture supplies these facts to Session.attach. */
export type IThreadBootstrap = IThreadBootstrapData & Readonly<{ source?: IRpcLocalSourceFacts }>

/** Retain the bounded closed native identity grammar without an RPC capability offer. */
function identity(value: unknown, child = false): NonNullable<IRpcLocalSourceFacts['self']> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
  /** Native structured clone supplies plain own fields. */
  const record = value as Record<string, unknown>
  if (
    Object.keys(record).length !== (record.name === undefined ? 1 : 2) ||
    ((!child || record.name !== undefined) &&
      (typeof record.name !== 'string' ||
        !record.name ||
        record.name.length > RpcWireLimit.maxIdentifierChars)) ||
    typeof record.instanceId !== 'string' ||
    !record.instanceId ||
    record.instanceId.length > RpcWireLimit.maxIdentifierChars
  )
    return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
  return Object.freeze({
    ...(record.name === undefined ? {} : { name: record.name as string }),
    instanceId: record.instanceId
  })
}

/** Build native initialization; protocol handshake and extension selection occur in Session. */
export function createThreadBootstrap(
  _name: string,
  peerId: string,
  data: unknown,
  facts?: IThreadLaunchFacts
): unknown {
  return {
    kind: ThreadBootstrap.data,
    peerId,
    ...(data === undefined ? {} : { data }),
    ...(facts
      ? {
          source: {
            self: {
              ...(facts.childName === undefined ? {} : { name: facts.childName }),
              instanceId: peerId
            },
            parent: facts.parent,
            generation: facts.generation
          }
        }
      : {})
  }
}

/** Admit native initialization once; application frames cannot enter this acquisition path. */
export function readThreadInitial(value: unknown): IThreadBootstrap {
  if (
    !value ||
    typeof value !== 'object' ||
    !('kind' in value) ||
    value.kind !== ThreadBootstrap.data ||
    !('peerId' in value) ||
    typeof value.peerId !== 'string' ||
    !value.peerId
  )
    return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
  /** Portable data precedes native relationship metadata, preserving original failure order. */
  const data =
    'data' in value && value.data !== undefined ? normalizeRpcPortable(value.data) : undefined
  /** Low-level manually constructed launchers carry data without automatic host identity. */
  let source: IRpcLocalSourceFacts | undefined
  if ('source' in value && value.source !== undefined) {
    if (!value.source || typeof value.source !== 'object' || Array.isArray(value.source))
      return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
    /** Native source fields are closed; capability or token fields confer no authority. */
    const record = value.source as Record<string, unknown>
    if (Object.keys(record).length !== 3)
      return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
    /** Child identity must agree with the launcher's native route fingerprint. */
    const self = identity(record.self, true)
    if (self.instanceId !== value.peerId)
      return invalidThreadConfig('bootstrap', ThreadErrorText.bootstrapFailed)
    source = Object.freeze({
      self,
      expectedPeerId: identity(record.parent).instanceId,
      generation: normalizeRpcGeneration(record.generation)
    })
  }
  return Object.freeze({
    peerId: value.peerId,
    ...(data === undefined ? {} : { data }),
    ...(source ? { source } : {})
  })
}

/** Low-level consumers receive business data without private parent relationship metadata. */
export function readThreadBootstrap(value: unknown): IThreadBootstrapData {
  /** One native admission owns both business data and source facts. */
  const initial = readThreadInitial(value)
  return Object.freeze({
    peerId: initial.peerId,
    ...(initial.data === undefined ? {} : { data: initial.data })
  })
}
