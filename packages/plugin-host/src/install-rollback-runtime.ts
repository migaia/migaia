/**
 * Owns sequential late rollback and immutable completion detail for synchronous installation
 * failure.
 */
import { reverseItems, appendCleanupErrors } from './cleanup-runtime.ts'
import type { PluginHostRemovalRuntime } from './removal-runtime.ts'
import type { IRegistration } from './registry.ts'
import type { IPluginInstallFailureDetail } from './host-options-types.ts'

/** The install owner retains its established diagnostic text and failure policy. */
type IInstallRollbackReporter = Readonly<{
  reportRollbackFailure(name: string, errors: readonly unknown[]): void
}>

/** Keeps the original Promise-chain sequencing while collecting each cleanup error only once. */
export class PluginHostSyncRollbackRuntime<TDomainCore extends object, TValue> {
  /** Installed prefix is already synchronously detached before physical cleanup starts. */
  readonly #installed: readonly IRegistration<TDomainCore, TValue>[]
  /** Removal owns all actual resource cleanup and native failure identities. */
  readonly #removal: PluginHostRemovalRuntime<TDomainCore, TValue>
  /** Installation owns rollback diagnostics and their original report timing. */
  readonly #reporter: IInstallRollbackReporter
  /** Failed plugin identifies the same immutable public failure detail. */
  readonly #failedName: string
  /** Errors visible at synchronous rejection never change after publication. */
  readonly #publishedErrors: readonly unknown[]

  /** Captures the detached prefix and original immutable error snapshot. */
  constructor(
    installed: readonly IRegistration<TDomainCore, TValue>[],
    removal: PluginHostRemovalRuntime<TDomainCore, TValue>,
    reporter: IInstallRollbackReporter,
    failedName: string,
    publishedErrors: readonly unknown[]
  ) {
    this.#installed = installed
    this.#removal = removal
    this.#reporter = reporter
    this.#failedName = failedName
    this.#publishedErrors = publishedErrors
  }

  /** Starts the same reverse sequential .then chain and freezes its final completion detail. */
  complete(): Promise<Readonly<Omit<IPluginInstallFailureDetail, 'completion'>>> {
    /** Each step appends to one accumulator instead of repeatedly copying its growing prefix. */
    let rollback: Promise<unknown[]> = Promise.resolve([])
    for (const registration of reverseItems(this.#installed)) {
      /** One step owns the exact generation and diagnostic authority needed by its callback. */
      const step = new PluginHostRollbackStep(
        registration,
        this.#removal,
        this.#reporter,
        this.#failedName
      )
      rollback = rollback.then((errors) => step.disposeInto(errors))
    }
    return rollback.then(
      (errors) => this.#detail(errors),
      (error) => this.#failed(error)
    )
  }

  /** A completion failure is secondary and receives the same single diagnostic before publication. */
  #failed(error: unknown): Readonly<Omit<IPluginInstallFailureDetail, 'completion'>> {
    this.#reporter.reportRollbackFailure(this.#failedName, [error])
    return this.#detail([error])
  }

  /** Publishes final ordered errors without mutating the already-returned synchronous detail. */
  #detail(
    lateErrors: readonly unknown[]
  ): Readonly<Omit<IPluginInstallFailureDetail, 'completion'>> {
    return Object.freeze({
      failedName: this.#failedName,
      rollbackErrors: Object.freeze([...this.#publishedErrors, ...lateErrors])
    })
  }
}

/** One rollback step keeps its callback receiver and reports only this generation's cleanup errors. */
class PluginHostRollbackStep<TDomainCore extends object, TValue> {
  /** Exact detached generation released by this step. */
  readonly #registration: IRegistration<TDomainCore, TValue>
  /** Canonical physical cleanup owner. */
  readonly #removal: PluginHostRemovalRuntime<TDomainCore, TValue>
  /** Original installation diagnostic owner. */
  readonly #reporter: IInstallRollbackReporter
  /** Failed plugin name is preserved even while earlier registrations are released. */
  readonly #failedName: string

  /** Captures explicit cleanup state instead of nesting Promise callbacks over the outer loop. */
  constructor(
    registration: IRegistration<TDomainCore, TValue>,
    removal: PluginHostRemovalRuntime<TDomainCore, TValue>,
    reporter: IInstallRollbackReporter,
    failedName: string
  ) {
    this.#registration = registration
    this.#removal = removal
    this.#reporter = reporter
    this.#failedName = failedName
  }

  /** Returns the original disposal continuation and appends failures in reverse-registration order. */
  disposeInto(errors: unknown[]): Promise<unknown[]> {
    return this.#removal.disposeRegistration(this.#registration, true).then(({ cleanupErrors }) => {
      this.#reporter.reportRollbackFailure(this.#failedName, cleanupErrors)
      appendCleanupErrors(errors, cleanupErrors)
      return errors
    })
  }
}
