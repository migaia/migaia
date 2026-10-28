/**
 * Subscription delivery and selection lifetime; reactive still owns effects, computeds and
 * tracking.
 */
import type { IDisposable, IReactiveComputed } from '@migaia/reactive'
import { ReactiveErrorPhase } from '@migaia/reactive/extension'
import { LifecycleState } from '@migaia/lifecycle'
import type { Resource } from './resource.class.ts'
import type { IResourceContext } from './resource-context.ts'
import type { IResourceState } from './resource-types.ts'
import { ResourceStatus } from './state-constants.ts'
import { ResourceDiagnosticText } from './diagnostic-text.ts'

/** Owns one external listener's effect, untracked delivery and idempotent release. */
export class ResourceSubscription<T> {
  /** Public owner supplies the same tracked state read as the original subscription. */
  #resource: Resource<T>
  /** Explicit state gives terminal and runtime diagnostics without another graph owner. */
  #context: IResourceContext<T>
  /** External listener is called unbound outside reactive tracking. */
  #listener: (state: IResourceState<T>) => void
  /** Effect exists after its synchronous first delivery completes. */
  #effect!: IDisposable
  /** Either caller unsubscribe or Resource disposal may release once. */
  #released = false
  /** Bound unsubscribe retains its public `release` name and marks release before disposal. */
  readonly release = (): void => {
    if (this.#released) return
    this.#released = true
    this.#effect.dispose()
  }

  /** Captures listener ownership without changing its first synchronous delivery. */
  constructor(
    resource: Resource<T>,
    context: IResourceContext<T>,
    listener: (state: IResourceState<T>) => void
  ) {
    this.#resource = resource
    this.#context = context
    this.#listener = listener
  }

  /** Creates the effect before registering its release callback, preserving reentrant order. */
  subscribe(): () => void {
    this.#effect = this.#context.runtime.effect(() => this.#observe(), {
      debugName: this.#resource.debugName
        ? ResourceDiagnosticText.subscribe(this.#resource.debugName)
        : undefined
    })
    this.#context.cleanups.push(this.release)
    return this.release
  }

  /** Tracks the state read, then delivers outside its tracking frame. */
  #observe(): void {
    if (this.#context.terminal.lifecycle !== LifecycleState.open) return
    /** The listener sees the state sampled in this effect run. */
    const state = this.#resource.state
    this.#context.runtime.untracked(() => this.#deliver(state))
  }

  /** Preserves an unbound external-listener receiver and the existing diagnostic phase. */
  #deliver(state: IResourceState<T>): void {
    try {
      // Reflect.apply preserves the original local callback call's undefined receiver.
      Reflect.apply(this.#listener, undefined, [state])
    } catch (error) {
      this.#context.runtime.reportError(error, { phase: ReactiveErrorPhase.subscriptionListener })
    }
  }
}

/** Creates a selected computed and registers its existing disposal ownership. */
export function createResourceSelection<T, R>(
  resource: Resource<T>,
  context: IResourceContext<T>,
  selector: (data: T) => R
): IReactiveComputed<R | undefined> {
  /** Computed retains the original tracked state and selector evaluation rules. */
  const computed = context.runtime.computed(
    () => selectResourceValue(resource, context, selector),
    {
      debugName: resource.debugName ? ResourceDiagnosticText.select(resource.debugName) : undefined
    }
  )
  context.cleanups.push(() => computed.dispose())
  return computed
}

/** Reads the public tracked state and calls a selector only for success. */
function selectResourceValue<T, R>(
  resource: Resource<T>,
  context: IResourceContext<T>,
  selector: (data: T) => R
): R | undefined {
  if (context.terminal.lifecycle !== LifecycleState.open) return undefined
  /** State is tracked by the owning computed before selector evaluation. */
  const state = resource.state
  return state.status === ResourceStatus.success ? selector(state.data) : undefined
}
