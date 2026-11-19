import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type {
  IEffectContext,
  IEffectDefinition,
  IEffectEvent,
  IModelHandle,
  IPartRef,
  IResourceHandle
} from './types.ts'

/** Lookup of an effect and its resolved Feature outputs. */
export type IEffectLookup = (
  id: string
) =>
  | { readonly definition: IEffectDefinition; readonly features: Readonly<Record<string, unknown>> }
  | undefined

/** Host services an effect run needs. */
export type IEffectServices = {
  readonly lookup: IEffectLookup
  readonly read: (path: string) => unknown
  readonly write: (path: string, value: unknown) => void
  readonly enqueue: (address: string, event: string, detail: unknown) => void
  readonly report: (error: unknown) => void
  readonly resources: IResourceHandle
  readonly models: IModelHandle
}

/** Effect-side reference to one part address; dispatches through the host queue. */
class PartRef implements IPartRef<string> {
  /** Address of the part. */
  readonly #address: string
  /** Host services. */
  readonly #services: IEffectServices

  /** Binds the reference to an address. */
  constructor(address: string, services: IEffectServices) {
    this.#address = address
    this.#services = services
  }

  /** Queues an event of this address, like `ctx.dispatch(address, …)`. */
  dispatch(event: string, detail: unknown): void {
    this.#services.enqueue(this.#address, event, detail)
  }
}

/**
 * Runs effects one at a time per effect id, in arrival order. A failure is reported once and
 * rejects only that run with EFFECT_FAILED; the queue continues.
 */
export class EffectRunner {
  /** Tail of each effect's queue. */
  readonly #tails = new Map<string, Promise<void>>()
  /** Host services. */
  readonly #services: IEffectServices

  /** Binds the runner to host services. */
  constructor(services: IEffectServices) {
    this.#services = services
  }

  /** Queues one run of an effect and resolves when that run settles. */
  run(handler: string, event: IEffectEvent): Promise<void> {
    /** Previous run of the same effect. */
    const previous = this.#tails.get(handler) ?? Promise.resolve()
    /** This run, started after the previous one settles. */
    const current = previous.then(() => this.#execute(handler, event))
    this.#tails.set(
      handler,
      current.catch(() => undefined)
    )
    return current
  }

  /** Settles when every queued run has settled. */
  async drain(): Promise<void> {
    await Promise.all(this.#tails.values())
  }

  /** Executes one run with its context. */
  async #execute(handler: string, event: IEffectEvent): Promise<void> {
    /** Effect and Feature outputs; a missing handler means nothing to run. */
    const entry = this.#services.lookup(handler)
    if (entry === undefined) return
    /** Context of this run. */
    const context = {
      features: entry.features,
      state: {
        read: (path: string) => this.#services.read(path),
        write: (path: string, value: unknown) => this.#services.write(path, value)
      },
      resources: this.#services.resources,
      models: this.#services.models,
      dispatch: (address: string, name: string, detail: unknown) =>
        this.#services.enqueue(address, name, detail),
      part: (address: string) => new PartRef(address, this.#services)
    } as IEffectContext<Readonly<Record<string, unknown>>>
    try {
      await entry.definition.run(event, context)
    } catch (cause) {
      /** Wrapper keeping the original failure on cause. */
      const failure = createPartHostError(
        PartHostErrorCode.effectFailed,
        PartHostErrorText.effectFailed(handler),
        cause
      )
      this.#services.report(failure)
      throw failure
    }
  }
}
