import { PartHostErrorCode } from './error-code.ts'
import { PartHostErrorText } from './error-text.ts'
import { createPartHostError } from './errors.ts'
import type { ITraceSink } from './trace/sink.ts'
import type {
  IEffectContext,
  IEffectDefinition,
  IEffectEvent,
  IIsolatedEffectContext,
  IIsolatedRunner,
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
  readonly report: (error: unknown, address?: string) => void
  /** Trace sink for effect runs and state writes. */
  readonly trace: ITraceSink
  readonly resources: IResourceHandle
  readonly models: IModelHandle
  /** Id of the loaded blueprint that holds an address (template-row instances included). */
  readonly blueprintOf: (address: string) => string | undefined
  /** Isolated runner currently registered on the `effect` Feature, if any. */
  readonly isolatedRunner: () => IIsolatedRunner | undefined
}

/** Meta key carrying the grants of a restricted or isolated effect, set by the installing plugin. */
export const EFFECT_GRANTS_META = 'part.grants'

/**
 * Grants of a restricted or isolated effect: resource commands as `resourceId:command`, and state
 * path prefixes it may write.
 */
export type IEffectGrants = {
  readonly resources?: readonly string[]
  readonly state?: readonly string[]
}

/** Writes state for an effect run, recording a `state-write` trace event under the run's address. */
function tracedWrite(
  services: IEffectServices,
  address: string,
  path: string,
  value: unknown
): void {
  services.write(path, value)
  if (services.trace.enabled)
    services.trace.event({
      address,
      kind: 'state-write',
      name: path,
      detail: value,
      at: Date.now()
    })
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

/** Fixed operation descriptions used in EFFECT_FORBIDDEN messages. */
const ForbiddenOperation = {
  run: (resource: string, command: string): string => `run ${resource}:${command}`,
  write: (path: string): string => `write state ${path}`,
  dispatch: (address: string): string => `reach address ${address} in another blueprint`
} as const

/**
 * Operations of one restricted or isolated run, checked against its grants. Every refusal throws
 * (or rejects) EFFECT_FORBIDDEN and is reported once through the host's diagnostics.
 */
class GrantedOperations {
  /** Effect id, for error messages. */
  readonly #effect: string
  /** Blueprint of the triggering address; dispatch targets must stay inside it. */
  readonly #blueprint: string | undefined
  /** Triggering address, for trace records. */
  readonly #address: string
  /** Allowed `resource:command` pairs. */
  readonly #commands: ReadonlySet<string>
  /** Allowed state path prefixes. */
  readonly #prefixes: readonly string[]
  /** Host services. */
  readonly #services: IEffectServices

  /** Captures the grants of one run. */
  constructor(
    effect: string,
    event: IEffectEvent,
    grants: IEffectGrants,
    services: IEffectServices
  ) {
    this.#effect = effect
    this.#blueprint = services.blueprintOf(event.address)
    this.#address = event.address
    this.#commands = new Set(grants.resources ?? [])
    this.#prefixes = grants.state ?? []
    this.#services = services
  }

  /** EFFECT_FORBIDDEN for one operation, reported once. */
  #forbidden(operation: string): Error {
    /** Refusal error. */
    const error = createPartHostError(
      PartHostErrorCode.effectForbidden,
      PartHostErrorText.effectForbidden(this.#effect, operation)
    )
    this.#services.report(error)
    return error
  }

  /** Runs a granted resource command; others reject with EFFECT_FORBIDDEN. */
  run(resource: string, command: string, args: unknown): Promise<unknown> {
    if (!this.#commands.has(`${resource}:${command}`))
      return Promise.reject(this.#forbidden(ForbiddenOperation.run(resource, command)))
    return this.#services.resources.run(resource as never, command as never, args as never)
  }

  /** Reads state; reads are not restricted. */
  read(path: string): unknown {
    return this.#services.read(path)
  }

  /** Writes state under a granted prefix; others throw EFFECT_FORBIDDEN. */
  write(path: string, value: unknown): void {
    if (!this.#prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}.`)))
      throw this.#forbidden(ForbiddenOperation.write(path))
    tracedWrite(this.#services, this.#address, path, value)
  }

  /** Throws EFFECT_FORBIDDEN when an address lies outside the triggering blueprint. */
  #assertSameBlueprint(address: string): void {
    if (this.#services.blueprintOf(address) !== this.#blueprint)
      throw this.#forbidden(ForbiddenOperation.dispatch(address))
  }

  /** Queues an event inside the same blueprint. */
  dispatch(address: string, event: string, detail: unknown): void {
    this.#assertSameBlueprint(address)
    this.#services.enqueue(address, event, detail)
  }

  /** Part reference inside the same blueprint. */
  part(address: string): IPartRef<string> {
    this.#assertSameBlueprint(address)
    return new PartRef(address, this.#services)
  }
}

/** Grants read from a definition's meta; malformed or absent grants grant nothing. */
function grantsOf(definition: IEffectDefinition): IEffectGrants {
  /** Raw meta value. */
  const raw = definition.descriptor.meta?.[EFFECT_GRANTS_META]
  return typeof raw === 'object' && raw !== null ? (raw as IEffectGrants) : {}
}

/**
 * Context of an isolated run: only structured-clone friendly operations, so a runner can forward
 * each call over rpc. `part()` is absent because a part reference carries methods.
 */
function isolatedContext(operations: GrantedOperations): IIsolatedEffectContext {
  return {
    resources: { run: (resource, command, args) => operations.run(resource, command, args) },
    state: {
      read: (path) => operations.read(path),
      write: (path, value) => operations.write(path, value)
    },
    dispatch: (address, event, detail) => operations.dispatch(address, event, detail)
  }
}

/**
 * Context of a restricted run: the isolated operations plus `part()`; `features` and `models` are
 * empty whatever the effect declared in `deps`.
 */
function restrictedContext(
  operations: GrantedOperations
): IEffectContext<Readonly<Record<string, unknown>>> {
  return {
    ...isolatedContext(operations),
    features: {},
    models: {},
    part: (address: string) => operations.part(address)
  } as unknown as IEffectContext<Readonly<Record<string, unknown>>>
}

/**
 * Runs effects one at a time per effect id, in arrival order. A failure is reported once and
 * rejects only that run with EFFECT_FAILED; the queue continues. The effect's `tier` decides the
 * context: `page` gets the full context, `restricted` a grant-checked one, `isolated` is handed to
 * the registered isolated runner.
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

  /** Full context of a `page` effect triggered at `address`. */
  #pageContext(
    features: Readonly<Record<string, unknown>>,
    address: string
  ): IEffectContext<Readonly<Record<string, unknown>>> {
    return {
      features,
      state: {
        read: (path: string) => this.#services.read(path),
        write: (path: string, value: unknown) => tracedWrite(this.#services, address, path, value)
      },
      resources: this.#services.resources,
      models: this.#services.models,
      dispatch: (address: string, name: string, detail: unknown) =>
        this.#services.enqueue(address, name, detail),
      part: (address: string) => new PartRef(address, this.#services)
    } as IEffectContext<Readonly<Record<string, unknown>>>
  }

  /** Starts the run body for the effect's tier. */
  #start(
    handler: string,
    event: IEffectEvent,
    entry: NonNullable<ReturnType<IEffectLookup>>
  ): unknown {
    /** Declared tier; `page` when absent. */
    const tier = entry.definition.descriptor.tier ?? 'page'
    if (tier === 'page')
      return entry.definition.run(event, this.#pageContext(entry.features, event.address))
    /** Grant-checked operations of this run. */
    const operations = new GrantedOperations(
      handler,
      event,
      grantsOf(entry.definition),
      this.#services
    )
    if (tier === 'restricted') return entry.definition.run(event, restrictedContext(operations))
    return (this.#services.isolatedRunner() as IIsolatedRunner)(
      handler,
      event,
      isolatedContext(operations)
    )
  }

  /** Refuses an isolated effect when no runner is registered; reported once, not wrapped. */
  #assertRunnable(handler: string, entry: NonNullable<ReturnType<IEffectLookup>>): void {
    if (
      entry.definition.descriptor.tier !== 'isolated' ||
      this.#services.isolatedRunner() !== undefined
    )
      return
    /** Refusal without a runner. */
    const error = createPartHostError(
      PartHostErrorCode.effectIsolationUnavailable,
      PartHostErrorText.effectIsolationUnavailable(handler)
    )
    this.#services.report(error)
    throw error
  }

  /** Executes one run with its context. */
  async #execute(handler: string, event: IEffectEvent): Promise<void> {
    /** Effect and Feature outputs; a missing handler means nothing to run. */
    const entry = this.#services.lookup(handler)
    if (entry === undefined) return
    this.#assertRunnable(handler, entry)
    if (this.#services.trace.enabled)
      this.#services.trace.event({
        address: event.address,
        kind: 'effect',
        name: handler,
        detail: event.detail,
        at: Date.now()
      })
    try {
      await this.#start(handler, event, entry)
    } catch (cause) {
      /** Wrapper keeping the original failure on cause. */
      const failure = createPartHostError(
        PartHostErrorCode.effectFailed,
        PartHostErrorText.effectFailed(handler),
        cause
      )
      this.#services.report(failure, event.address)
      throw failure
    }
  }
}
