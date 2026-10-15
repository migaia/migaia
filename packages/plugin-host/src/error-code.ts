/**
 * The single declaration site for `@migaia/plugin-host` error codes.
 *
 * See `docs/contracts/error-codes.md`. The pair `(source, code)` uniquely identifies an error.
 * `source` is always `'@migaia/plugin-host'`. Throw sites use these constants instead of inline
 * values. Localized messages live in `error-text.ts` and correspond to code names.
 *
 * Code values are public API. Renaming a code is a breaking change.
 */
export const PluginHostErrorCode = {
  /**
   * Thrown when a mutation or registration targets a host after disposal completes.
   *
   * The terminal state is irreversible. Create a new host instead of reviving this one. Enforces
   * the terminal boundary of the two-phase lifecycle contract.
   */
  hostDisposed: 'HOST_DISPOSED',

  /**
   * Thrown when a mutation targets a closing host after `dispose()` starts but before the terminal
   * state.
   *
   * This differs from `HOST_DISPOSED` so diagnostics distinguish disposal in progress from
   * completed disposal. Retrying later cannot reopen either host.
   */
  hostDisposing: 'HOST_DISPOSING',

  /**
   * Thrown when installing a plugin whose `name` is already occupied.
   *
   * Plugin names are unique host keys. Rename the plugin or `unUse()` the previous plugin first.
   */
  pluginDuplicate: 'PLUGIN_DUPLICATE',

  /**
   * Thrown when `unUse()` or another operation targets an uninstalled plugin name.
   *
   * Check for repeated removal or a misspelled name. Host state stays unchanged.
   */
  pluginNotInstalled: 'PLUGIN_NOT_INSTALLED',

  /**
   * A handle member, or an extension taken from it, is used while that plugin is disabled; also
   * thrown by `activate()` on a disabled lazy plugin. Enforces per-registration liveness (R2); the
   * caller should `enable` the plugin (or its restore token) before retrying.
   */
  pluginDisabled: 'PLUGIN_DISABLED',
  /**
   * A dependent plugin is temporarily suspended because one of its required providers is inactive.
   * The caller must restore or reinstall the provider and wait for automatic resume before
   * retrying. Enforces the R3 suspend dependency policy without treating the registration as
   * removed.
   */
  pluginSuspended: 'PLUGIN_SUSPENDED',
  /**
   * A lazy plugin is accessed synchronously before activation, or a synchronous install needs an
   * inactive lazy provider. Activation is an explicit async step (R9); the caller should `await
   * host.activate(name)` or install through the async `use()` path.
   */
  pluginNotActivated: 'PLUGIN_NOT_ACTIVATED',
  /**
   * `definition.getFeature(name)` or `handle.getFeature(name)` named a Feature the plugin does not
   * declare. Lookups never return `undefined` (R4); the caller has a wrong name or wrong plugin.
   */
  featureNotDeclared: 'FEATURE_NOT_DECLARED',
  /**
   * A required Feature provider was never installed in this host (a removed one reports
   * `PREREQUISITE_REMOVED`). Thrown before any install hook runs (R5); install the provider first
   * or in the same batch.
   */
  prerequisiteMissing: 'PREREQUISITE_MISSING',
  /**
   * Cross-plugin Feature references inside one batch form a cycle. Detected before any install hook
   * runs (R5); the caller must break the cycle in its plugin definitions.
   */
  dependencyCycle: 'DEPENDENCY_CYCLE',
  /**
   * `unUse`/`disable` (or a managed removal) would leave required dependents behind and cascade was
   * not requested. State is unchanged (R6); `detail.blockedBy` lists every transitive dependent in
   * cascade order — pass `cascade: true`, include them, or inspect `dryRun` first.
   */
  dependencyBlocked: 'DEPENDENCY_BLOCKED',
  /**
   * `replace(name, next)` received a candidate whose name differs from `name`. Nothing is installed
   * (R8); the caller passed the wrong definition.
   */
  replaceNameMismatch: 'REPLACE_NAME_MISMATCH',
  /**
   * `replace()` published the new provider, but at least one dependent that had to restart (no
   * `onDependencyReplaced`, or the hook threw) failed to reinstall. The replacement stays
   * committed, the previous provider is disposed, and the failed restart closure stays uninstalled.
   * `cause` is an `AggregateError` whose first entry is the restart failure, followed by the hook
   * and cleanup errors; the caller should reinstall the listed dependents after fixing them.
   */
  dependentRestartFailed: 'DEPENDENT_RESTART_FAILED',
  /**
   * A plugin definition carries a retired or unsupported field (for example `shared`), or its
   * dependency data is structurally invalid, or runtime integration is requested from an object
   * that is not a canonical package-minted core. Definition admission and the D9 integration port
   * reject these inputs; migrate to Feature dependencies or use the original install core.
   */
  pluginDefinitionInvalid: 'PLUGIN_DEFINITION_INVALID',

  /**
   * Thrown when plugin installation or publication fails. Native shared-publication TypeErrors
   * retain their runtime type with this code. The original installation error always remains
   * primary and is reachable by identity through `cause`, as required by the error-code contract
   * §3.2.
   *
   * `detail` retains the failed plugin name and original rollback failures in rollback order. Async
   * `use()` publishes the completed frozen detail directly. Sync `useSync()` publishes a frozen
   * snapshot and exposes the final frozen detail through `detail.completion`. Rollback or cleanup
   * failures use the diagnostic code `PLUGIN_INSTALL_ROLLBACK_FAILED`. They never replace the
   * original construction failure (L-T39 / `docs/lifecycle/migration.sdd.md` §3.7.4 M-T44). Await
   * completion before converting errors that require complete secondary failure identities.
   */
  pluginInstallFailed: 'PLUGIN_INSTALL_FAILED',

  /**
   * A plugin selected for immediate `useSync()` installation declares async setup (R5). The caller
   * must install it through `use()` so setup can settle before features and install run.
   */
  setupRequiresAsyncInstall: 'SETUP_REQUIRES_ASYNC_INSTALL',

  /**
   * Thrown when a cleanup step fails during one plugin's `unUse()` or `beforeRelease()`.
   *
   * Failures are aggregated after unloading finishes. One disposer failure does not stop remaining
   * releases. Treat this as a resource-leak warning, not a signal that host state rolls back.
   */
  pluginDisposeFailed: 'PLUGIN_DISPOSE_FAILED',

  /**
   * Thrown when an extension returned by `install()` conflicts with an existing host property. A
   * shared slot accepts only canonical contributions from registrations in the same family.
   * Ordinary extensions and other families cannot occupy the same key.
   *
   * Ordinary extension properties remain exclusive. Rename the property or use a canonical
   * same-family contribution. Conflict detection happens before mounting, so no partially mounted
   * state is published.
   */
  extensionDuplicate: 'EXTENSION_DUPLICATE',

  /**
   * Thrown when an extension name conflicts with an `Object.prototype` key such as `toString` or
   * `constructor`.
   *
   * Rejecting it before mounting preserves prototype lookup and prevents a prototype-pollution
   * entry point.
   */
  extensionObjectPrototype: 'EXTENSION_OBJECT_PROTOTYPE',

  /**
   * Thrown when an extension uses a reserved host key such as `config`, `onDispose`, or
   * `usePipeline`.
   *
   * Reserved keys belong to the host protocol. Overwriting them would let plugins disrupt each
   * other. Choose another extension name.
   */
  extensionReserved: 'EXTENSION_RESERVED',

  /**
   * A Feature prerequisite exists but its owner is temporarily disabled. The caller may enable that
   * owner and retry the same lookup.
   */
  prerequisiteDisabled: 'PREREQUISITE_DISABLED',

  /**
   * A previously published Feature prerequisite lost its owner through removal. The caller must
   * install a provider again; retrying the unchanged lookup cannot recover it.
   */
  prerequisiteRemoved: 'PREREQUISITE_REMOVED',

  /**
   * Thrown when a plugin context registers an `onDispose()` resource outside installation or after
   * setup ends.
   *
   * Resources belong to the current attempt. Late resources are released before this error is
   * thrown. Register resources during the active setup or installation phase.
   */
  resourceOutsideInstall: 'RESOURCE_OUTSIDE_INSTALL',

  /**
   * Thrown when a plugin lifecycle callback (`setup`, `install`, `dispose`, `update`, or
   * `beforeRelease`) reenters a host mutation API, or an external `config.update()` runs during
   * setup or `beforeRelease`. A synchronous `activate()` reentry rejects before sharing an existing
   * activation. After an await, same-name activation callers share that Promise regardless of
   * origin; callers must avoid awaiting their own activation.
   *
   * Reentrancy makes installation rollback boundaries ambiguous. Move later mutations outside
   * lifecycle callbacks.
   */
  lifecycleMutation: 'LIFECYCLE_MUTATION',

  /**
   * Thrown during host construction for a pipeline mode outside `sync`, `async`, `generator`, or
   * `async-generator`.
   *
   * Configuration validation rejects the input before the host is constructed.
   */
  invalidPipelineMode: 'INVALID_PIPELINE_MODE',

  /**
   * Thrown when a registered stage is incompatible with the host's pipeline mode.
   *
   * For example, a sync host cannot accept a generator stage. Modes define execution and error
   * semantics and cannot be mixed. The message identifies both the host and stage modes.
   */
  pipelineModeMismatch: 'PIPELINE_MODE_MISMATCH',

  /**
   * Thrown when `next()` is called twice within one pipeline step.
   *
   * A step can advance only once. Repeated calls would process the same value downstream more than
   * once. Check stage branches for a missing `return`.
   */
  pipelineNextDuplicate: 'PIPELINE_NEXT_DUPLICATE',

  /**
   * Reports a `next()` call after the stage returns or completes.
   *
   * The value can no longer enter the pipeline safely, so the call is ignored. An async branch that
   * is not awaited is a common cause.
   */
  pipelineNextLate: 'PIPELINE_NEXT_LATE',

  /**
   * Thrown when a stage is registered while the pipeline is executing.
   *
   * Changing stages during execution would make behavior depend on registration timing. Complete
   * stage registration before execution starts.
   */
  pipelineExecuting: 'PIPELINE_EXECUTING',

  /**
   * Thrown when an async stage and its downstream both fail. An `AggregateError` retains `errors`
   * in the fixed order `[stageError, downstreamError]`.
   *
   * Enforces the boundary error identity contract in `docs/contracts/error-codes.md` §2 and §3.2.
   * Both original errors remain reachable by identity in `errors`. Handle each failure rather than
   * retrying it as one stage failure.
   */
  pipelineFailed: 'PIPELINE_FAILED',

  /**
   * Diagnostic code that is reported, never thrown.
   *
   * Reports through `diagnostic` when `install()` fails and rollback also fails. The primary error
   * retains `PLUGIN_INSTALL_FAILED` and `cause` equal to the original installation error. See L-T39
   * / `docs/lifecycle/migration.sdd.md` §3.7.4 M-T44. This additional signal never rewrites or
   * replaces the primary error. Some installed plugins may remain incompletely unloaded, leaving
   * inconsistent host state. Treat the failure as unrecoverable and rebuild the host.
   */
  pluginInstallRollbackFailed: 'PLUGIN_INSTALL_ROLLBACK_FAILED',

  /**
   * Diagnostic code that is reported, never thrown.
   *
   * Reports a non-enumerable property intentionally skipped when mounting an `install()` result.
   * Ignoring such keys is part of the contract, but reporting explains why they are absent from the
   * host. Make the property enumerable to expose it.
   */
  extensionNonEnumerableIgnored: 'EXTENSION_NON_ENUMERABLE_IGNORED',

  /**
   * Thrown when a mutation exceeds its configured FIFO admission wait and is removed and rejected.
   *
   * The caller configures this admission limit. Without a limit, the host reports waits without
   * rejecting them. This code wraps lifecycle `QUEUE_ADMISSION_TIMEOUT` at the plugin-host
   * boundary. `cause` retains the original lifecycle error.
   *
   * The mutation is terminated and never executes. This differs from `DISPOSE_STEP_TIMEOUT`, which
   * stops waiting and continues disposal.
   */
  mutationQueueTimeout: 'MUTATION_QUEUE_TIMEOUT',

  /**
   * Reported when one disposer exceeds its wait limit without settling. This includes pipeline
   * disposers, plugin `dispose` or `beforeRelease` hooks, and resource disposers.
   *
   * A disposer that awaits the `host.dispose()` call responsible for running it cannot settle on
   * its own.
   *
   * Disposal continues after recording the step as failed and ending the wait. The running disposer
   * is not cancelled because JavaScript cannot safely revoke an active Promise chain. The
   * transaction can still reach disposed state. This differs from `MUTATION_QUEUE_TIMEOUT`, which
   * terminates the queued mutation.
   */
  disposeStepTimeout: 'DISPOSE_STEP_TIMEOUT',

  /**
   * Thrown as a native `TypeError` with an attached code when input violates its contract. Inputs
   * include plugin names, configuration paths, stages, extensions, domain cores, and resource
   * disposers.
   *
   * Enforces the untagged-error gate in `docs/contracts/error-codes.md` §7 and input-validation
   * rules in `error-code-rollout.sdd.md` §3. Correct the input before retrying. This is a
   * programming error, not a runtime state failure.
   */
  invalidOption: 'INVALID_OPTION',
  /** Config value violates the admitted plain-data grammar; caller must supply an allowed value. */
  invalidConfigValue: 'INVALID_CONFIG_VALUE',
  /** Config input contains a reference cycle; caller must supply an acyclic value graph. */
  configCycleRejected: 'CONFIG_CYCLE_REJECTED',
  /** A lifecycle hook exceeded the admitted mutation budget and lost commit authority. */
  mutationExecutionTimeout: 'MUTATION_EXECUTION_TIMEOUT',

  /** A previously published view was logically revoked by removal or disposal. */
  registrationRevoked: 'REGISTRATION_REVOKED',

  /** Plugin install returned an own `then` key, which is never a publishable extension result. */
  installResultThenable: 'INSTALL_RESULT_THENABLE',

  /** Active pipeline work did not drain before the explicit disposal budget elapsed. */
  pipelineDrainTimeout: 'PIPELINE_DRAIN_TIMEOUT',

  /** Logical disposal completed while one or more physical cleanup tasks remain unsettled. */
  cleanupIncomplete: 'CLEANUP_INCOMPLETE',
  /**
   * `openComposition` was given a target this package never registered as a managed host.
   *
   * The managed protocol is reached through the composition entry rather than off the host
   * instance, so the only admissible targets are the ones the host registers at construction. A
   * caller that gets this has an object that is not a host of this package — a plain object, a host
   * from a different copy of the package, or a value that was never constructed at all.
   */
  compositionTargetUnmanaged: 'COMPOSITION_TARGET_UNMANAGED'
} as const

export type IPluginHostErrorCode = (typeof PluginHostErrorCode)[keyof typeof PluginHostErrorCode]

/**
 * The single declaration site for `source` in `(source, code)` (`docs/contracts/error-codes.md`
 * §2).
 *
 * Every error leaving the plugin-host boundary uses this value. Throw sites and `error-text.ts`
 * must not repeat its string literal.
 */
export const PLUGIN_HOST_SOURCE = '@migaia/plugin-host' as const
