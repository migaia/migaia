import { ReduxDevToolsCommand } from './devtools-constants.ts'
import { identifyMiddlewareFailure } from './error-boundary.ts'
import { getDefaultRuntime } from '@migaia/reactive/extension'
import { ReactiveErrorPhase } from '@migaia/reactive'
import type { IDisposer, IRuntime } from '@migaia/reactive'
import type { IMutationGuard } from '@migaia/store-light'
import { createStoreMiddlewareError } from './errors.ts'
import { StoreMiddlewareErrorCode } from './error-code.ts'
import { StoreMiddlewareErrorText } from './error-text.ts'
import {
  MiddlewareCommandType,
  MiddlewareEventPhase,
  MiddlewareEventType
} from './event-constants.ts'

/** Controls strict mutation policy. Defaults to `off` to preserve existing store behavior. */
export type IMutationPolicyMode = 'off' | 'actions-only'

/**
 * Shared synchronous action-depth guard for stores or collections that consult IMutationGuard. It
 * grants write permission during runInAction; it does not batch, roll back or intercept writes by
 * itself, and an asynchronous continuation does not retain the action scope.
 */
export class MutationPolicy implements IMutationGuard {
  #actionDepth = 0
  #mode: IMutationPolicyMode

  /** Select off for unrestricted admission, or actions-only to require a current action scope. */
  constructor(mode: IMutationPolicyMode = 'off') {
    this.#mode = mode
  }

  /** Whether at least one synchronous runInAction call is currently on this policy's stack. */
  get insideAction(): boolean {
    return this.#actionDepth > 0
  }

  /**
   * Check write permission using mutation as the default diagnostic label. In actions-only mode,
   * throws ACTION_SCOPE_REQUIRED outside a scope; this check performs no write itself.
   */
  assertMutationAllowed(operation = 'mutation'): void {
    if (this.#mode === 'actions-only' && this.#actionDepth === 0) {
      throw createStoreMiddlewareError(
        StoreMiddlewareErrorCode.actionScopeRequired,
        StoreMiddlewareErrorText.outsideAction(operation)
      )
    }
  }

  /**
   * Invoke fn in a nestable synchronous scope and return its exact result, restoring depth even on
   * failure. A returned Promise is not awaited and its continuation runs outside this scope.
   * Synchronous failures preserve existing identities or receive CALLBACK_FAILED with their cause.
   */
  runInAction<T>(fn: () => T): T {
    this.#actionDepth++
    try {
      return fn()
    } catch (error) {
      throw identifyMiddlewareFailure(error)
    } finally {
      this.#actionDepth--
    }
  }
}

/** Create an independent MutationPolicy, defaulting to unrestricted off mode. */
export function createMutationPolicy(mode: IMutationPolicyMode = 'off'): MutationPolicy {
  return new MutationPolicy(mode)
}

/** Action notification: start precedes the synchronous callback; end/error records its outcome. */
export type IMiddlewareActionEvent =
  | {
      /** Identifies an action notification rather than a state or error event. */
      readonly type: typeof MiddlewareEventType.action
      /** The synchronous action is about to run; no duration is available yet. */
      readonly phase: typeof MiddlewareEventPhase.start
      /** Caller action label, reused by its corresponding end/error notification. */
      readonly name: string
      /** Wall-clock milliseconds at notification creation. */
      readonly timestamp: number
      /** Optional caller metadata retained by reference, without cloning or runtime freezing. */
      readonly metadata?: Readonly<Record<string, unknown>>
    }
  | {
      /** Identifies an action notification. */
      readonly type: typeof MiddlewareEventType.action
      /** The callback returned, even if that return value is a still-pending Promise. */
      readonly phase: typeof MiddlewareEventPhase.end
      /** Same caller label as the action's start notification. */
      readonly name: string
      /** Wall-clock milliseconds at notification creation. */
      readonly timestamp: number
      /** Elapsed synchronous action time; not the settlement time of a returned Promise. */
      readonly durationMs: number
      /** Optional caller metadata, retained by reference. */
      readonly metadata?: Readonly<Record<string, unknown>>
    }
  | {
      /** Identifies an action notification. */
      readonly type: typeof MiddlewareEventType.action
      /** The synchronous callback threw; asynchronous rejections are not captured here. */
      readonly phase: typeof MiddlewareEventPhase.error
      /** Same caller label as the action's start notification. */
      readonly name: string
      /** Wall-clock milliseconds at notification creation. */
      readonly timestamp: number
      /** Elapsed synchronous time before the failure. */
      readonly durationMs: number
      /** Failure rethrown by the action boundary, retaining its original identity or cause. */
      readonly error: unknown
      /** Optional caller metadata, retained by reference. */
      readonly metadata?: Readonly<Record<string, unknown>>
    }

/** State-change notification; copying previous/next is the producer's responsibility. */
export type IMiddlewareStateEvent<S> = {
  /** Selects the state-change event variant. */
  readonly type: typeof MiddlewareEventType.state
  /** Producer-selected change label, such as the binding's store:update. */
  readonly name: string
  /** Wall-clock milliseconds at notification creation. */
  readonly timestamp: number
  /** Previous value supplied by the producer; not automatically copied by recordState. */
  readonly previous: S
  /** Next value supplied by the producer; not automatically copied by recordState. */
  readonly next: S
  /** Optional producer metadata retained by reference. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Diagnostic event sent through middleware, rather than an instruction to throw. */
export type IMiddlewareErrorEvent = {
  /** Selects the standalone error event variant. */
  readonly type: typeof MiddlewareEventType.error
  /** Producer-selected diagnostic phase, without a fixed literal vocabulary. */
  readonly phase: string
  /** Wall-clock milliseconds at notification creation. */
  readonly timestamp: number
  /** Original reported value; recordError does not clone it. */
  readonly error: unknown
  /** Optional producer metadata retained by reference. */
  readonly metadata?: Readonly<Record<string, unknown>>
}

/** Events accepted by the synchronous Store middleware pipeline. */
export type IMiddlewareEvent<S> =
  | IMiddlewareActionEvent
  | IMiddlewareStateEvent<S>
  | IMiddlewareErrorEvent

/** Normalized DevTools commands; jump/reset require the host's applyState capability. */
export type IDevToolsCommand<S> =
  | {
      /** Apply a selected historical state through runAction. */
      readonly type: typeof MiddlewareCommandType.jump
      /** Parsed or adapter-provided state; no schema validation is implied. */
      readonly state: S
    }
  | {
      /** Apply the adapter's reset state through runAction. */
      readonly type: typeof MiddlewareCommandType.reset
      /** Adapter-provided replacement state, not an implicit initial-state cache. */
      readonly state: S
    }
  | {
      /** Reinitialize the adapter with current host state, without applying a new state. */
      readonly type: typeof MiddlewareCommandType.commit
    }

/** Synchronous DevTools port borrowed by connectDevTools; callback return Promises are not awaited. */
export type IDevToolsAdapter<S> = {
  /** Initialize from current state at installation and again for commit commands. */
  init(state: S): void
  /** Receive an event and current host state at this stage's position in the flat pipeline. */
  send(event: IMiddlewareEvent<S>, state: S): void
  /** Register normalized commands and synchronously return the disposer owned by plugin cleanup. */
  subscribe?(listener: (command: IDevToolsCommand<S>) => void): IDisposer
}

/** Incoming connection message; only recognized DISPATCH payloads are translated. */
export type IReduxDevToolsMessage = {
  /** Messages other than DISPATCH are ignored. */
  readonly type?: string
  /** Optional command envelope; absent or unknown command types are ignored. */
  readonly payload?: {
    /** COMMIT, JUMP_TO_STATE, JUMP_TO_ACTION, ROLLBACK or RESET. */
    readonly type?: string
  }
  /** JSON text required for state commands; COMMIT does not parse or require it. */
  readonly state?: string
}

/** Caller-supplied synchronous extension connection, without ownership of a browser extension. */
export type IReduxDevToolsConnection<S> = {
  /** Initialize or recommit the current state. */
  init(state: S): void
  /** Receive a generated action label/event object and current state. */
  send(action: unknown, state: S): void
  /** Register wire messages and return the exact cleanup function to pass through to consumers. */
  subscribe(listener: (message: IReduxDevToolsMessage) => void): IDisposer
}

/**
 * Adapt a borrowed connection to normalized commands; Runtime defaults to the current default.
 * COMMIT reinitializes, RESET carries reset state, and jump/action/rollback messages become jump.
 * Missing state and unknown messages are ignored. Bad JSON is reported as DEVTOOLS_MESSAGE_INVALID
 * through this Runtime with its SyntaxError preserved; later valid commands remain usable.
 * Connection callbacks and the returned subscription disposer remain synchronous and are not
 * awaited.
 */
export function createReduxDevToolsAdapter<S>(
  connection: IReduxDevToolsConnection<S>,
  runtime: IRuntime = getDefaultRuntime()
): IDevToolsAdapter<S> {
  return {
    init: (state) => connection.init(state),
    send: (event, state) => connection.send({ type: middlewareEventLabel(event), event }, state),
    subscribe(listener) {
      return connection.subscribe((message) => {
        if (message.type !== ReduxDevToolsCommand.dispatch) return
        const type = message.payload?.type
        if (type === ReduxDevToolsCommand.commit) {
          listener({ type: MiddlewareCommandType.commit })
          return
        }
        if (
          type !== ReduxDevToolsCommand.jumpToState &&
          type !== ReduxDevToolsCommand.jumpToAction &&
          type !== ReduxDevToolsCommand.rollback &&
          type !== ReduxDevToolsCommand.reset
        )
          return
        if (message.state === undefined) return
        let state: S
        try {
          state = JSON.parse(message.state) as S
        } catch (error) {
          runtime.reportError(
            identifyMiddlewareFailure(
              error,
              StoreMiddlewareErrorCode.devtoolsMessageInvalid,
              StoreMiddlewareErrorText.devtoolsMessageInvalid
            ),
            { phase: ReactiveErrorPhase.traceListener }
          )
          return
        }
        listener({
          type:
            type === ReduxDevToolsCommand.reset
              ? MiddlewareCommandType.reset
              : MiddlewareCommandType.jump,
          state
        })
      })
    }
  }
}

function middlewareEventLabel<S>(event: IMiddlewareEvent<S>): string {
  if (event.type === MiddlewareEventType.action) return `${event.name}:${event.phase}`
  if (event.type === MiddlewareEventType.state) return event.name
  return `error:${event.phase}`
}
