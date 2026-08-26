import type { IPluginConstraint } from '@migaia/plugin-host'
import { EndpointModuleKey } from './endpoint-modules.js'
import type { IEndpointModuleClaims } from './endpoint-modules.js'
import { runConstructionInstall } from './construction-install.js'
import type { IWebRpcPluginInstallScope } from './plugin-contract.js'
import type { IWebRpcPluginCore, IWebRpcPluginHostCore } from './plugin-contract.js'
import {
  WebRpcControlRole,
  WebRpcControlRoleSchema,
  WebRpcFirstPartyRoleSchema,
  WebRpcProviderRole,
  WebRpcProviderRoleSchema
} from './plugin-contract.js'
import { hasNativeProviderClaimAuthority } from './provider-claim-authority.js'
import { WebRpcConfigurationError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import { WebRpcSharedKey, type IWebRpcHooksPort } from './plugin-shared-keys.js'

/** Immutable WebRPC descriptor metadata admitted before the Host mutates. */
export type IWebRpcPluginClaims = IEndpointModuleClaims

/** Runtime output categories that bounded production tests may perturb after installation. */
export type IWebRpcPluginRuntimeOutputPhase = 'extension' | 'shared'

/** Plain runtime output passed through the package-internal test injection seam. */
export type IWebRpcPluginRuntimeOutput = Readonly<Record<PropertyKey, unknown>>

/** Bounded translator hook; it cannot access Host mutation or lifecycle APIs. */
export type IWebRpcPluginRuntimeOutputInjector = (
  phase: IWebRpcPluginRuntimeOutputPhase,
  output: IWebRpcPluginRuntimeOutput
) => IWebRpcPluginRuntimeOutput

/** Domain-only descriptor body; raw PluginHost lifecycle capabilities never cross this boundary. */
export type IWebRpcPluginDescriptor<TInstallation = unknown> = {
  readonly name: string
  readonly claims: IWebRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
  /** Disables generic result cleanup when the installation already owns kernel resources. */
  readonly disposeResult?: boolean
  /** Keeps injected middleware output out of Host state while retaining it for parity checks. */
  readonly preserveRuntimeOutputForHost?: boolean
  readonly install: (scope: IWebRpcPluginInstallScope) => TInstallation | Promise<TInstallation>
  readonly shared?: (installation: TInstallation) => Record<PropertyKey, unknown>
  readonly runtimeOutput?: IWebRpcPluginRuntimeOutputInjector
}

/** Claim fields available to the Host's pre-mutation native provider admission gate. */
export type IWebRpcNativeProviderClaimSource = {
  readonly name: string
  readonly claims?: IWebRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}

/** Runtime values supplied to one stateless descriptor conversion. */
export type IWebRpcPluginTranslationContext = {
  readonly report?: (error: unknown) => void
  readonly onInstalled?: (installation: unknown) => void
  /** Internal observation of the one construction-scope cleanup transferred to Host. */
  readonly onTransferredCleanup?: (pluginName: string) => void
}

/** Runtime keys observed after one translated plugin has installed. */
export type IWebRpcPluginRuntimeKeys = {
  readonly extension: readonly PropertyKey[]
  readonly shared: readonly PropertyKey[]
  readonly expectedSharedValues: Readonly<Record<PropertyKey, unknown>>
  readonly actualSharedValues: Readonly<Record<PropertyKey, unknown>>
}

/** One translated definition and its private installation observation. */
export type IWebRpcTranslatedPlugin<TInstallation = unknown> = {
  readonly definition: IPluginConstraint<IWebRpcPluginCore & IWebRpcPluginHostCore> & {
    readonly claims: IWebRpcPluginClaims
  }
  readonly getInstallation: () => TInstallation | undefined
  readonly getLiveInstallation: () => TInstallation | undefined
  readonly getInstallationObservation: () => IWebRpcInstallationObservation<TInstallation>
  readonly getLiveInstallationObservation: () => IWebRpcInstallationObservation<TInstallation>
  readonly getRuntimeKeys: () => IWebRpcPluginRuntimeKeys
  readonly getLiveRuntimeMarkers: () => IWebRpcPluginRuntimeKeys
}

/** Durable or live installation observation that distinguishes an installed undefined value. */
export type IWebRpcInstallationObservation<TInstallation = unknown> = {
  readonly installed: boolean
  readonly value: TInstallation | undefined
}

/** Performs the side-effect-free claim checks required before the Host mutation boundary. */
export function preflightPluginClaims(
  descriptors: readonly IWebRpcPluginDescriptor[],
  claims: readonly IWebRpcPluginClaims[]
): void {
  const names = new Set<string>()
  const routes = new Set<string>()
  const provides = new Set<string>()
  const publicKeys = new Set<string>()
  let activators = 0
  let current: IWebRpcPluginDescriptor | undefined
  try {
    for (const [index, descriptor] of descriptors.entries()) {
      current = descriptor
      const claim = claims[index]
      if (!claim || descriptor.name.length === 0 || names.has(descriptor.name))
        throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      names.add(descriptor.name)
      const roleName = descriptor.name.replace(/^middleware:/, '')
      const expectedCancellationKey =
        roleName === 'timeout'
          ? WebRpcSharedKey.timeout
          : roleName === 'abort'
            ? WebRpcSharedKey.abort
            : undefined
      if (
        expectedCancellationKey !== undefined &&
        (descriptor.sharedProvides?.length !== 1 ||
          descriptor.sharedProvides[0] !== expectedCancellationKey)
      )
        throw new WebRpcConfigurationError(
          roleAdmissionMessage(roleName, 'sharedProvides', descriptor.sharedProvides?.[0])
        )
      const roleSchema =
        (descriptor.name.startsWith('middleware:') || descriptor.name === 'middleware-finalize') &&
        roleName in WebRpcFirstPartyRoleSchema
          ? WebRpcFirstPartyRoleSchema[roleName as keyof typeof WebRpcFirstPartyRoleSchema]
          : undefined
      if (roleSchema) {
        const assertExactKeys = (
          slot: 'sharedProvides' | 'sharedConsumes' | 'sharedOptionalConsumes',
          actual: readonly PropertyKey[] | undefined,
          expected: readonly PropertyKey[]
        ): void => {
          if (
            actual?.length !== expected.length ||
            actual?.some((key, keyIndex) => key !== expected[keyIndex])
          )
            throw new WebRpcConfigurationError(roleAdmissionMessage(roleName, slot, actual?.[0]))
        }
        assertExactKeys('sharedProvides', descriptor.sharedProvides, roleSchema.sharedProvides)
        assertExactKeys('sharedConsumes', descriptor.sharedConsumes, roleSchema.sharedConsumes)
        assertExactKeys(
          'sharedOptionalConsumes',
          descriptor.sharedOptionalConsumes,
          roleSchema.sharedOptionalConsumes
        )
      }
      if (descriptor.sharedProvides?.some((key) => descriptor.sharedConsumes?.includes(key)))
        throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      if (claim.activator) activators += 1
      for (const provided of descriptor.sharedProvides ?? [])
        if (
          descriptors.some((item, itemIndex) => {
            current = item
            return itemIndex !== index && item.sharedProvides?.includes(provided) === true
          })
        )
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      for (const consumed of descriptor.sharedConsumes ?? [])
        if (
          !descriptors.some((item) => {
            current = item
            return item.sharedProvides?.includes(consumed) === true
          })
        )
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      for (const route of claim.routes) {
        if (routes.has(route))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        routes.add(route)
      }
      for (const provided of claim.provides) {
        if (provides.has(provided))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        provides.add(provided)
      }
      for (const publicKey of claim.publicKeys) {
        if (publicKeys.has(publicKey))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        publicKeys.add(publicKey)
      }
      for (const exposedKey of claim.exposedKeys)
        if (
          !publicKeys.has(exposedKey) &&
          !claims.some((item) => item.publicKeys.includes(exposedKey))
        )
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      for (const consumed of claim.consumes)
        if (!claims.some((item) => item.provides.includes(consumed)))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
    }
  } catch (error) {
    if (error instanceof WebRpcConfigurationError) throw error
    const roleName = current?.name.replace(/^middleware:/, '') ?? 'unknown'
    throw new WebRpcConfigurationError(
      roleAdmissionMessage(roleName, 'sharedProvides', undefined),
      error
    )
  }
  if (claims.some((claim) => claim.routes.length > 0) && activators !== 1)
    throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
}

/** Admits the native provider contract before its translated install can enter Host state. */
function assertNativeProviderClaims(descriptor: IWebRpcNativeProviderClaimSource): void {
  if (descriptor.name !== WebRpcProviderRole.provider) return
  if (descriptor.claims === undefined) return
  const schema = WebRpcProviderRoleSchema[WebRpcProviderRole.provider]
  const nativeClaim =
    descriptor.sharedProvides?.some((key) => key === WebRpcSharedKey.providerCancellation) ===
      true ||
    descriptor.sharedConsumes?.some((key) =>
      schema.sharedConsumes.some((expected) => expected === key)
    ) === true
  const claims = descriptor.claims
  const looksLikeProviderCandidate =
    nativeClaim ||
    (descriptor.sharedProvides?.length ?? 0) > 0 ||
    (descriptor.sharedConsumes?.length ?? 0) > 0 ||
    (typeof claims === 'object' &&
      claims !== null &&
      (claims.routes.includes('request') ||
        claims.publicKeys.includes('provide') ||
        claims.exposedKeys.includes('provide')))
  if (!looksLikeProviderCandidate) return
  if (!hasNativeProviderClaimAuthority(claims))
    throw new WebRpcConfigurationError(
      roleAdmissionMessage(WebRpcProviderRole.provider, 'claims', undefined)
    )
  if (!nativeClaim)
    throw new WebRpcConfigurationError(
      roleAdmissionMessage(
        WebRpcProviderRole.provider,
        'sharedConsumes',
        descriptor.sharedConsumes?.[0]
      )
    )
  const assertExact = (
    slot: 'sharedProvides' | 'sharedConsumes',
    actual: readonly PropertyKey[] | undefined,
    expected: readonly PropertyKey[]
  ): void => {
    if (actual?.length !== expected.length || actual.some((key, index) => key !== expected[index]))
      throw new WebRpcConfigurationError(
        roleAdmissionMessage(WebRpcProviderRole.provider, slot, actual?.[0])
      )
  }
  assertExact('sharedProvides', descriptor.sharedProvides, schema.sharedProvides)
  assertExact('sharedConsumes', descriptor.sharedConsumes, schema.sharedConsumes)
}

/** Admits the native control role against the package-owned four-port contract. */
function assertNativeControlClaims(descriptor: IWebRpcNativeProviderClaimSource): void {
  if (descriptor.name !== EndpointModuleKey.control || descriptor.claims === undefined) return
  const schema = WebRpcControlRoleSchema[WebRpcControlRole.control]
  const assertExact = (
    slot: 'sharedProvides' | 'sharedConsumes' | 'sharedOptionalConsumes',
    actual: readonly PropertyKey[] | undefined,
    expected: readonly PropertyKey[]
  ): void => {
    if (actual?.length !== expected.length || actual.some((key, index) => key !== expected[index]))
      throw new WebRpcConfigurationError(
        roleAdmissionMessage(WebRpcControlRole.control, slot, actual?.[0])
      )
  }
  assertExact('sharedProvides', descriptor.sharedProvides, schema.sharedProvides)
  assertExact('sharedConsumes', descriptor.sharedConsumes, schema.sharedConsumes)
  assertExact(
    'sharedOptionalConsumes',
    descriptor.sharedOptionalConsumes ?? [],
    schema.sharedOptionalConsumes
  )
}

/** Returns the first native control admission failure for the WebRpcPluginHost wrapper. */
export function preflightNativeControlClaims(
  definitions: readonly IWebRpcNativeProviderClaimSource[]
): { readonly failedName: string; readonly error: unknown } | undefined {
  for (const definition of definitions) {
    try {
      assertNativeControlClaims(definition)
    } catch (error) {
      return Object.freeze({ failedName: safeControlName(definition), error })
    }
  }
  return undefined
}

/** Returns a stable control failure label without re-reading a hostile name accessor. */
function safeControlName(source: IWebRpcNativeProviderClaimSource): string {
  try {
    return typeof source.name === 'string' ? source.name : WebRpcControlRole.control
  } catch {
    return WebRpcControlRole.control
  }
}

/** Returns the first native provider admission failure without touching Host state. */
export function preflightNativeProviderClaims(
  definitions: readonly IWebRpcNativeProviderClaimSource[]
): { readonly failedName: string; readonly error: WebRpcConfigurationError } | undefined {
  for (const definition of definitions) {
    try {
      assertNativeProviderClaims(snapshotNativeProviderClaims(definition))
    } catch (error) {
      if (error instanceof WebRpcConfigurationError)
        return Object.freeze({ failedName: definition.name, error })
      return Object.freeze({
        failedName: safeProviderName(definition),
        error:
          error instanceof WebRpcConfigurationError
            ? error
            : new WebRpcConfigurationError(
                roleAdmissionMessage(WebRpcProviderRole.provider, 'claims', undefined),
                error
              )
      })
    }
  }
  return undefined
}

/** Reads each native admission field once so hostile accessors cannot bypass a fixed cutoff. */
function snapshotNativeProviderClaims(
  source: IWebRpcNativeProviderClaimSource
): IWebRpcNativeProviderClaimSource {
  let name: string = WebRpcProviderRole.provider
  try {
    name = source.name
    return {
      name,
      claims: source.claims,
      sharedProvides: source.sharedProvides,
      sharedConsumes: source.sharedConsumes
    }
  } catch (error) {
    throw new WebRpcConfigurationError(roleAdmissionMessage(name, 'claims', undefined), error)
  }
}

/** Returns a stable failure label without rethrowing a hostile name accessor. */
function safeProviderName(source: IWebRpcNativeProviderClaimSource): string {
  try {
    return typeof source.name === 'string' ? source.name : WebRpcProviderRole.provider
  } catch {
    return WebRpcProviderRole.provider
  }
}

/** Builds the stable, non-identity-bearing message used for first-party role admission. */
function roleAdmissionMessage(role: string, slot: string, key: PropertyKey | undefined): string {
  const safeKey =
    key === undefined
      ? 'unavailable'
      : typeof key === 'symbol'
        ? `symbol:${key.description ?? '<anonymous>'}`
        : `string:${key}`
  return `${WebRpcErrorText.endpointModuleInvalid}; role=${role}; slot=${slot}; key=${safeKey}`
}

/** Confirms that Host publication and kernel routes still match the admitted static manifest. */
export function assertPluginClaimParity(
  claims: readonly IWebRpcPluginClaims[],
  descriptors: readonly IWebRpcPluginDescriptor[],
  host: object,
  kernel: IEndpointKernelHost,
  runtime: {
    readonly activated: boolean
    readonly activationPhase?: 'pre-activation' | 'post-activation'
    readonly routeKeys?: readonly string[]
    readonly translated?: readonly IWebRpcTranslatedPlugin[]
    readonly onMismatch?: (error: WebRpcConfigurationError) => never
  }
): void {
  const fail = (): never => {
    const error = new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
    runtime.onMismatch?.(error)
    throw error
  }
  const sharedHost = host as { readonly getShared?: (key: PropertyKey) => unknown }
  const activatorCount = claims.filter((claim) => claim.activator).length
  if (runtime.activationPhase === 'pre-activation') {
    if (!runtime.activated || activatorCount !== 1) fail()
  } else if (runtime.activated !== (activatorCount === 1)) fail()
  for (const key of descriptors.flatMap((descriptor) => descriptor.sharedProvides ?? []))
    if (sharedHost.getShared?.(key) === undefined) fail()
  for (const key of descriptors.flatMap((descriptor) => descriptor.sharedConsumes ?? []))
    if (sharedHost.getShared?.(key) === undefined) fail()
  for (const key of descriptors.flatMap((descriptor) => descriptor.sharedOptionalConsumes ?? []))
    if (
      descriptors.some((descriptor) => descriptor.sharedProvides?.includes(key)) &&
      sharedHost.getShared?.(key) === undefined
    )
      fail()
  for (const [index, translated] of runtime.translated?.entries() ?? []) {
    const runtimeKeys = translated.getRuntimeKeys()
    const expectedExtension = new Set<PropertyKey>(claims[index]?.publicKeys ?? [])
    const expectedShared = new Set<PropertyKey>(descriptors[index]?.sharedProvides ?? [])
    if (
      runtimeKeys.extension.length !== expectedExtension.size ||
      runtimeKeys.extension.some((key) => !expectedExtension.has(key)) ||
      runtimeKeys.shared.length !== expectedShared.size ||
      runtimeKeys.shared.some((key) => !expectedShared.has(key))
    )
      fail()
    for (const key of expectedShared)
      if (!Object.is(runtimeKeys.actualSharedValues[key], runtimeKeys.expectedSharedValues[key]))
        fail()
  }
  const expectedRoutes = new Set(claims.flatMap((claim) => claim.routes))
  const actualRoutes = runtime.routeKeys ?? kernel.routeKeys
  if (
    expectedRoutes.size !== actualRoutes.length ||
    actualRoutes.some((route) => !expectedRoutes.has(route))
  )
    fail()
  for (const key of new Set(claims.flatMap((claim) => claim.exposedKeys))) {
    const descriptor = Object.getOwnPropertyDescriptor(host, key)
    if (!descriptor || !('value' in descriptor)) fail()
  }
}

/**
 * Converts one already-admitted domain descriptor into the sole permanent PluginHost boundary. The
 * conversion owns no cross-install state: one closure captures this plugin's extension only;
 * construction scope registration, resource ownership, shared publication, rollback, and error
 * aggregation remain PluginHost responsibilities.
 */
export function toPluginHostDefinition<TInstallation>(
  descriptor: IWebRpcPluginDescriptor<TInstallation>,
  claims: IWebRpcPluginClaims,
  context: IWebRpcPluginTranslationContext = {}
): IWebRpcTranslatedPlugin<TInstallation> {
  /** Captured result is read only after this plugin's install has completed. */
  let installation: TInstallation | undefined
  let installationObserved = false
  let liveInstallation: TInstallation | undefined
  let liveInstallationObserved = false
  let runtimeKeys: IWebRpcPluginRuntimeKeys = {
    extension: [],
    shared: [],
    expectedSharedValues: {},
    actualSharedValues: {}
  }
  let liveRuntimeKeys: IWebRpcPluginRuntimeKeys = {
    extension: [],
    shared: [],
    expectedSharedValues: {},
    actualSharedValues: {}
  }
  /** Clears live markers after Host rollback or terminal disposal while retaining history. */
  const clearLiveRuntimeMarkers = (): void => {
    liveInstallation = undefined
    liveInstallationObserved = false
    liveRuntimeKeys = {
      extension: [],
      shared: [],
      expectedSharedValues: {},
      actualSharedValues: {}
    }
  }
  const definition = {
    name: descriptor.name,
    claims,
    sharedProvides: descriptor.sharedProvides,
    sharedConsumes: descriptor.sharedConsumes,
    install: async (core: IWebRpcPluginCore & IWebRpcPluginHostCore) => {
      assertNativeProviderClaims(snapshotNativeProviderClaims({ ...descriptor, claims }))
      /** Snapshots the construction reporter before asynchronous installation begins. */
      const hooksPort = core.getShared(WebRpcSharedKey.hooks) as IWebRpcHooksPort | undefined
      const constructionReporter = hooksPort?.reportConstructionDiagnostic
      /** Routes late construction diagnostics through the configured hook boundary. */
      const report =
        context.report ??
        (constructionReporter
          ? (error: unknown): void => {
              constructionReporter({
                name: 'failure',
                at: core.construction.time.now(),
                localId: core.id,
                code: WebRpcErrorCode.internal,
                error
              })
            }
          : (error: unknown): void => {
              core.hooks({
                name: 'failure',
                at: core.construction.time.now(),
                localId: core.id,
                code: WebRpcErrorCode.internal,
                error
              })
            })
      return runConstructionInstall(
        {
          id: core.id,
          transport: core.transport,
          control: core.construction,
          hooks: core.hooks,
          getShared: (key) => core.getShared(key),
          report,
          registerScope: (_scope, close, awaitClose) => {
            core.onDispose(async () => {
              close()
              await awaitClose()
            })
          }
        },
        async (scope) => {
          const result = await descriptor.install({
            ...scope,
            getShared: (key) => core.getShared(key)
          })
          installation = result
          installationObserved = true
          liveInstallation = result
          liveInstallationObserved = true
          const disposerProperty =
            result !== null && typeof result === 'object'
              ? Object.getOwnPropertyDescriptor(result, 'dispose')
              : undefined
          scope.own({}, async () => {
            try {
              if (descriptor.disposeResult !== false && disposerProperty) {
                const disposer = (result as { readonly dispose?: unknown }).dispose
                if (typeof disposer === 'function') await (disposer as () => void | Promise<void>)()
              }
            } finally {
              let observerThrew = false
              let observerError: unknown
              try {
                context.onTransferredCleanup?.(descriptor.name)
              } catch (error) {
                observerThrew = true
                observerError = error
              }
              try {
                clearLiveRuntimeMarkers()
              } finally {
                if (observerThrew) {
                  try {
                    context.report?.(observerError)
                  } catch {
                    // Observer reporting is diagnostic-only and cannot affect disposal.
                  }
                }
              }
            }
          })
          context.onInstalled?.(result)
          let extension: Record<string, unknown> = {}
          for (const key of claims.publicKeys) {
            const property = Object.getOwnPropertyDescriptor(result as object, key)
            if (!property || !('value' in property))
              throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
            Object.defineProperty(extension, key, {
              configurable: true,
              enumerable: true,
              value: property.value,
              writable: true
            })
          }
          const injectedExtension = descriptor.runtimeOutput?.('extension', extension)
          runtimeKeys = {
            ...runtimeKeys,
            extension: Reflect.ownKeys(injectedExtension ?? extension)
          }
          liveRuntimeKeys = runtimeKeys
          return injectedExtension ?? extension
        }
      )
    },
    ...(descriptor.shared
      ? {
          shared: () => {
            if (installation === undefined)
              throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
            const shared = descriptor.shared!(installation)
            const injectedShared = descriptor.runtimeOutput?.('shared', shared)
            const output = injectedShared ?? shared
            runtimeKeys = {
              ...runtimeKeys,
              shared: Reflect.ownKeys(output),
              expectedSharedValues: shared,
              actualSharedValues: output
            }
            liveRuntimeKeys = runtimeKeys
            return descriptor.preserveRuntimeOutputForHost ? shared : output
          }
        }
      : {})
  } as IPluginConstraint<IWebRpcPluginCore & IWebRpcPluginHostCore> & {
    readonly claims: IWebRpcPluginClaims
  }
  return {
    definition,
    getInstallation: () => installation,
    getLiveInstallation: () => liveInstallation,
    getInstallationObservation: () =>
      Object.freeze({ installed: installationObserved, value: installation }),
    getLiveInstallationObservation: () =>
      Object.freeze({ installed: liveInstallationObserved, value: liveInstallation }),
    getRuntimeKeys: () => runtimeKeys,
    getLiveRuntimeMarkers: () => liveRuntimeKeys
  }
}
