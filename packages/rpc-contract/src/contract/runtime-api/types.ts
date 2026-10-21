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
  /** Restart or session selects the existing counter owner; neither is a retry attempt id. */
  kind: RpcRuntimeGenerationKind
  /** Nonnegative safe-integer generation counter. */
  value: number
  /** Original provider that issued this generation fact. */
  providerId: string
}>
/** Every later frame echoes this hop's selected task rather than trusting an application payload. */
export type IRpcRuntimeTask = Readonly<{
  /** Logical request, notify, stream, group or outcome mode retained across controls. */
  mode: RpcRuntimeMode
  /** Calling execution identity, separate from a route's physical-hop sender. */
  callerId: string
  /** Caller generation selected at task admission. */
  callerGeneration: IRpcRuntimeGeneration
  /** Exact target generation selected from the accepted directory. */
  targetGeneration: IRpcRuntimeGeneration
  /** Required for request/notify/stream calls; other modes use their own closed grammar. */
  method?: string
}>
/** No public signal or false timeout appears on the protected wire. */
export type IRpcRuntimeOptions = Readonly<{
  /** Optional provider-owned arrival-order key; omission requests no ordered lane. */
  orderKey?: string
  /** Optional before-start cancellation mode; omission keeps ordinary cancellation semantics. */
  cancel?: 'before-start'
  /** Optional finite bounded relative duration; local false and AbortSignal never enter the wire. */
  timeoutMs?: number
  /** Optional read-only-outcome/idempotency key, independently capability-gated by the runtime. */
  idempotencyKey?: string
}>
/** Routing fields preserve their existing identifier/duration/forward-route domains. */
export type IRpcRuntimeRoute = Readonly<
  Pick<
    IRpcRouteHeader,
    'applicationVersion' | 'senderId' | 'targetId' | 'sentAt' | 'forwardRoute'
  > & {
    /** Required receiving application identity for this protected runtime hop. */
    receiverId: string
  }
>
/** All variants carry the same protected profile and exact operation identity. */
export type IRpcRuntimeCommon = Readonly<{
  /** Independent runtime-api grammar discriminator. */
  profile: 'migaia.rpc.runtime-api/1'
  /** Operation correlation id, echoed rather than replaced by later controls. */
  id: string
  /** Validated protected hop routing fields. */
  route: IRpcRuntimeRoute
  /** Original admitted task/generation tuple. */
  task: IRpcRuntimeTask
}>
/** Completion omits only actual undefined; failures retain the whole existing serialized chain. */
export type IRpcRuntimeCompletion = Readonly<
  | {
      /** Business completion succeeded. */
      ok: true
      /** Result is omitted only for actual undefined, rather than encoded as a portable value. */
      result?: IRpcPortableValue
    }
  | {
      /** Business completion failed. */
      ok: false
      /** Entire bounded serialized error chain. */
      error: IRpcSerializedError
    }
>
/** Group members have request semantics and share all task/options fields. */
export type IRpcRuntimeStep = Readonly<{
  /** Required request method for this step. */
  method: string
  /** Optional normalized step input; omission means no payload. */
  payload?: IRpcPortableValue
}>
/** Business failure stops later steps without rolling back already completed effects. */
export type IRpcRuntimeStepOutcome = Readonly<
  | {
      /** Step actually completed successfully. */
      state: 'success'
      /** Optional returned portable value; actual undefined is omitted. */
      result?: IRpcPortableValue
    }
  | {
      /** Step actually ran and failed, stopping subsequent steps. */
      state: 'failure'
      /** Original bounded business failure chain. */
      error: IRpcSerializedError
    }
  | {
      /** Earlier failure prevented this step from starting; no rollback is implied. */
      state: 'not-executed'
    }
>
/** Stream remains the original credit protocol with one additional opt-in finish intent. */
export type IRpcRuntimeStream =
  | (Omit<IRpcStreamPayload, 'event'> &
      Readonly<{
        /** Ordinary stream event; runtime cancellation has its own control operation. */
        event: Exclude<IRpcStreamPayload['event'], 'cancel'>
      }>)
  | Readonly<{
      /** Opt-in drain-to-terminal intent without yielding further business items. */
      event: 'finish-without-items'
      /** Current nonnegative stream sequence. */
      seq: number
      /** Optional bounded reason, without local runtime authority. */
      reason?: IRpcSerializedError
    }>
/** Unavailable stores never invent an epoch; real stores state their actual continuity. */
export type IRpcRuntimeStore = Readonly<
  | {
      /** Memory or external identifies the actual result-store owner. */
      kind: Exclude<RpcRuntimeStoreKind, 'unavailable'>
      /** Real store epoch, not inferred from a missing lookup. */
      epoch: string
      /** Retained or lost-since-restart according to actual owner continuity. */
      continuity: RpcRuntimeStoreContinuity
    }
  | {
      /** No usable result-store capability exists. */
      kind: 'unavailable'
      /** Unavailable storage cannot claim retention or loss across restart. */
      continuity: 'unavailable'
    }
>
/** A sealed result may precede the current query's generation; it cannot settle a new business call. */
export type IRpcRuntimeOutcome = Readonly<{
  /** Original business mode, excluding an outcome query about itself. */
  mode: Exclude<RpcRuntimeMode, 'outcome'>
  /** Generation that produced the sealed outcome, possibly older than the current query. */
  targetGeneration: IRpcRuntimeGeneration
  /** Original business result/error; it does not settle a new operation with a different task. */
  completion: IRpcRuntimeCompletion
}>
/** Public query projects the original store result without exposing claim or execution authority. */
export type IRpcRuntimeOutcomeResult = Readonly<
  | {
      /** Pending is observed work; unknown makes no claim about whether business executed. */
      state: 'pending' | 'unknown'
      /** Actual query-store continuity information. */
      store: IRpcRuntimeStore
    }
  | {
      /** Store has a sealed completion for the queried key. */
      state: 'done'
      /** Actual query-store continuity information. */
      store: IRpcRuntimeStore
      /** Sealed original operation outcome. */
      outcome: IRpcRuntimeOutcome
    }
>
/** The complete union is validated before any canonical execution or replay owner is touched. */
export type IRpcRuntimeEnvelope = IRpcRuntimeCommon &
  Readonly<
    | {
        /** Starts one request, notification or stream using the common admitted task. */
        kind: 'runtime-call'
        /** Explicit wire options; an empty record requests no optional operation features. */
        options: IRpcRuntimeOptions
        /** Optional business input, normalized independently of protected metadata. */
        payload?: IRpcPortableValue
      }
    | {
        /** Starts one fail-stop group; completed business effects are not rolled back. */
        kind: 'runtime-group'
        /** Shared options for all request steps in this task. */
        options: IRpcRuntimeOptions
        /** Nonempty request sequence, executed in its declared order by the runtime owner. */
        steps: readonly IRpcRuntimeStep[]
      }
    | {
        /** Carries control for an existing task rather than a new business call. */
        kind: 'runtime-control'
        /** Requests cancellation under that task's negotiated policy. */
        operation: 'cancel'
        /** Optional bounded cancellation error chain. */
        reason?: IRpcSerializedError
      }
    | {
        /** Carries control for an existing task rather than a new business call. */
        kind: 'runtime-control'
        /** Selects the stream credit/event grammar. */
        operation: 'stream'
        /** Normalized stream event; sequencing and credits remain with the stream owner. */
        stream: IRpcRuntimeStream
      }
    | {
        /** Carries control for an existing task rather than a new business call. */
        kind: 'runtime-control'
        /** Seals the correlated task with a business completion. */
        operation: 'terminal'
        /** Portable result or complete bounded serialized failure. */
        completion: IRpcRuntimeCompletion
      }
    | {
        /** Queries an existing result-store fact without acquiring execution authority. */
        kind: 'runtime-outcome'
        /** Selects a read-only idempotency lookup. */
        operation: 'lookup'
        /** Exact original key to inspect; a missing key does not prove nonexecution. */
        idempotencyKey: string
      }
    | {
        /** Returns an observed result-store fact. */
        kind: 'runtime-outcome'
        /** Correlates this reply with an outcome lookup task. */
        operation: 'result'
        /** Pending means observed work; unknown makes no execution claim. */
        state: 'pending' | 'unknown'
        /** Actual storage availability and continuity. */
        store: IRpcRuntimeStore
      }
    | {
        /** Returns an observed result-store fact. */
        kind: 'runtime-outcome'
        /** Correlates this reply with an outcome lookup task. */
        operation: 'result'
        /** A sealed original completion is available. */
        state: 'done'
        /** Actual storage availability and continuity. */
        store: IRpcRuntimeStore
        /** Original task mode, producing generation and completion. */
        outcome: IRpcRuntimeOutcome
      }
  >
