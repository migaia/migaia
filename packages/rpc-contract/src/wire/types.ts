/**
 * Declares the sole semantic protocol, flat wire-error graph, and portable metadata shapes. Mutable
 * sessions, pending calls, feature instances, codecs, and carrier state are not defined here.
 */
import type {
  IRpcPortableValue,
  IRpcWirePortableValue,
  IRpcErrorWireMetadata
} from '../contract/types.js'
import type { IRpcMethodSchema } from './method-schema.js'
import type { RpcStreamEvent } from './stream-constants.js'

import type {
  RpcCallMode,
  RpcWireProfile,
  RpcWireKind,
  RpcWireControlOperation
} from './constants.js'
export type { IRpcPortableValue, IRpcWirePortableValue, IRpcMethodSchema }
/** One caller-supplied pure value projection replaces binary tags without a second payload walk. */
export type IRpcPortableProjector = (
  value: unknown,
  metadata?: IRpcErrorWireMetadata,
  /** A binary projector enforces this original semantic limit during its existing value walk. */
  maxBytes?: number
) => IRpcPortableValue

/** Generation ownership and identity retain the established runtime admission fields. */
export type IRpcGeneration = Readonly<{
  kind: 'restart' | 'session'
  value: number
  providerId: string
}>
/** A control/terminal echoes the selected task, never substitutes a new provider generation. */
export type IRpcTask = Readonly<{
  mode: keyof typeof RpcCallMode
  callerId: string
  callerGeneration: IRpcGeneration
  targetGeneration: IRpcGeneration
  method?: string
}>
/** RemainingMs is relative and every forwarding hop may only reduce it. */
export type IRpcRoute = Readonly<{
  applicationVersion: string
  senderId: string
  receiverId: string
  targetId: string
  sentAt: number
  forwardRoute?: readonly string[]
  /** Explicit printable caller correlation, preserved only through this operation/transparent hop. */
  trace?: string
  remainingMs?: number
}>
/** Local timeout/retry feature instances and signals never enter this closed wire record. */
export type IRpcCallOptions = Readonly<{
  orderKey?: string
  cancel?: 'before-start'
  idempotencyKey?: string
}>
/** Node indexes preserve shared/cyclic received topology without recursively nesting errors. */
export type IRpcWireErrorNode = Readonly<{
  source: string
  code: string
  name: string
  message: string
  stack: string
  cause?: number
  errors?: readonly number[]
  data?: IRpcWirePortableValue
  route?: readonly string[]
  truncated?: true
}>
/** The root may reference any admitted node; references grant no execution authority. */
export type IRpcWireError = Readonly<{ root: number; nodes: readonly IRpcWireErrorNode[] }>
/** Groups retain success, first failure, and the exact not-executed suffix. */
export type IRpcStepOutcome = Readonly<
  | { state: 'success'; result?: IRpcPortableValue }
  | { state: 'failure'; error: IRpcWireError }
  | { state: 'not-executed' }
>
/** One completion is stored by its actual idempotency owner, not inferred from missing lookups. */
export type IRpcCompletion = Readonly<
  | { ok: true; result?: IRpcPortableValue | readonly IRpcStepOutcome[] }
  | {
      ok: false
      error: IRpcWireError
      /** Actual stream cancellation survives retained-outcome cloning without aborting replay. */
      streamTerminal?: typeof RpcStreamEvent.cancelled
    }
>
/** One group step is a request with an optional portable payload. */
export type IRpcStep = Readonly<{ method: string; payload?: IRpcPortableValue }>
/** Method metadata is descriptive and does not execute schema validation. */
export type IRpcMethodDescription = Readonly<{
  name: string
  supportedModes: readonly ('request' | 'notify' | 'stream')[]
  modeSource: 'declared' | 'generated-routes'
  idempotent?: boolean
  forwardedVia?: string
  input?: IRpcMethodSchema
  output?: IRpcMethodSchema
  yield?: IRpcMethodSchema
}>
/** Host-owned method lookup is compiled from this bounded cold directory. */
export type IRpcDirectory = Readonly<{
  schemaVersion: 3
  self: Readonly<{ name: string; instanceId: string; generation: IRpcGeneration }>
  methods: readonly IRpcMethodDescription[]
  nodeId?: string
}>
/** Only a real store owner reports an epoch or continuity after restart. */
export type IRpcOutcomeStore = Readonly<
  | { kind: 'memory' | 'external'; epoch: string; continuity: 'retained' | 'lost-since-restart' }
  | { kind: 'unavailable'; continuity: 'unavailable' }
>
/** A retained older generation outcome cannot settle a new live call. */
export type IRpcOutcome = Readonly<{
  mode: Exclude<IRpcTask['mode'], 'outcome'>
  targetGeneration: IRpcGeneration
  completion: IRpcCompletion
}>
/** Query data excludes transport correlation while retaining the original discriminated store fact. */
export type IRpcOutcomeLookupResult = Readonly<
  | { state: 'pending' | 'unknown'; store: IRpcOutcomeStore }
  | { state: 'done'; store: IRpcOutcomeStore; outcome: IRpcOutcome }
>
/** Stream sequencing/credits belong to StreamChannel; this is just the admitted event shape. */
export type IRpcStreamEvent = Readonly<{
  event: 'open' | 'pull' | 'item' | 'end' | 'fail' | 'cancelled' | 'finish-without-items'
  seq: number
  value?: IRpcPortableValue
  error?: IRpcWireError
  reason?: IRpcWireError
}>
/** Every operational message has one correlation and immutable selected task tuple. */
export type IRpcEnvelopeCommon = Readonly<{
  profile: typeof RpcWireProfile
  id: string
  route: IRpcRoute
  task: IRpcTask
  extensions?: Readonly<Record<string, IRpcPortableValue>>
}>
/** Only this union can reach host provider/call semantics after carrier decoding. */
export type IRpcEnvelope = IRpcEnvelopeCommon &
  Readonly<
    | { kind: typeof RpcWireKind.call; options: IRpcCallOptions; payload?: IRpcPortableValue }
    | { kind: typeof RpcWireKind.group; options: IRpcCallOptions; steps: readonly IRpcStep[] }
    | { kind: typeof RpcWireKind.result; result?: IRpcPortableValue | readonly IRpcStepOutcome[] }
    | { kind: typeof RpcWireKind.error; error: IRpcWireError }
    | { kind: typeof RpcWireKind.cancel; reason?: IRpcWireError }
    | { kind: typeof RpcWireKind.stream; stream: IRpcStreamEvent }
    | { kind: typeof RpcWireKind.outcome; operation: 'lookup'; idempotencyKey: string }
    | ({ kind: typeof RpcWireKind.outcome; operation: 'result' } & IRpcOutcomeLookupResult)
  >
/** Lifecycle controls have ids but do not invent an operational task. */
export type IRpcControlFrame = Readonly<{
  profile: typeof RpcWireProfile
  kind: typeof RpcWireKind.control
  id: string
  route: IRpcRoute
  operation: keyof typeof RpcWireControlOperation
  reason?: IRpcWireError
}>
/** A directory frame replaces descriptive metadata rather than invoking a reserved method. */
export type IRpcDirectoryFrame = Readonly<{
  profile: typeof RpcWireProfile
  kind: typeof RpcWireKind.directory
  id: string
  route: IRpcRoute
  directory: IRpcDirectory
}>
/** One versioned offer includes only actual installed extension handlers. */
export type IRpcHello = Readonly<{
  profile: typeof RpcWireProfile
  kind: typeof RpcWireKind.handshake
  step: 'hello'
  versions: readonly Readonly<{ major: number; minor: number }>[]
  codecs: readonly string[]
  extensions: readonly string[]
  requiredExtensions?: readonly string[]
  peer: IRpcPeerInfo
  directory: IRpcDirectory
  auth?: IRpcPortableValue
}>
/** Selected values are checked against the actual initiating offer. */
export type IRpcAccept = Readonly<{
  profile: typeof RpcWireProfile
  kind: typeof RpcWireKind.handshake
  step: 'accept'
  major: number
  minor: number
  codec: string
  extensions: readonly string[]
  peer: IRpcPeerInfo
  directory: IRpcDirectory
  auth?: IRpcPortableValue
}>
/** Rejection carries the same complete flat error graph as business failures. */
export type IRpcReject = Readonly<{
  profile: typeof RpcWireProfile
  kind: typeof RpcWireKind.handshake
  step: 'reject'
  error: IRpcWireError
}>
/** A negotiated peer waits only for the actual name-arbitration phase's remaining deadline. */
export type IRpcAdmissionPending = Readonly<{
  profile: typeof RpcWireProfile
  kind: typeof RpcWireKind.handshake
  step: 'pending'
  peer: IRpcPeerInfo
  remainingMs: number
  auth?: IRpcPortableValue
}>
/** One handshake grammar is used by every carrier, including JSON bootstrap negotiation. */
export type IRpcHandshake = IRpcHello | IRpcAccept | IRpcReject | IRpcAdmissionPending
/** This is the only semantic decode result; outer chunk/batch frames remain separate. */
export type IRpcSemanticFrame = IRpcHandshake | IRpcEnvelope | IRpcControlFrame | IRpcDirectoryFrame
/** Native binary metadata retains the existing complete backing digest/length shape. */
export type IRpcBinaryManifest = Readonly<{
  profile: 'migaia.rpc.portable-binary/1'
  storage: 'inline' | 'native'
  envelope: IRpcEnvelope
  backings: readonly Readonly<{ byteLength: number; sha256: string }>[]
}>

/** A peer identity used only for diagnostics and connection-owned policy. */
export type IRpcPeerInfo = Readonly<{
  /** Bounded nonempty diagnostic peer identifier; not authentication authority. */
  id: string
  /** Lowercase runtime label; valid custom labels need not be RpcPeerRuntime members. */
  runtime: string
  /** Optional display version, retained only when supplied. */
  runtimeVersion?: string
  /** Optional implementation descriptor for diagnostics, without capability implications. */
  implementation?: Readonly<{
    /** Implementation display label; validation requires a string. */
    name: string
    /** Implementation display version; validation requires a string. */
    version: string
  }>
}>

/** One supported protocol version and its highest minor version. */
export type IRpcHandshakeVersion = Readonly<{
  /** Supported positive major revision; each major appears at most once in an offer. */
  major: number
  /** Highest supported nonnegative minor revision within that major. */
  minor: number
}>
