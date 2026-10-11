import { createRpcError, RpcCoreErrorCode } from '../errors.js'
import { normalizeRpcEnvelope, RpcEnvelopeKind, type IRpcEnvelope } from '@migaia/rpc-contract'
import type { IRpcPortableValue } from '@migaia/rpc-contract'
import type { IRpcContext } from '../typing.js'
import { readProviderRuntimeOperation } from './provider.js'
import type {
  IRpcRuntimeOptions,
  IRpcRuntimeStep,
  IRpcRuntimeGeneration,
  IRpcRuntimeStepOutcome,
  IRpcRuntimeOutcomeResult
} from '@migaia/rpc-contract/runtime'
import type { IRpcRuntimeEnvelope } from '@migaia/rpc-contract'
import { normalizeRuntimeEnvelope } from '@migaia/rpc-contract/runtime'
import {
  createRuntimeCallEnvelope,
  normalizeRuntimeSteps,
  type IRpcRuntimeCallHeader
} from '@migaia/rpc-contract/runtime/metadata'
import { RpcRuntimeProfile, RpcRuntimeKind, RpcRuntimeMode } from '@migaia/rpc-contract/framing/v1'
import { normalizePortable } from '@migaia/rpc-contract'
import {
  captureOwnedJson,
  readOwnedJsonSnapshot,
  prepareOwnedJsonSnapshot
} from './outbound-owned-codec.js'
import { isInboundNormalizedPayload } from './inbound-normalization.js'

import { RpcCoreErrorText } from '../error-text.js'
import type { RpcOutboundAttachment, IRpcRuntimeSendOptions } from './outbound-attachment.js'

/**
 * Private options provenance is minted only by the compiled forwarding provider, never a public
 * flag.
 */
const forwardedPayloads = new WeakMap<object, unknown>()
/** Only exact package-minted options retain their admitted route, independently of payload proof. */
const forwardedRoute = new WeakMap<object, readonly string[]>()

/** Carry the already admitted input through the existing Peer, generation and core send owners. */
export function createForwardOptions(
  context: IRpcContext,
  route?: readonly string[]
): IRpcRuntimeOptions &
  Readonly<{
    signal: IRpcContext['signal']
    timeoutMs?: number
  }> {
  /** Opt-in relays preserve the final provider's selected semantics; ordinary metadata stays absent. */
  const runtime = readProviderRuntimeOperation(context)
  const options = {
    ...(runtime && 'options' in runtime ? runtime.options : {}),
    signal: context.signal,
    ...(context.timeoutMs === undefined ? {} : { timeoutMs: context.timeoutMs })
  }
  forwardedPayloads.set(options, context.data)
  if (route !== undefined) forwardedRoute.set(options, route)
  return options
}

/** New-profile headers reuse the exact same canonical private route provenance as ordinary forwards. */
export function readForwardRoute(options: unknown): readonly string[] | undefined {
  return typeof options === 'object' && options !== null ? forwardedRoute.get(options) : undefined
}

/** A read-only forwarded query carries only the canonical signed route, with no business payload. */
export function createForwardQueryOptions(route: readonly string[] | undefined): object {
  /** Query provenance belongs to this exact options object without granting payload authority. */
  const options = {}
  if (route !== undefined) forwardedRoute.set(options, route)
  return options
}

/**
 * Identity, rather than a public boolean, identifies the precise input admitted at the previous
 * hop.
 */
export function isForwardedPayload(options: unknown, payload: unknown): boolean {
  if (!isForwardedOperation(options) || forwardedPayloads.get(options as object) !== payload)
    return false
  return (
    payload === null ||
    payload === undefined ||
    typeof payload === 'string' ||
    typeof payload === 'boolean' ||
    (typeof payload === 'number' && Number.isFinite(payload)) ||
    (typeof payload === 'object' && isInboundNormalizedPayload(payload))
  )
}

/** The original retry owner recognizes package-minted forwarding provenance without a public flag. */
export function isForwardedOperation(options: unknown): boolean {
  return typeof options === 'object' && options !== null && forwardedPayloads.has(options)
}

/** Copy only internal provenance through a canonical owner that reconstructs its send options. */
export function retainForwardOptions<T extends object>(source: unknown, target: T): T {
  if (typeof source === 'object' && source !== null && forwardedPayloads.has(source))
    forwardedPayloads.set(target, forwardedPayloads.get(source))
  if (typeof source === 'object' && source !== null && forwardedRoute.has(source))
    forwardedRoute.set(target, forwardedRoute.get(source)!)
  return target
}

/** Private identity proves an owned immutable snapshot without a global per-envelope table. */
class OutboundSnapshot extends class {
  /** Return the original record so private branding preserves identity, prototype and descriptors. */
  constructor(value: object) {
    return value
  }
} {
  /** The exact original admission kind stays on its snapshot and cannot be copied or reflected. */
  #kind: symbol
  /** Logical input grammar depth is private and cannot be copied from reflected properties. */
  #depth: 0 | 2 | undefined

  /** Stamp a newly admitted record once, including records already frozen by the contract owner. */
  constructor(value: object, kind: symbol, depth?: 0 | 2) {
    super(value)
    this.#kind = kind
    this.#depth = depth
  }

  /** Caller freezing, field copies and inbound records cannot mint this private admission kind. */
  static read(value: unknown): symbol | undefined {
    return value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      #kind in value
      ? value.#kind
      : undefined
  }
  /** Read only the exact input owner's original grammar association. */
  static depth(value: object): 0 | 2 | undefined {
    return #depth in value ? value.#depth : undefined
  }
}
/** Distinct private proof kinds cannot be forged by copying fields or freezing caller data. */
const legacySnapshot = Symbol('rpc-legacy-outbound-snapshot')
/** Runtime envelope admission remains separate from a normalized logical input. */
const runtimeSnapshot = Symbol('rpc-runtime-outbound-snapshot')
/** One logical caller admission survives its original retry owner without another portable walk. */
const runtimeInputSnapshot = Symbol('rpc-runtime-input-snapshot')
/** The original request-only group capture survives Remote route admission without another walk. */
const runtimeGroupSnapshot = Symbol('rpc-runtime-group-snapshot')
/** Core-to-Core options retain an exact input without a reflected marker or public skip flag. */
class RuntimeInputOptions extends class {
  /** Stamp the existing options record without changing its prototype or public property shape. */
  constructor(value: object) {
    return value
  }
} {
  /** Only the original Core operation can retain the input owned by its capture/retry path. */
  #input: IRuntimeRequestInput
  constructor(value: object, input: IRuntimeRequestInput) {
    super(value)
    this.#input = input
  }
  /** A spread or foreign options object cannot carry this private association. */
  static read(value: object): IRuntimeRequestInput | undefined {
    return #input in value ? value.#input : undefined
  }
}

/** A logical input belongs to the same proof owner as the final immutable outbound envelope. */
export type IRuntimeRequestInput = Readonly<{
  method: string
  payload?: IRpcPortableValue
}>

/** Reuse only this owner's exact immutable group; frozen caller arrays still receive admission. */
export function createRuntimeGroupSteps(
  steps: readonly IRpcRuntimeStep[]
): readonly IRpcRuntimeStep[] {
  if (OutboundSnapshot.read(steps) === runtimeGroupSnapshot) return steps
  /** Contract admission owns step descriptors, method grammar and every portable payload snapshot. */
  const captured = normalizeRuntimeSteps(steps)
  new OutboundSnapshot(captured, runtimeGroupSnapshot)
  return captured
}

/**
 * Capture the canonical request-only group grammar before either public operation reads routes.
 * Invalid steps retain the original Core configuration error and its exact Contract cause.
 */
export function captureRuntimeGroupSteps(
  steps: readonly IRpcRuntimeStep[]
): readonly IRpcRuntimeStep[] {
  try {
    return createRuntimeGroupSteps(steps)
  } catch (cause) {
    throw createRpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.runtimeGroupStepsInvalid,
      cause
    )
  }
}

/** Send the captured group through the existing native kernel and return its original Promise. */
export function dispatchRuntimeGroup(
  owner: RpcOutboundAttachment,
  peerId: string,
  generation: IRpcRuntimeGeneration,
  steps: readonly IRpcRuntimeStep[],
  options?: IRpcRuntimeSendOptions
): Promise<readonly IRpcRuntimeStepOutcome[]> {
  return owner.sendRuntimeOperation(
    peerId,
    generation,
    RpcRuntimeMode.group,
    { steps },
    options
  ) as Promise<readonly IRpcRuntimeStepOutcome[]>
}

/** Look up the original logical key through the same native outcome mode and settlement owner. */
export function dispatchRuntimeOutcome(
  owner: RpcOutboundAttachment,
  peerId: string,
  generation: IRpcRuntimeGeneration,
  idempotencyKey: string
): Promise<IRpcRuntimeOutcomeResult> {
  return owner.sendRuntimeOperation(peerId, generation, RpcRuntimeMode.outcome, {
    idempotencyKey
  }) as Promise<IRpcRuntimeOutcomeResult>
}

/** Normalize caller data once at canonical admission, keeping omitted payload and sync failures. */
export function createRuntimeRequestInput(
  method: string,
  payload: unknown,
  binary: boolean | (() => never),
  options?: unknown,
  portableDepth: 0 | 2 = 0
): IRuntimeRequestInput {
  const retained = readRuntimeRequestInput(options, method, payload, portableDepth)
  if (retained) return retained
  /** Forwarding already has canonical wire admission; ordinary caller data receives one snapshot. */
  const portable =
    payload === undefined
      ? undefined
      : isForwardedPayload(options, payload)
        ? (payload as IRpcPortableValue)
        : normalizePortable(payload, portableDepth, new Set<object>(), binary)
  const input = { method, ...(portable === undefined ? {} : { payload: portable }) }
  Object.freeze(input)
  new OutboundSnapshot(input, runtimeInputSnapshot, portableDepth)
  return input
}

/** Retain the exact admitted method/payload on the existing reconstructed send options. */
export function retainRuntimeRequestInput<T extends object>(
  options: T,
  input: IRuntimeRequestInput
): T {
  new RuntimeInputOptions(options, input)
  return options
}

/** Read only a genuine immutable input whose method and payload still match this logical send. */
export function readRuntimeRequestInput(
  options: unknown,
  method: string,
  payload: unknown,
  portableDepth: 0 | 2 = 0
): IRuntimeRequestInput | undefined {
  if (typeof options !== 'object' || options === null) return undefined
  const input = RuntimeInputOptions.read(options)
  return input &&
    isRuntimeRequestInput(input) &&
    OutboundSnapshot.depth(input) === portableDepth &&
    input.method === method &&
    input.payload === payload
    ? input
    : undefined
}

/** In-place caller mutation and forged metadata cannot mint this original admission proof. */
export function isRuntimeRequestInput(value: object): value is IRuntimeRequestInput {
  return OutboundSnapshot.read(value) === runtimeInputSnapshot
}

/** Performs original first-user normalization before proving only non-opaque outbound envelopes. */
export function createOutboundEnvelope(value: unknown, options?: unknown): IRpcEnvelope {
  /** Trusted forwarding replaces only the validated payload slot; all header checks still run. */
  if (
    typeof options === 'object' &&
    options !== null &&
    typeof value === 'object' &&
    value !== null &&
    Reflect.get(value, 'kind') === RpcEnvelopeKind.request
  ) {
    const data = Reflect.get(value, 'data') as
      | { route?: unknown; payload?: IRpcPortableValue }
      | undefined
    if (
      data &&
      (isForwardedPayload(options, data.payload) ||
        readRuntimeRequestInput(options, Reflect.get(value, 'method'), data.payload, 2))
    ) {
      const route = readForwardRoute(options)
      const header = normalizeRpcEnvelope({
        ...value,
        data: {
          route: {
            ...(data.route as object),
            ...(route === undefined ? {} : { forwardRoute: route })
          }
        }
      }) as Extract<IRpcEnvelope, { kind: 'request' }>
      const envelope = Object.freeze({
        ...header,
        data: Object.freeze({
          ...header.data,
          ...(data.payload === undefined ? {} : { payload: data.payload })
        })
      })
      new OutboundSnapshot(envelope, legacySnapshot)
      return envelope
    }
  }
  /** The canonical contract owner retains getter order, failure pointers and portable snapshots. */
  const envelope = normalizeRpcEnvelope(value)
  if (envelope.kind !== RpcEnvelopeKind.variation) new OutboundSnapshot(envelope, legacySnapshot)
  return envelope
}

/** Opaque controls, caller objects and inbound values retain full source codec admission. */
export function isOutboundEnvelope(value: unknown): value is IRpcEnvelope {
  return (
    typeof value === 'object' && value !== null && OutboundSnapshot.read(value) === legacySnapshot
  )
}

/** The same canonical proof owner retains an immutable runtime snapshot after full admission. */
export function createRuntimeOutboundEnvelope(value: unknown): IRpcRuntimeEnvelope {
  const envelope = normalizeRuntimeEnvelope(value)
  new OutboundSnapshot(envelope, runtimeSnapshot)
  return envelope
}

/** Header admission remains complete while an exact canonical logical input is reused once. */
export function createRuntimeRequestOutboundEnvelope(
  header: unknown,
  input: IRuntimeRequestInput
): IRpcRuntimeEnvelope {
  /** Only the internal admission owner supplies this input; malformed caller headers still reject. */
  const envelope = normalizeRuntimeEnvelope(header)
  if (envelope.kind !== RpcRuntimeKind.call || envelope.task.method !== input.method)
    return createRuntimeOutboundEnvelope({ ...envelope, payload: input.payload })
  const complete = Object.freeze({
    ...envelope,
    ...(input.payload === undefined ? {} : { payload: input.payload })
  }) as IRpcRuntimeEnvelope
  new OutboundSnapshot(complete, runtimeSnapshot)
  return complete
}

/**
 * Construct the original caller owner's closed header without admitting its own records again.
 * Contract still validates held metadata domains at this point; only an exact private logical input
 * can supply its already-normalized payload without another portable walk.
 */
export function createOwnedRuntimeRequestOutboundEnvelope(
  header: IRpcRuntimeCallHeader,
  input: IRuntimeRequestInput
): IRpcRuntimeEnvelope {
  /** A foreign input cannot turn this typed construction operation into payload admission proof. */
  if (!isRuntimeRequestInput(input) || header.task.method !== input.method)
    return createRuntimeOutboundEnvelope({
      profile: RpcRuntimeProfile,
      kind: RpcRuntimeKind.call,
      ...header,
      ...(input.payload === undefined ? {} : { payload: input.payload })
    })
  /** This constructor snapshots/finalizes metadata while reusing only the original owned payload. */
  const envelope = createRuntimeCallEnvelope(header, input.payload, reuseRuntimeRequestPayload)
  new OutboundSnapshot(envelope, runtimeSnapshot)
  return envelope
}

/**
 * The private logical-input proof above owns portable admission; this operation adds no second
 * walk.
 */
function reuseRuntimeRequestPayload(value: unknown): IRpcPortableValue {
  return value as IRpcPortableValue
}

/** Only package-created runtime snapshots reuse admission; caller freezing and inbound data cannot. */
export function isRuntimeOutboundEnvelope(value: unknown): value is IRpcRuntimeEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    OutboundSnapshot.read(value) === runtimeSnapshot &&
    Reflect.get(value, 'profile') === RpcRuntimeProfile
  )
}

/**
 * Bounds JSON bytes only for the existing immutable portable snapshot proof. Six bytes per UTF-16
 * unit cover JSON escapes; an inconclusive bound falls back to exact physical sizing at the
 * caller.
 */
export function outboundJsonByteUpperBound(value: unknown): number | undefined {
  /** Prepared codec views retain their construction bound without another graph walk. */
  const prepared = readOwnedJsonSnapshot(value)
  if (prepared) return prepared.byteUpperBound
  if (!isOutboundEnvelope(value)) return undefined
  return prepareOwnedJsonSnapshot(value).byteUpperBound
}

/**
 * Copies validated snapshots once, sorting owned JSON output or retaining legacy snapshot key
 * order.
 */
export function materializeOutboundJson(value: unknown, sortKeys = true): unknown {
  return captureOwnedJson(value, sortKeys).value
}
