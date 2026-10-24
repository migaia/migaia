import { createRpcError, type IRpcCleanupError, RpcCoreErrorCode } from '../errors.js'
import { EndpointKernelState, type IEndpointKernelHost } from '../endpoint-kernel.js'
import type {
  IDeferredPreparedEndpoint,
  IEndpointMiddlewareSnapshot,
  IPreparedEndpoint
} from './endpoint-bootstrap.js'
import type { IRpcPluginClaims } from '../typing.js'
import type { IRpcPluginDescriptor } from './plugin-descriptor.js'
import type { IRpcPluginConstraint, IRpcPluginCore, IRpcPluginHostCore } from './plugin-contract.js'
import { runConstructionInstall } from './construction-install.js'
import { assertPluginInstallResult } from './plugin-descriptor.js'
import { RpcPortName, type IRpcHooksPort, type IRpcTimePort } from './plugin-shared-keys.js'

import { RpcCoreErrorText } from '../error-text.js'
import type { IRpcHookEvent } from '../typing.js'
import type { IRpcClaimAdmission } from './feature-policy.js'
import { definePlugin } from '@migaia/plugin-host'
import { createWebRpcPortFeatureSet } from './port-feature.js'

/** Fixed production batch positions exposed only to bounded internal failure injection tests. */
export type IRpcPluginRole =
  | { readonly kind: 'kernel' }
  | { readonly kind: 'middleware'; readonly index: number; readonly name: string }
  | { readonly kind: 'middleware-finalize' }
  | { readonly kind: 'feature'; readonly index: number; readonly key: string }
  | { readonly kind: 'activation' }

/** Runtime batch state observed only by bounded production parity tests. */
export type IRpcComposedRuntimeState = {
  readonly routeKeys: readonly string[]
  readonly activated: boolean
}

/** One direct Host definition plus only the WebRPC claims required for static parity checks. */
export type IRpcNativePluginBatchEntry = Readonly<{
  readonly role: IRpcPluginRole
  readonly definition: IRpcPluginConstraint & { readonly claims: IRpcPluginClaims }
  readonly admission: IRpcClaimAdmission
}>

/** A domain-admitted native Feature definition inserted before the single activation role. */
export type IRpcNativeFeatureDefinition = Readonly<{
  readonly key: string
  readonly definition: IRpcPluginConstraint & { readonly claims?: IRpcPluginClaims }
  readonly admission: IRpcClaimAdmission
}>

/** Native composition inputs; Host remains the only identity, topology, and lifecycle owner. */
export type IRpcNativePluginBatchOptions = {
  readonly kernel: IEndpointKernelHost
  /** Canonical feature admission is computed from the existing own snapshot. */
  readonly privateFeaturesAllowed?: boolean
  readonly deferred: IDeferredPreparedEndpoint<string>
  readonly middlewareSnapshots: readonly IEndpointMiddlewareSnapshot[]
  readonly hookEvents: IRpcHookEvent[]
  readonly onPrepared: (prepared: IPreparedEndpoint<string>) => void
  readonly onActivationCommitted: () => void
  readonly onActivationRolledBack?: () => void
  readonly onNativeFeatureActivate?: () => void
  readonly onRootDisposalErrors?: (errors: readonly IRpcCleanupError[]) => void
  readonly onActivationPreflight?: (
    state: IRpcComposedRuntimeState,
    getPort: (key: PropertyKey) => unknown
  ) => void | Promise<void>
  /** Bounded test seam wraps one middleware body inside its existing construction scope. */
  readonly transformMiddlewareInstall?: (
    role: IRpcPluginRole,
    install: IRpcPluginDescriptor['install']
  ) => IRpcPluginDescriptor['install']
  /** Native Features are definitions in the same Host transaction, never a side graph. */
  readonly featureDefinitions?: readonly IRpcNativeFeatureDefinition[]
  /** Bounded test seam observes or replaces one direct Host definition without a descriptor path. */
  readonly transformDefinition?: (
    role: IRpcPluginRole,
    definition: IRpcPluginConstraint & { readonly claims: IRpcPluginClaims }
  ) => IRpcPluginConstraint & { readonly claims: IRpcPluginClaims }
}

/**
 * Builds the exact production Host batch without allocating runtime state. The runtime and the
 * failure matrix both consume this list; only the bounded install callback may alter role
 * behavior.
 */
/**
 * Builds the production transaction as direct PluginHost definitions. This intentionally does not
 * create endpoint descriptors, translated installations, or a second dependency graph.
 */
export function buildNativePluginBatch(
  options: IRpcNativePluginBatchOptions
): readonly IRpcNativePluginBatchEntry[] {
  const emptyClaims: IRpcPluginClaims = Object.freeze({
    routes: Object.freeze([]),
    provides: Object.freeze([]),
    consumes: Object.freeze([]),
    publicKeys: Object.freeze([]),
    exposedKeys: Object.freeze([]),
    activator: false
  })
  const entries: IRpcNativePluginBatchEntry[] = []
  const add = (
    role: IRpcPluginRole,
    definition: IRpcPluginConstraint & { readonly claims: IRpcPluginClaims },
    admission: IRpcClaimAdmission
  ): void => {
    entries.push(
      Object.freeze({
        role,
        definition: options.transformDefinition?.(role, definition) ?? definition,
        admission
      })
    )
  }
  add(
    { kind: 'kernel' },
    nativeDefinition(
      'kernel',
      emptyClaims,
      [RpcPortName.time],
      [],
      async (core) => {
        core.onDispose(async () => {
          if (options.kernel.state === EndpointKernelState.disposed) return
          options.kernel.beginClose()
          try {
            const errors = await options.kernel.resources.releaseAll()
            const cleanupErrors = errors.flatMap(({ error }) => flattenReleaseErrors(error))
            if (cleanupErrors.length > 0) {
              options.onRootDisposalErrors?.(
                errors.flatMap(({ resource, error }) =>
                  flattenReleaseErrors(error).map((child) => ({ resource, error: child }))
                )
              )
              if (cleanupErrors.length === 1) throw cleanupErrors[0]
              throw new AggregateError(cleanupErrors)
            }
          } finally {
            options.kernel.completeDispose()
          }
        })
        return {}
      },
      () => ({
        [RpcPortName.time]: Object.freeze({
          now: () => options.kernel.time.now(),
          timestamp: () => options.kernel.time.timestamp(),
          setTimeout: options.kernel.time.setTimeout,
          clearTimeout: options.kernel.time.clearTimeout
        } satisfies IRpcTimePort)
      })
    ),
    { name: 'kernel', claims: emptyClaims, sharedProvides: [RpcPortName.time] }
  )
  options.middlewareSnapshots.forEach((snapshot, index) => {
    const role = {
      kind: 'middleware' as const,
      index,
      name: snapshot.name.replace(/^middleware:/, '')
    }
    if (snapshot.kind === 'native') {
      const metadata = snapshot.metadata
      add(role, snapshot.plugin as IRpcPluginConstraint & { readonly claims: IRpcPluginClaims }, {
        name: snapshot.plugin.name,
        claims: metadata?.claims ?? emptyClaims,
        sharedProvides: metadata?.sharedProvides,
        sharedConsumes: metadata?.sharedConsumes,
        sharedOptionalConsumes: metadata?.sharedOptionalConsumes
      })
      return
    }
    /** The role owner retains the original installation result until native port publication. */
    const middleware = snapshot.plugin
    const owner = new NativeLegacyMiddlewareRole(options, middleware, role)
    add(role, owner.definition, {
      name: middleware.name,
      claims: middleware.metadata.claims,
      sharedProvides: middleware.metadata.sharedProvides,
      sharedConsumes: middleware.metadata.sharedConsumes,
      sharedOptionalConsumes: middleware.metadata.sharedOptionalConsumes
    })
  })
  add(
    { kind: 'middleware-finalize' },
    nativeDefinition(
      'middleware-finalize',
      emptyClaims,
      [],
      [RpcPortName.connect],
      async (core) => {
        const prepared = await options.deferred.finalize(
          options.hookEvents,
          (operation) => Promise.resolve(operation()),
          core.getPort,
          () => options.kernel.time.timestamp(),
          options.privateFeaturesAllowed
        )
        options.onPrepared(prepared)
        return {}
      }
    ),
    {
      name: 'middleware-finalize',
      claims: emptyClaims,
      sharedProvides: [],
      sharedConsumes: [RpcPortName.connect],
      sharedOptionalConsumes: [
        RpcPortName.protocol,
        RpcPortName.contract,
        RpcPortName.authentication,
        RpcPortName.timeout,
        RpcPortName.abort,
        RpcPortName.hooks,
        RpcPortName.ping,
        RpcPortName.uuid
      ]
    }
  )
  options.featureDefinitions?.forEach((feature, index) => {
    add(
      { kind: 'feature', index, key: feature.key },
      feature.definition as IRpcPluginConstraint & { readonly claims: IRpcPluginClaims },
      feature.admission
    )
  })
  add(
    { kind: 'activation' },
    nativeDefinition('activation', { ...emptyClaims, activator: true }, [], [], async (core) => {
      core.onDispose(() => options.onActivationRolledBack?.())
      core.onDispose(() => {
        options.kernel.beginClose()
        const errors = options.kernel.resources.releaseSync()
        if (errors.length > 0) {
          options.onRootDisposalErrors?.(
            errors.flatMap(({ resource, error }) =>
              flattenReleaseErrors(error).map((child) => ({ resource, error: child }))
            )
          )
          throw new AggregateError(errors.map(({ error }) => error))
        }
      })
      const state = { routeKeys: options.kernel.routeKeys, activated: true }
      await options.onActivationPreflight?.(state, core.getPort)
      options.onNativeFeatureActivate?.()
      options.onActivationCommitted()
      return {}
    }),
    { name: 'activation', claims: { ...emptyClaims, activator: true } }
  )
  return Object.freeze(entries)
}

/** One legacy middleware role owns the exact install output later published as native ports. */
class NativeLegacyMiddlewareRole {
  /** Immutable admitted legacy descriptor supplies the original output-key contract. */
  #middleware: Extract<IEndpointMiddlewareSnapshot, { kind: 'legacy' }>['plugin']
  /** The bounded install transformation is captured once before native definition construction. */
  #operation: IRpcPluginDescriptor['install']
  /** Only the successful original installation may publish this role's shared ports. */
  #result: import('../typing.js').IRpcPluginInstallResult | undefined
  /** The exact genuine native definition participates in the one endpoint batch. */
  readonly definition: IRpcPluginConstraint & { readonly claims: IRpcPluginClaims }
  /** Capture the role-local operation before creating its native PluginHost definition. */
  constructor(
    options: IRpcNativePluginBatchOptions,
    middleware: Extract<IEndpointMiddlewareSnapshot, { kind: 'legacy' }>['plugin'],
    role: IRpcPluginRole
  ) {
    this.#middleware = middleware
    this.#operation =
      options.transformMiddlewareInstall?.(role, middleware.install) ?? middleware.install
    this.definition = nativeDefinition(
      middleware.name,
      middleware.metadata.claims,
      middleware.metadata.sharedProvides ?? [],
      middleware.metadata.sharedConsumes ?? [],
      this.#install,
      this.#ports
    )
  }
  /** Run the original rollback transaction, retain its output, then project declared public keys. */
  #install = async (core: IRpcPluginCore & IRpcPluginHostCore) => {
    const hooksPort = core.getPort(RpcPortName.hooks) as IRpcHooksPort | undefined
    const constructionReporter = hooksPort?.reportConstructionDiagnostic
    const installed = await runConstructionInstall(
      {
        id: core.id,
        transport: core.transport,
        control: core.construction,
        hooks: core.hooks,
        getPort: (key) => core.getPort(key),
        report: constructionReporter
          ? (error) =>
              constructionReporter({
                name: 'failure',
                at: core.construction.time.timestamp(),
                localId: core.id,
                code: RpcCoreErrorCode.internal,
                error
              })
          : (error) =>
              core.hooks({
                name: 'failure',
                at: core.construction.time.timestamp(),
                localId: core.id,
                code: RpcCoreErrorCode.internal,
                error
              }),
        registerScope: (_scope, close, awaitClose) => {
          core.onDispose(async () => {
            close()
            await awaitClose()
          })
        }
      },
      async (scope) => {
        const installation = await (0, this.#operation)(scope)
        const disposer =
          installation !== null && typeof installation === 'object'
            ? Object.getOwnPropertyDescriptor(installation, 'dispose')?.value
            : undefined
        if (typeof disposer === 'function')
          scope.own({}, async () => {
            await disposer()
          })
        return installation
      }
    )
    assertPluginInstallResult(installed)
    this.#result = installed
    return copyExtensionOutput(installed.extension, this.#middleware.metadata.claims.publicKeys)
  }
  /** Shared port publication reads the exact successful output of this original registration. */
  #ports = () => this.#result?.ports ?? {}
}

/** Creates a direct domain definition; PluginHost still owns the feature graph and instances. */
/** One definition owns a separate deferred port runtime for each genuine native core. */
class NativePluginDefinition {
  /** Immutable declared port Feature definitions are shared; their cells remain registration-local. */
  #portFeatures: ReturnType<typeof createWebRpcPortFeatureSet>
  /** Exact native core identities index their original deferred port cells. */
  #runtimes = new WeakMap<
    object,
    ReturnType<ReturnType<typeof createWebRpcPortFeatureSet>['createRuntime']>
  >()
  /** Original installation remains receiverless and retains its exact result. */
  #operation: (core: IRpcPluginCore & IRpcPluginHostCore) => unknown | Promise<unknown>
  /** The caller lends the original successful shared-port projection. */
  #ports: (() => Record<PropertyKey, unknown>) | undefined
  /** Genuine PluginHost definition is the sole topology and lifecycle authority. */
  readonly value: IRpcPluginConstraint & { readonly claims: IRpcPluginClaims }
  /** Capture declared ports once, then publish callbacks tied to this explicit definition owner. */
  constructor(
    name: string,
    claims: IRpcPluginClaims,
    sharedProvides: readonly PropertyKey[],
    sharedConsumes: readonly PropertyKey[],
    install: (core: IRpcPluginCore & IRpcPluginHostCore) => unknown | Promise<unknown>,
    ports?: () => Record<PropertyKey, unknown>
  ) {
    this.#portFeatures = createWebRpcPortFeatureSet(sharedProvides)
    this.#operation = install
    this.#ports = ports
    this.value = definePlugin({
      name,
      claims,
      sharedProvides,
      sharedConsumes,
      features: this.#portFeatures.features,
      featureExpose: (core: IRpcPluginCore & IRpcPluginHostCore) => this.#runtimeFor(core).expose,
      install: this.#install
    }) as IRpcPluginConstraint & { readonly claims: IRpcPluginClaims }
  }
  /** Allocate each native core's deferred cells only on its first original access. */
  #runtimeFor = (
    core: object
  ): ReturnType<ReturnType<typeof createWebRpcPortFeatureSet>['createRuntime']> => {
    /** Existing cells are reused without another registration or source. */ const current =
      this.#runtimes.get(core)
    if (current) return current
    /** Only a genuinely new core receives a fresh publication runtime. */ const created =
      this.#portFeatures.createRuntime()
    this.#runtimes.set(core, created)
    return created
  }
  /** Original installation settles before its exact port outputs are published to native Features. */
  #install = async (core: IRpcPluginCore & IRpcPluginHostCore) => {
    /** Keep the caller operation receiverless. */ const operation = this.#operation
    const output = await operation(core)
    /** Publish through this core's original deferred cells. */ const runtime =
      this.#runtimeFor(core)
    /** Keep the caller projection receiverless. */ const ports = this.#ports
    runtime.publish(ports?.() ?? {})
    core.publishPortFeatures(runtime.outputs)
    return output as Record<string, unknown>
  }
}

/** Create the direct native domain definition with explicit registration-local port ownership. */
function nativeDefinition(
  name: string,
  claims: IRpcPluginClaims,
  sharedProvides: readonly PropertyKey[],
  sharedConsumes: readonly PropertyKey[],
  install: (core: IRpcPluginCore & IRpcPluginHostCore) => unknown | Promise<unknown>,
  ports?: () => Record<PropertyKey, unknown>
): IRpcPluginConstraint & { readonly claims: IRpcPluginClaims } {
  return new NativePluginDefinition(name, claims, sharedProvides, sharedConsumes, install, ports)
    .value
}

/** Re-materializes legacy middleware output as Host-compatible configurable data properties. */
function copyExtensionOutput(
  source: Readonly<Record<string, unknown>>,
  publicKeys: readonly string[]
): Record<string, unknown> {
  const output: Record<string, unknown> = Object.create(null)
  for (const key of publicKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(source, key)
    if (!descriptor || !('value' in descriptor))
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
    Object.defineProperty(output, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true
    })
  }
  return output
}

/** Preserves raw cleanup identities while flattening lifecycle/resource diagnostic containers. */
function flattenReleaseErrors(error: unknown): readonly unknown[] {
  /** Each frame snapshots the original array length once and visits indexed children left to right. */
  const frames: { errors: readonly unknown[]; index: number; length: number; owner?: object }[] = [
    { errors: [error], index: 0, length: 1 }
  ]
  /**
   * Only active ancestors suppress cycles; completed DAG branches retain their original
   * multiplicity.
   */
  const ancestors = new WeakSet<object>()
  /** Leaves retain original multiplicity and identity without repeatedly copying descendant arrays. */
  const output: unknown[] = []
  while (frames.length) {
    /** Depth-first frames preserve the original native flatMap getter and sparse-array order. */
    const frame = frames[frames.length - 1]!
    if (frame.index >= frame.length) {
      if (frame.owner) ancestors.delete(frame.owner)
      frames.pop()
      continue
    }
    /** Native flatMap skips absent indices while still observing inherited indexed properties. */
    const index = frame.index++
    if (!(index in frame.errors)) continue
    /** Each child is read once, before any later sibling is observed. */
    const current = frame.errors[index]
    if (current && typeof current === 'object' && ancestors.has(current)) {
      output.push(current)
      continue
    }
    if (current instanceof AggregateError) {
      ancestors.add(current)
      /** Retain the original array identity and its one length snapshot throughout this traversal. */
      const children = current.errors
      frames.push({ errors: children, index: 0, length: children.length, owner: current })
      continue
    }
    if (current && typeof current === 'object' && 'error' in current) {
      ancestors.add(current)
      frames.push({
        errors: [(current as { error: unknown }).error],
        index: 0,
        length: 1,
        owner: current
      })
      continue
    }
    output.push(current)
  }
  return output
}
