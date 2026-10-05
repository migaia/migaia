import type { IRpcPortableValue, IRpcSerializedError } from '../types.js'
import type { IRpcStreamPayload } from '../v1/stream.js'
import type { IRpcRouteHeader } from '../v1/route.js'
import type {
  RpcRuntimeGenerationKind,
  RpcRuntimeMode,
  RpcRuntimeStoreContinuity,
  RpcRuntimeStoreKind
} from './constants.js'

/** Generation is issued by the original unit/session owner and bound by the accepted directory. */
export type IRpcRuntimeGeneration = Readonly<{
  kind: RpcRuntimeGenerationKind
  value: number
  providerId: string
}>
/** Every later frame echoes this hop's selected task rather than trusting an application payload. */
export type IRpcRuntimeTask = Readonly<{
  mode: RpcRuntimeMode
  callerId: string
  callerGeneration: IRpcRuntimeGeneration
  targetGeneration: IRpcRuntimeGeneration
  method?: string
}>
/** No public signal or false timeout appears on the protected wire. */
export type IRpcRuntimeOptions = Readonly<{
  orderKey?: string
  cancel?: 'before-start'
  timeoutMs?: number
  idempotencyKey?: string
}>
/** Routing fields preserve their existing identifier/duration/forward-route domains. */
export type IRpcRuntimeRoute = Readonly<
  Pick<
    IRpcRouteHeader,
    'applicationVersion' | 'senderId' | 'targetId' | 'sentAt' | 'forwardRoute'
  > & { receiverId: string }
>
/** All variants carry the same protected profile and exact operation identity. */
export type IRpcRuntimeCommon = Readonly<{
  profile: 'migaia.rpc.runtime-api/1'
  id: string
  route: IRpcRuntimeRoute
  task: IRpcRuntimeTask
}>
/** Completion omits only actual undefined; failures retain the whole existing serialized chain. */
export type IRpcRuntimeCompletion = Readonly<
  { ok: true; result?: IRpcPortableValue } | { ok: false; error: IRpcSerializedError }
>
/** Group members have request semantics and share all task/options fields. */
export type IRpcRuntimeStep = Readonly<{ method: string; payload?: IRpcPortableValue }>
/** Business failure stops later steps without rolling back already completed effects. */
export type IRpcRuntimeStepOutcome = Readonly<
  | { state: 'success'; result?: IRpcPortableValue }
  | { state: 'failure'; error: IRpcSerializedError }
  | { state: 'not-executed' }
>
/** Stream remains the original credit protocol with one additional opt-in finish intent. */
export type IRpcRuntimeStream =
  | (Omit<IRpcStreamPayload, 'event'> &
      Readonly<{ event: Exclude<IRpcStreamPayload['event'], 'cancel'> }>)
  | Readonly<{ event: 'finish-without-items'; seq: number; reason?: IRpcSerializedError }>
/** Unavailable stores never invent an epoch; real stores state their actual continuity. */
export type IRpcRuntimeStore = Readonly<
  | {
      kind: Exclude<RpcRuntimeStoreKind, 'unavailable'>
      epoch: string
      continuity: RpcRuntimeStoreContinuity
    }
  | { kind: 'unavailable'; continuity: 'unavailable' }
>
/** A sealed result may precede the current query's generation; it cannot settle a new business call. */
export type IRpcRuntimeOutcome = Readonly<{
  mode: Exclude<RpcRuntimeMode, 'outcome'>
  targetGeneration: IRpcRuntimeGeneration
  completion: IRpcRuntimeCompletion
}>
/** Public query projects the original store result without exposing claim or execution authority. */
export type IRpcRuntimeOutcomeResult = Readonly<
  | { state: 'pending' | 'unknown'; store: IRpcRuntimeStore }
  | { state: 'done'; store: IRpcRuntimeStore; outcome: IRpcRuntimeOutcome }
>
/** The complete union is validated before any canonical execution or replay owner is touched. */
export type IRpcRuntimeEnvelope = IRpcRuntimeCommon &
  Readonly<
    | { kind: 'runtime-call'; options: IRpcRuntimeOptions; payload?: IRpcPortableValue }
    | { kind: 'runtime-group'; options: IRpcRuntimeOptions; steps: readonly IRpcRuntimeStep[] }
    | { kind: 'runtime-control'; operation: 'cancel'; reason?: IRpcSerializedError }
    | { kind: 'runtime-control'; operation: 'stream'; stream: IRpcRuntimeStream }
    | { kind: 'runtime-control'; operation: 'terminal'; completion: IRpcRuntimeCompletion }
    | { kind: 'runtime-outcome'; operation: 'lookup'; idempotencyKey: string }
    | {
        kind: 'runtime-outcome'
        operation: 'result'
        state: 'pending' | 'unknown'
        store: IRpcRuntimeStore
      }
    | {
        kind: 'runtime-outcome'
        operation: 'result'
        state: 'done'
        store: IRpcRuntimeStore
        outcome: IRpcRuntimeOutcome
      }
  >
