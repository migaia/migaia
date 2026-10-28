/** Owns registration-local Feature construction and install-result admission, without publication. */
import { assimilateCapturedThen, probeThenable } from '@migaia/utils/function'
import { readPlainDataRecord } from './config.ts'
import ERROR_TEXT, { PluginHostError, createPluginHostTypeError } from './error-text.ts'
import { PluginCoreKey } from './core-constants.ts'
import { PluginHostInstallText, PluginHostDescriptorHook } from './install-constants.ts'
import { PluginHostErrorCode } from './error-code.ts'
import { mountPluginExtensions, isSharedExtensionSlot } from './extension.ts'
import { invokeCaptured } from './invocation.ts'
import { reportDiagnostic, reportTerminalFailure } from './diagnostic-report.ts'
import { compileFeatures, instantiateFeatures, snapshotFeatureExpose } from './feature-runtime.ts'
import type { IFeatureReference } from './feature-types.ts'
import { isFeatureReference } from './define-feature.ts'
import type { IInstallBatchContext, IPluginHostInstallRuntimePort } from './install-runtime.ts'
import type { IPluginDescriptor, IRegistration } from './registry.ts'
import type { IPluginHostCore } from './plugin-core-types.ts'

/** Rejects Feature reads while its descriptor and dependency closure are still preparing. */
function rejectEarlyFeatureRead(): never {
  throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_CORE_PENDING)
}

/** Registration construction uses only the existing install boundary and candidate batch. */
export class PluginHostInstallFeatureRuntime<TDomainCore extends object, TValue> {
  /** Host authority shared with the installation transaction. */
  readonly #port: IPluginHostInstallRuntimePort<TDomainCore, TValue>

  /** Retains the canonical Host authority without copying callbacks. */
  constructor(port: IPluginHostInstallRuntimePort<TDomainCore, TValue>) {
    this.#port = port
  }

  /** Evaluates the descriptor and Features under the original synchronous hook boundary. */
  start(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>
  ): unknown {
    /** A session owns the captured registration and batch for all Feature callbacks. */
    const session = new PluginHostInstallFeatureSession(registration, batch, this.#port)
    return this.#port.invokeHook(() => session.start())
  }

  /** Admits extension descriptors against the same isolated candidate overlay. */
  prepare(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    installedValue: unknown
  ): void {
    /** Result evaluation owns no new runtime state beyond this exact candidate. */
    const session = new PluginHostInstallFeatureSession(registration, batch, this.#port)
    /** Both descriptor outputs are evaluated under the existing hook invocation guard. */
    const extensions = this.#port.invokeHook(() => session.mergeDescriptorExpose(installedValue))
    mountPluginExtensions(registration, extensions, session, this.#port.diagnostic)
  }
}

/** Owns one registration's Feature callbacks and the candidate extension-owner overlay. */
class PluginHostInstallFeatureSession<TDomainCore extends object, TValue> {
  /** Candidate generation supplying the descriptor, setup output and exposed capabilities. */
  readonly #registration: IRegistration<TDomainCore, TValue>
  /** Overlay whose lookups precede committed Host state until publication. */
  readonly #batch: IInstallBatchContext<TDomainCore, TValue>
  /** Host services are borrowed through the installation's explicit port. */
  readonly #port: IPluginHostInstallRuntimePort<TDomainCore, TValue>
  /** Root Feature labels are diagnostic only; opaque token identity remains authoritative. */
  readonly #featureNames = new Map<object, string>()

  /** Captures the exact generation and candidate context for this evaluation. */
  constructor(
    registration: IRegistration<TDomainCore, TValue>,
    batch: IInstallBatchContext<TDomainCore, TValue>,
    port: IPluginHostInstallRuntimePort<TDomainCore, TValue>
  ) {
    this.#registration = registration
    this.#batch = batch
    this.#port = port
  }

  /** Initializes Features before invoking the captured install hook, without awaiting either. */
  start(): unknown {
    return this.#invokeInstall(this.#initializeFeatureCore())
  }

  /** Existing candidate ownership wins; released exclusive generations no longer reserve a slot. */
  has(key: PropertyKey): boolean {
    if (this.#batch.extensionOwners.has(key)) return true
    /** Committed shared slots retain their family even while an exclusive owner is released. */
    const committed = this.#port.state.extensionOwners.get(key)
    return (
      committed !== undefined &&
      (isSharedExtensionSlot(committed) || !this.#batch.releasedOwners.has(committed))
    )
  }

  /** Records extension ownership only in the unpublished candidate overlay. */
  set(key: PropertyKey, owner: IRegistration<TDomainCore, TValue>): void {
    this.#batch.extensionOwners.set(key, owner)
  }

  /** Returns the original diagnostic result so Feature reporting observes any async rejection. */
  #reportFeatureRejection(error: unknown): void {
    return this.#port.diagnostic(
      error instanceof Error ? error.message : String(error),
      PluginHostErrorCode.pluginInstallFailed,
      error
    )
  }

  /** Resolves required and optional cross-plugin Feature references against this exact candidate. */
  #resolveReference(reference: IFeatureReference<object, boolean>): object | undefined {
    if (!isFeatureReference(reference)) return undefined
    /** Candidate providers precede committed generations while a batch prepares. */
    const provider =
      this.#batch.registrations.get(reference.plugin) ??
      this.#port.state.registrations.get(reference.plugin)
    if (!provider) return undefined
    if (!provider.enabled)
      throw new PluginHostError(
        PluginHostErrorCode.prerequisiteDisabled,
        ERROR_TEXT.PREREQUISITE_DISABLED(reference.feature, reference.plugin)
      )
    if (!provider.activated) {
      if (reference.optional) return undefined
      throw new PluginHostError(
        PluginHostErrorCode.pluginNotActivated,
        ERROR_TEXT.PLUGIN_NOT_ACTIVATED(reference.plugin)
      )
    }
    return provider.featureOutputs?.[reference.feature]
  }

  /** Initializes the one registration-local Feature surface shared by async and sync installation. */
  #initializeFeatureCore(): TDomainCore & IPluginHostCore<TValue> {
    /** The original registration core is prepared before descriptor and Feature code can inspect it. */
    const core = this.#port.createCore(this.#registration, this.#batch) as Record<
      PropertyKey,
      unknown
    >
    /** Capability compiles trusted Feature identities without running any user factories. */
    const featurePlan = compileFeatures(this.#registration.plugin.features)
    Object.defineProperties(core, {
      [PluginCoreKey.featureExpose]: { configurable: true, get: rejectEarlyFeatureRead },
      [PluginCoreKey.features]: { configurable: true, get: rejectEarlyFeatureRead }
    })
    this.#registration.descriptor = this.#registration.plugin.descriptorFactory
      ? this.#snapshotDescriptor(
          invokeCaptured(
            this.#registration.plugin.descriptorFactory,
            this.#registration.plugin.owner,
            [core]
          )
        )
      : undefined
    /** Descriptor expose takes precedence over the compatible object-definition hook. */
    const expose = this.#registration.descriptor?.featureExpose
      ? this.#registration.descriptor.featureExpose()
      : typeof this.#registration.plugin.featureExpose === 'function'
        ? invokeCaptured(
            this.#registration.plugin.featureExpose,
            this.#registration.plugin.owner,
            this.#registration.plugin.setup ? [core, this.#registration.setupOutput] : [core]
          )
        : (this.#registration.plugin.featureExpose ?? {})
    this.#rejectThenable(expose, ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_OUTPUT)
    if (!expose || typeof expose !== 'object')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_FEATURE_EXPOSE_OUTPUT)
    this.#registration.featureExpose = snapshotFeatureExpose(
      expose,
      () => this.#registration.featureExposeValid === true
    )
    for (const [name, feature] of Object.entries(this.#registration.plugin.features))
      this.#featureNames.set(feature, name)
    this.#registration.featureOutputs = instantiateFeatures(
      this.#registration.plugin.features,
      this.#registration.featureExpose,
      featurePlan,
      (error) => this.#reportFeatureRejection(error),
      (reference) => this.#resolveReference(reference),
      (failure) => reportTerminalFailure(failure, this.#port.diagnostic),
      (name, feature) =>
        this.#port.pipeline(
          name,
          this.#registration,
          this.#batch,
          this.#featureNames.get(feature) ?? PluginHostInstallText.localFeature
        )
    )
    Object.defineProperty(core, PluginCoreKey.featureExpose, {
      value: this.#registration.featureExpose,
      enumerable: true
    })
    Object.defineProperty(core, PluginCoreKey.features, {
      value: this.#registration.featureOutputs,
      enumerable: true
    })
    return core as TDomainCore & IPluginHostCore<TValue>
  }

  /** Rejects descriptor getters and unknown hooks without executing a returned capability. */
  #snapshotDescriptor(value: unknown): IPluginDescriptor {
    if (!value || typeof value !== 'object')
      throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_OUTPUT)
    this.#rejectThenable(value, ERROR_TEXT.PLUGIN_DESCRIPTOR_OUTPUT)
    /** Only captured own-data hooks survive descriptor admission. */
    const descriptor: Record<string, unknown> = {}
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== 'string' || !Object.hasOwn(PluginHostDescriptorHook, key))
        throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_HOOK)
      /** Read each descriptor once without invoking its accessor value. */
      const property = Object.getOwnPropertyDescriptor(value, key)
      if (!property || !('value' in property) || typeof property.value !== 'function')
        throw createPluginHostTypeError(ERROR_TEXT.PLUGIN_DESCRIPTOR_HOOK_DATA)
      descriptor[key] = property.value
    }
    return Object.freeze(descriptor) as IPluginDescriptor
  }

  /** Invokes the descriptor install hook after Feature outputs become ready. */
  #invokeInstall(core: TDomainCore & IPluginHostCore<TValue>): unknown {
    /** A descriptor install hook is called receiverlessly, preserving its original contract. */
    const hook = this.#registration.descriptor?.install
    return hook
      ? hook()
      : invokeCaptured(
          this.#registration.plugin.install,
          this.#registration.plugin.owner,
          this.#registration.plugin.setup ? [core, this.#registration.setupOutput] : [core]
        )
  }

  /** Merges descriptor install/expose outputs only after rejecting their own-key collision. */
  mergeDescriptorExpose(installValue: unknown): unknown {
    /** Descriptor expose takes precedence over the compatible object-definition hook. */
    const expose = this.#registration.descriptor?.expose?.()
    if (expose === undefined) return installValue
    this.#rejectThenable(expose, ERROR_TEXT.PLUGIN_DESCRIPTOR_OUTPUT)
    /** Admitted install data retains exact property descriptors for the public surface. */
    const install = readPlainDataRecord(installValue, PluginHostInstallText.installRecord, false)
    /** Descriptor expose data is admitted before key-disjoint publication. */
    const publicSurface = readPlainDataRecord(expose, PluginHostInstallText.exposeRecord, false)
    /** A fresh result preserves both outputs without overwriting a duplicate key. */
    const merged: Record<PropertyKey, unknown> = {}
    for (const key of Reflect.ownKeys(install))
      Object.defineProperty(merged, key, Object.getOwnPropertyDescriptor(install, key)!)
    for (const key of Reflect.ownKeys(publicSurface)) {
      if (Object.hasOwn(install, key))
        throw new PluginHostError(
          PluginHostErrorCode.extensionDuplicate,
          ERROR_TEXT.EXTENSION_DUPLICATE(this.#registration.name, key)
        )
      Object.defineProperty(merged, key, Object.getOwnPropertyDescriptor(publicSurface, key)!)
    }
    return merged
  }

  /** Rejects hook thenables immediately while reporting any late rejection through host diagnostics. */
  #rejectThenable(value: unknown, text: string): void {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return
    /** One probe captures hostile getters and then functions before any rejection is reported. */
    const thenable = probeThenable(value)
    if (thenable?.kind === 'failed') {
      /** The original invalid-output error remains primary when then lookup itself failed. */
      const error = createPluginHostTypeError(text)
      Object.defineProperty(error, 'cause', { value: thenable.error })
      this.#reportThenableRejection(thenable.error)
      throw error
    }
    if (thenable?.kind === 'thenable') {
      /** Late thenable failure is attached to this same immediate invalid-output error. */
      const rejection = createPluginHostTypeError(text)
      void assimilateCapturedThen(thenable.thenFn, value).catch((error) => {
        Object.defineProperty(rejection, 'cause', { value: error })
        this.#reportThenableRejection(error)
      })
      throw rejection
    }
  }

  /** Reports a late hook rejection without allowing diagnostics to replace its original cause. */
  #reportThenableRejection(error: unknown): void {
    reportDiagnostic(
      this.#port.diagnostic,
      error instanceof Error ? error.message : String(error),
      PluginHostErrorCode.pluginInstallFailed,
      error
    )
  }
}
