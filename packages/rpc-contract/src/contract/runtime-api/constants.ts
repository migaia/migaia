/** This independent semantic profile is protected once by the original physical-hop auth owner. */
export const RpcRuntimeProfile = 'migaia.rpc.runtime-api/1'

/** The existing wire route separates stream handlers from scalar handlers in one provider registry. */
export const RpcRuntimeStreamPrefix = 'migaia.remote.runtime.stream.'

/** Closed semantic variants are independent of the legacy RpcEnvelopeKind and physical batch. */
export const RpcRuntimeKind = {
  call: 'runtime-call',
  group: 'runtime-group',
  control: 'runtime-control',
  outcome: 'runtime-outcome'
} as const
export type RpcRuntimeKind = (typeof RpcRuntimeKind)[keyof typeof RpcRuntimeKind]

/** Logical mode survives control/terminal correlation and never follows a function's erased shape. */
export const RpcRuntimeMode = {
  request: 'request',
  notify: 'notify',
  stream: 'stream',
  group: 'group',
  outcome: 'outcome'
} as const
export type RpcRuntimeMode = keyof typeof RpcRuntimeMode

/** Restart and session counters describe distinct original owners, never a shared attempt number. */
export const RpcRuntimeGenerationKind = { restart: 'restart', session: 'session' } as const
export type RpcRuntimeGenerationKind = keyof typeof RpcRuntimeGenerationKind

/** Control operations preserve the original task tuple instead of allocating a new business id. */
export const RpcRuntimeOperation = {
  cancel: 'cancel',
  stream: 'stream',
  terminal: 'terminal',
  lookup: 'lookup',
  result: 'result'
} as const
export type RpcRuntimeOperation = keyof typeof RpcRuntimeOperation

/** Before-start is the only new cancellation mode; ordinary scope cancellation keeps its owner. */
export const RpcRuntimeCancel = 'before-start'

/** A group reports actual step effects and never presents fail-stop execution as a transaction. */
export const RpcRuntimeStepState = {
  success: 'success',
  failure: 'failure',
  notExecuted: 'not-executed'
} as const
export type RpcRuntimeStepState = (typeof RpcRuntimeStepState)[keyof typeof RpcRuntimeStepState]

/** Read-only lookup distinguishes store facts from guesses about whether business ran. */
export const RpcRuntimeOutcomeState = {
  pending: 'pending',
  done: 'done',
  unknown: 'unknown'
} as const
export type RpcRuntimeOutcomeState = keyof typeof RpcRuntimeOutcomeState

/** Store continuity is an owner fact, not inferred from a missing or expired key. */
export const RpcRuntimeStoreKind = {
  memory: 'memory',
  external: 'external',
  unavailable: 'unavailable'
} as const
export type RpcRuntimeStoreKind = keyof typeof RpcRuntimeStoreKind
/** Only a real store replacement permits the lost-since-restart diagnostic. */
export const RpcRuntimeStoreContinuity = {
  retained: 'retained',
  lost: 'lost-since-restart',
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
  kind: 'rpc.runtime-api.v1',
  prefix: '\u001erpc-runtime-api-v1:',
  frame: 'frame'
} as const

/** Every new grammar property is maintained here; route fields retain their existing contract owner. */
export const RpcRuntimeField = {
  profile: 'profile',
  kind: 'kind',
  id: 'id',
  route: 'route',
  task: 'task',
  payload: 'payload',
  options: 'options',
  steps: 'steps',
  operation: 'operation',
  reason: 'reason',
  stream: 'stream',
  completion: 'completion',
  idempotencyKey: 'idempotencyKey',
  state: 'state',
  store: 'store',
  outcome: 'outcome',
  mode: 'mode',
  callerId: 'callerId',
  callerGeneration: 'callerGeneration',
  targetGeneration: 'targetGeneration',
  method: 'method',
  value: 'value',
  providerId: 'providerId',
  orderKey: 'orderKey',
  cancel: 'cancel',
  timeoutMs: 'timeoutMs',
  ok: 'ok',
  result: 'result',
  error: 'error',
  event: 'event',
  seq: 'seq',
  epoch: 'epoch',
  continuity: 'continuity'
} as const
