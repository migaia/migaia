/** This independent semantic profile is protected once by the original physical-hop auth owner. */
export const RpcRuntimeProfile = 'migaia.rpc.runtime-api/1'

/** The existing wire route separates stream handlers from scalar handlers in one provider registry. */
export const RpcRuntimeStreamPrefix = 'migaia.remote.runtime.stream.'

/** Closed semantic variants are independent of the legacy RpcEnvelopeKind and physical batch. */
export const RpcRuntimeKind = {
  /** One protected request, notification or stream invocation. */
  call: 'runtime-call',
  /** A shared task containing ordered fail-stop request steps. */
  group: 'runtime-group',
  /** Cancellation, stream or terminal traffic for an existing task. */
  control: 'runtime-control',
  /** Read-only result-store lookup or its correlated result. */
  outcome: 'runtime-outcome'
} as const
export type RpcRuntimeKind = (typeof RpcRuntimeKind)[keyof typeof RpcRuntimeKind]

/** Logical mode survives control/terminal correlation and never follows a function's erased shape. */
export const RpcRuntimeMode = {
  /** One invocation with a terminal business completion. */
  request: 'request',
  /** One dispatched notification without a business response. */
  notify: 'notify',
  /** One credit-driven streaming invocation. */
  stream: 'stream',
  /** One shared task for ordered request steps. */
  group: 'group',
  /** One read-only idempotency outcome query. */
  outcome: 'outcome'
} as const
export type RpcRuntimeMode = keyof typeof RpcRuntimeMode

/** Restart and session counters describe distinct original owners, never a shared attempt number. */
export const RpcRuntimeGenerationKind = {
  /** Counter issued by the provider execution/restart owner. */
  restart: 'restart',
  /** Counter issued by the session owner independently of restarts. */
  session: 'session'
} as const
export type RpcRuntimeGenerationKind = keyof typeof RpcRuntimeGenerationKind

/** Control operations preserve the original task tuple instead of allocating a new business id. */
export const RpcRuntimeOperation = {
  /** Cancellation control under the existing task tuple. */
  cancel: 'cancel',
  /** Stream event control under the existing task tuple. */
  stream: 'stream',
  /** Final business completion for the existing task. */
  terminal: 'terminal',
  /** Read-only lookup of an original idempotency key. */
  lookup: 'lookup',
  /** Response carrying the lookup store fact. */
  result: 'result'
} as const
export type RpcRuntimeOperation = keyof typeof RpcRuntimeOperation

/** Before-start is the only new cancellation mode; ordinary scope cancellation keeps its owner. */
export const RpcRuntimeCancel = 'before-start'

/** A group reports actual step effects and never presents fail-stop execution as a transaction. */
export const RpcRuntimeStepState = {
  /** The step ran and completed successfully. */
  success: 'success',
  /** The step ran and failed, preventing later steps from starting. */
  failure: 'failure',
  /** The step never started after an earlier failure. */
  notExecuted: 'not-executed'
} as const
export type RpcRuntimeStepState = (typeof RpcRuntimeStepState)[keyof typeof RpcRuntimeStepState]

/** Read-only lookup distinguishes store facts from guesses about whether business ran. */
export const RpcRuntimeOutcomeState = {
  /** The store observes work without a sealed result yet. */
  pending: 'pending',
  /** The store has a sealed original completion. */
  done: 'done',
  /** The store cannot establish an outcome; execution is not disproved. */
  unknown: 'unknown'
} as const
export type RpcRuntimeOutcomeState = keyof typeof RpcRuntimeOutcomeState

/** Store continuity is an owner fact, not inferred from a missing or expired key. */
export const RpcRuntimeStoreKind = {
  /** Result facts come from the actual in-memory store. */
  memory: 'memory',
  /** Result facts come from an external store owner. */
  external: 'external',
  /** No usable result-store capability is available. */
  unavailable: 'unavailable'
} as const
export type RpcRuntimeStoreKind = keyof typeof RpcRuntimeStoreKind
/** Only a real store replacement permits the lost-since-restart diagnostic. */
export const RpcRuntimeStoreContinuity = {
  /** The owner confirms its result-store continuity. */
  retained: 'retained',
  /** The owner confirms a store replacement since restart. */
  lost: 'lost-since-restart',
  /** An unavailable store makes no continuity claim. */
  unavailable: 'unavailable'
} as const
export type RpcRuntimeStoreContinuity =
  (typeof RpcRuntimeStoreContinuity)[keyof typeof RpcRuntimeStoreContinuity]

/**
 * This opt-in consumer control drains the original producer to its actual terminal without yielding
 * items.
 */
export const RpcRuntimeFinish = 'finish-without-items'

/** A selector chooses the installed parser; all permission-bearing fields stay inside protection. */
export const RpcRuntimeCarrier = {
  /** Object-carrier parser selector outside protected metadata. */
  kind: 'rpc.runtime-api.v1',
  /** Exact string/byte-carrier prefix selecting the runtime parser. */
  prefix: '\u001erpc-runtime-api-v1:',
  /** Object field retaining the opaque protected frame. */
  frame: 'frame'
} as const

/** Every new grammar property is maintained here; route fields retain their existing contract owner. */
export const RpcRuntimeField = {
  /** Runtime grammar discriminator. */
  profile: 'profile',
  /** Semantic variant discriminator, independent of physical batching. */
  kind: 'kind',
  /** Task correlation identity. */
  id: 'id',
  /** Protected physical-hop routing data. */
  route: 'route',
  /** Admitted logical mode and generation tuple. */
  task: 'task',
  /** Optional normalized business input. */
  payload: 'payload',
  /** Closed optional operation-feature record. */
  options: 'options',
  /** Ordered request steps of a group. */
  steps: 'steps',
  /** Control or outcome operation discriminator. */
  operation: 'operation',
  /** Optional serialized cancellation reason. */
  reason: 'reason',
  /** Closed stream event record. */
  stream: 'stream',
  /** Success result or serialized business failure. */
  completion: 'completion',
  /** Original result-store lookup identity. */
  idempotencyKey: 'idempotencyKey',
  /** Observed step or outcome state. */
  state: 'state',
  /** Actual result-store continuity information. */
  store: 'store',
  /** Sealed original business completion metadata. */
  outcome: 'outcome',
  /** Logical operation mode retained through controls. */
  mode: 'mode',
  /** Original calling execution identity. */
  callerId: 'callerId',
  /** Caller generation selected during admission. */
  callerGeneration: 'callerGeneration',
  /** Provider generation selected during admission. */
  targetGeneration: 'targetGeneration',
  /** Bounded business method identity. */
  method: 'method',
  /** Portable stream item value. */
  value: 'value',
  /** Original generation issuer. */
  providerId: 'providerId',
  /** Optional provider-owned arrival lane. */
  orderKey: 'orderKey',
  /** Optional before-start cancellation intent. */
  cancel: 'cancel',
  /** Optional bounded relative duration, never a local signal. */
  timeoutMs: 'timeoutMs',
  /** Business success/failure discriminator. */
  ok: 'ok',
  /** Optional portable business completion result. */
  result: 'result',
  /** Bounded serialized business failure. */
  error: 'error',
  /** Stream event discriminator. */
  event: 'event',
  /** Nonnegative stream sequence number. */
  seq: 'seq',
  /** Actual result-store epoch. */
  epoch: 'epoch',
  /** Actual retained, lost or unavailable store fact. */
  continuity: 'continuity'
} as const
