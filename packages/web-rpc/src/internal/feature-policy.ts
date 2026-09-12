import { WebRpcConfigurationError, WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IWebRpcFeature } from '../feature.js'
import type { IWebRpcPluginClaims } from '../typing.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import {
  WebRpcControlRole,
  WebRpcControlRoleSchema,
  WebRpcFirstPartyRoleSchema,
  WebRpcProviderRole
} from './plugin-contract.js'
import { WebRpcSharedKey } from './plugin-shared-keys.js'

/** Static metadata read by the pure WebRPC admission gate before Host construction. */
export type IWebRpcClaimAdmission = Readonly<{
  readonly name: string
  readonly claims: IWebRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}>

/** Static role data inspected before PluginHost mutates its installation transaction. */
export type IWebRpcNativeRoleClaimSource = Readonly<{
  readonly name: string
  readonly claims?: IWebRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}>

/** Static WebRPC-only policy; Feature identity and dependency topology remain PluginHost-owned. */
export type IWebRpcFeaturePolicy = Readonly<{
  readonly publicKeys?: readonly string[]
  readonly conflicts: readonly string[]
  readonly firstPartyClaims?: IWebRpcPluginClaims
  /** Immutable shared-port requirements read from the native Feature entry during admission. */
  readonly sharedConsumes?: readonly PropertyKey[]
}>

/** Domain metadata store intentionally does not own Feature identity, closure, or runtime instances. */
const policies = new WeakMap<object, IWebRpcFeaturePolicy>()

/** Attaches the one immutable domain policy captured with a public Feature declaration. */
export const registerFeaturePolicy = (
  feature: IWebRpcFeature,
  source: Readonly<{
    readonly publicKeys?: readonly string[]
    readonly conflicts?: readonly string[]
  }>
): void => {
  policies.set(feature, snapshotPolicy(source))
}

/**
 * Returns static policy for one trusted public Feature; absent policy means dynamic output
 * projection.
 */
export const readFeaturePolicy = (feature: IWebRpcFeature): IWebRpcFeaturePolicy =>
  policies.get(feature) ?? EMPTY_POLICY

/** Records package-owned first-party claims without widening the public Feature definition API. */
export const registerFirstPartyFeaturePolicy = (
  feature: IWebRpcFeature,
  claims: IWebRpcPluginClaims
): void => {
  const policy = readFeaturePolicy(feature)
  policies.set(feature, Object.freeze({ ...policy, firstPartyClaims: freezeClaims(claims) }))
}

/** Binds trusted native policy and claims in one immutable write during first-party definition. */
export const registerPrivateFeaturePolicy = (
  feature: IWebRpcFeature,
  source: Readonly<{
    readonly publicKeys?: readonly string[]
    readonly conflicts?: readonly string[]
    readonly sharedConsumes?: readonly PropertyKey[]
  }>,
  claims: IWebRpcPluginClaims
): void => {
  policies.set(
    feature,
    Object.freeze({ ...snapshotPolicy(source), firstPartyClaims: freezeClaims(claims) })
  )
}

/** Keeps no-policy declarations allocation-free and immutable. */
const EMPTY_POLICY: IWebRpcFeaturePolicy = Object.freeze({ conflicts: Object.freeze([]) })

/** Copies data-only policy declarations without evaluating user accessors during endpoint admission. */
function snapshotPolicy(
  source: Readonly<{
    readonly publicKeys?: readonly string[]
    readonly conflicts?: readonly string[]
    readonly sharedConsumes?: readonly PropertyKey[]
  }>
): IWebRpcFeaturePolicy {
  const descriptors = Object.getOwnPropertyDescriptors(source)
  if (Reflect.ownKeys(source).some((key) => typeof key !== 'string'))
    throw createInvalidFeatureError()
  for (const key of Reflect.ownKeys(source)) {
    const descriptor = descriptors[key as string]
    if (!descriptor || !('value' in descriptor)) throw createInvalidFeatureError()
  }
  const read = <T>(key: string): T | undefined => descriptors[key]?.value as T | undefined
  return Object.freeze({
    ...(read<readonly string[]>('publicKeys') === undefined
      ? {}
      : { publicKeys: freezeStrings(read<readonly string[]>('publicKeys')!) }),
    ...(read<readonly PropertyKey[]>('sharedConsumes') === undefined
      ? {}
      : { sharedConsumes: freezePropertyKeys(read<readonly PropertyKey[]>('sharedConsumes')!) }),
    conflicts: freezeStrings(read<readonly string[]>('conflicts') ?? [])
  })
}

/** Freezes declared endpoint names before composition can observe caller-owned arrays. */
function freezeStrings(values: readonly string[]): readonly string[] {
  if (
    !Array.isArray(values) ||
    values.some((value) => typeof value !== 'string' || value.length === 0) ||
    new Set(values).size !== values.length
  )
    throw createInvalidFeatureError()
  return Object.freeze([...values])
}

/** Freezes native shared-port symbols while rejecting duplicate or forged admission arrays. */
function freezePropertyKeys(values: readonly PropertyKey[]): readonly PropertyKey[] {
  if (!Array.isArray(values) || new Set(values).size !== values.length)
    throw createInvalidFeatureError()
  return Object.freeze([...values])
}

/** Freezes every array in a trusted internal claim declaration before inventory admission. */
function freezeClaims(claims: IWebRpcPluginClaims): IWebRpcPluginClaims {
  return Object.freeze({
    routes: freezeStrings(claims.routes),
    provides: freezeStrings(claims.provides),
    consumes: freezeStrings(claims.consumes),
    publicKeys: freezeStrings(claims.publicKeys),
    exposedKeys: freezeStrings(claims.exposedKeys),
    activator: claims.activator
  })
}

/** Uses the existing package error contract for invalid public Feature declarations. */
export function createInvalidFeatureError(): WebRpcError {
  return new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
}

/**
 * Validates static WebRPC publication and sharing claims without consulting any lifecycle owner.
 * Both native middleware and transitional descriptors use this one policy gate.
 */
export function preflightFeatureClaims(
  definitions: readonly IWebRpcClaimAdmission[],
  options: Readonly<{ readonly requireCompleteGraph?: boolean }> = {}
): void {
  const requireCompleteGraph = options.requireCompleteGraph ?? true
  /** Freeze hostile admission fields before cross-record checks can misattribute their owner. */
  const admitted = definitions.map(snapshotFeatureClaimAdmission)
  const names = new Set<string>()
  const routes = new Set<string>()
  const provides = new Set<string>()
  const publicKeys = new Set<string>()
  let activators = 0
  let current: IWebRpcClaimAdmission | undefined
  try {
    for (const definition of admitted) {
      current = definition
      const { claims } = definition
      if (definition.name.length === 0 || names.has(definition.name))
        throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      names.add(definition.name)
      const roleName = definition.name.replace(/^middleware:/, '')
      const expectedCancellationKey =
        roleName === 'timeout'
          ? WebRpcSharedKey.timeout
          : roleName === 'abort'
            ? WebRpcSharedKey.abort
            : undefined
      if (
        expectedCancellationKey !== undefined &&
        (definition.sharedProvides?.length !== 1 ||
          definition.sharedProvides[0] !== expectedCancellationKey)
      )
        throw new WebRpcConfigurationError(
          roleAdmissionMessage(roleName, 'sharedProvides', definition.sharedProvides?.[0])
        )
      const roleSchema =
        (definition.name.startsWith('middleware:') || definition.name === 'middleware-finalize') &&
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
            actual?.some((key, index) => key !== expected[index])
          )
            throw new WebRpcConfigurationError(roleAdmissionMessage(roleName, slot, actual?.[0]))
        }
        assertExactKeys('sharedProvides', definition.sharedProvides, roleSchema.sharedProvides)
        assertExactKeys('sharedConsumes', definition.sharedConsumes, roleSchema.sharedConsumes)
        assertExactKeys(
          'sharedOptionalConsumes',
          definition.sharedOptionalConsumes,
          roleSchema.sharedOptionalConsumes
        )
      }
      if (definition.sharedProvides?.some((key) => definition.sharedConsumes?.includes(key)))
        throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      if (claims.activator) activators += 1
      for (const provided of definition.sharedProvides ?? [])
        if (
          admitted.some(
            (item) => item !== definition && item.sharedProvides?.includes(provided) === true
          )
        )
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      for (const consumed of definition.sharedConsumes ?? [])
        if (!admitted.some((item) => item.sharedProvides?.includes(consumed) === true))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      for (const route of claims.routes) {
        if (routes.has(route))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        routes.add(route)
      }
      for (const provided of claims.provides) {
        if (provides.has(provided))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        provides.add(provided)
      }
      for (const publicKey of claims.publicKeys) {
        if (publicKeys.has(publicKey))
          throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        publicKeys.add(publicKey)
      }
      if (requireCompleteGraph) {
        for (const exposedKey of claims.exposedKeys)
          if (
            !publicKeys.has(exposedKey) &&
            !admitted.some((item) => item.claims.publicKeys.includes(exposedKey))
          )
            throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
        for (const consumed of claims.consumes)
          if (!admitted.some((item) => item.claims.provides.includes(consumed)))
            throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
      }
    }
  } catch (error) {
    if (error instanceof WebRpcConfigurationError) throw error
    throw new WebRpcConfigurationError(
      roleAdmissionMessage(
        current?.name.replace(/^middleware:/, '') ?? 'unknown',
        'claims',
        undefined
      ),
      error
    )
  }
  if (
    requireCompleteGraph &&
    admitted.some((definition) => definition.claims.routes.length > 0) &&
    activators !== 1
  )
    throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
}

/** Snapshots every native admission field once so hostile getters retain their exact role and slot. */
function snapshotFeatureClaimAdmission(source: IWebRpcClaimAdmission): IWebRpcClaimAdmission {
  let name = 'unknown'
  try {
    name = source.name
  } catch (error) {
    throw new WebRpcConfigurationError(roleAdmissionMessage(name, 'name', undefined), error)
  }
  const read = <T>(slot: string, value: () => T): T => {
    try {
      return value()
    } catch (error) {
      throw new WebRpcConfigurationError(
        roleAdmissionMessage(name.replace(/^middleware:/, ''), slot, undefined),
        error
      )
    }
  }
  return Object.freeze({
    name,
    claims: read('claims', () => source.claims),
    sharedProvides: read('sharedProvides', () => source.sharedProvides),
    sharedConsumes: read('sharedConsumes', () => source.sharedConsumes),
    sharedOptionalConsumes: read('sharedOptionalConsumes', () => source.sharedOptionalConsumes)
  })
}

/** Builds the stable role-admission diagnostic shared by pure policy checks. */
export function roleAdmissionMessage(
  role: string,
  slot: string,
  key: PropertyKey | undefined
): string {
  const safeKey =
    key === undefined
      ? 'unavailable'
      : typeof key === 'symbol'
        ? `symbol:${key.description ?? '<anonymous>'}`
        : `string:${key}`
  return `${WebRpcErrorText.endpointModuleInvalid}; role=${role}; slot=${slot}; key=${safeKey}`
}

/** Returns the first provider/control role violation without giving it a Host lifecycle owner. */
export function preflightNativeRoleClaims(
  definitions: readonly IWebRpcNativeRoleClaimSource[]
): { readonly failedName: string; readonly error: WebRpcConfigurationError } | undefined {
  for (const definition of definitions) {
    const snapshot = snapshotRoleClaimSource(definition)
    try {
      assertNativeProviderRole(snapshot)
      assertNativeControlRole(snapshot)
    } catch (error) {
      return Object.freeze({
        failedName: snapshot.name,
        error:
          error instanceof WebRpcConfigurationError
            ? error
            : new WebRpcConfigurationError(
                roleAdmissionMessage(snapshot.name, 'claims', undefined),
                error
              )
      })
    }
  }
  return undefined
}

/** Confirms the direct Host batch still publishes the static WebRPC contract after installation. */
export function assertFeatureClaimParity(
  definitions: readonly IWebRpcClaimAdmission[],
  host: object,
  kernel: IEndpointKernelHost,
  runtime: Readonly<{
    readonly activated: boolean
    readonly activationPhase?: 'pre-activation' | 'post-activation'
    readonly routeKeys?: readonly string[]
  }>
): void {
  const fail = (): never => {
    throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
  }
  const claims = definitions.map((definition) => definition.claims)
  const activatorCount = claims.filter((claim) => claim.activator).length
  if (runtime.activationPhase === 'pre-activation') {
    if (!runtime.activated || activatorCount !== 1) fail()
  } else if (runtime.activated !== (activatorCount === 1)) fail()
  const sharedHost = host as { readonly getShared?: (key: PropertyKey) => unknown }
  for (const key of definitions.flatMap((definition) => definition.sharedProvides ?? []))
    if (sharedHost.getShared?.(key) === undefined) fail()
  for (const key of definitions.flatMap((definition) => definition.sharedConsumes ?? []))
    if (sharedHost.getShared?.(key) === undefined) fail()
  const expectedRoutes = new Set(claims.flatMap((claim) => claim.routes))
  const actualRoutes = runtime.routeKeys ?? kernel.routeKeys
  if (
    expectedRoutes.size !== actualRoutes.length ||
    actualRoutes.some((route) => !expectedRoutes.has(route))
  )
    fail()
  if (runtime.activationPhase === 'pre-activation') return
  const publication = readPublishedFeatureExtensions(host)
  for (const key of new Set(claims.flatMap((claim) => claim.exposedKeys))) {
    const descriptor = Object.getOwnPropertyDescriptor(publication, key)
    if (!descriptor || !('value' in descriptor)) fail()
  }
}

/** Reads the immutable PluginHost view without becoming another publication owner. */
function readPublishedFeatureExtensions(host: object): object {
  try {
    const extensions = (host as { readonly extensions?: unknown }).extensions
    if (extensions !== null && (typeof extensions === 'object' || typeof extensions === 'function'))
      return extensions
  } catch {
    // A revoked Host view fails closed through the policy error below.
  }
  throw new WebRpcConfigurationError(WebRpcErrorText.endpointModuleInvalid)
}

/** Reads hostile declaration accessors once, preserving the pre-Host cutoff. */
function snapshotRoleClaimSource(
  source: IWebRpcNativeRoleClaimSource
): IWebRpcNativeRoleClaimSource {
  let name: string = WebRpcProviderRole.provider
  try {
    name = source.name
    return Object.freeze({
      name,
      claims: source.claims,
      sharedProvides: source.sharedProvides,
      sharedConsumes: source.sharedConsumes,
      sharedOptionalConsumes: source.sharedOptionalConsumes
    })
  } catch (error) {
    throw new WebRpcConfigurationError(roleAdmissionMessage(name, 'claims', undefined), error)
  }
}

/** Enforces the native provider port contract at the sole static WebRPC admission point. */
function assertNativeProviderRole(source: IWebRpcNativeRoleClaimSource): void {
  if (source.name !== WebRpcProviderRole.provider || source.claims === undefined) return
  const nativeClaim =
    source.sharedProvides?.some((key) => key === WebRpcSharedKey.providerCancellation) === true ||
    (source.sharedConsumes?.length ?? 0) > 0
  const claims = source.claims
  const candidate =
    nativeClaim ||
    (source.sharedProvides?.length ?? 0) > 0 ||
    (source.sharedConsumes?.length ?? 0) > 0 ||
    claims.routes.includes('request') ||
    claims.publicKeys.includes('provide') ||
    claims.exposedKeys.includes('provide')
  if (!candidate) return
  /** Public plugin descriptors never mint the package-private provider Feature policy. */
  throw new WebRpcConfigurationError(
    roleAdmissionMessage(WebRpcProviderRole.provider, 'claims', undefined)
  )
}

/** Enforces the native control port contract before PluginHost receives the definition. */
function assertNativeControlRole(source: IWebRpcNativeRoleClaimSource): void {
  if (source.name !== WebRpcControlRole.control || source.claims === undefined) return
  const schema = WebRpcControlRoleSchema[WebRpcControlRole.control]
  assertExactRoleKeys('control', 'sharedProvides', source.sharedProvides, schema.sharedProvides)
  assertExactRoleKeys('control', 'sharedConsumes', source.sharedConsumes, schema.sharedConsumes)
  assertExactRoleKeys(
    'control',
    'sharedOptionalConsumes',
    source.sharedOptionalConsumes ?? [],
    schema.sharedOptionalConsumes
  )
}

/** Uses positional equality because shared-port ordering is part of the domain contract. */
function assertExactRoleKeys(
  role: 'provider' | 'control',
  slot: 'sharedProvides' | 'sharedConsumes' | 'sharedOptionalConsumes',
  actual: readonly PropertyKey[] | undefined,
  expected: readonly PropertyKey[]
): void {
  if (actual?.length !== expected.length || actual.some((key, index) => key !== expected[index]))
    throw new WebRpcConfigurationError(roleAdmissionMessage(role, slot, actual?.[0]))
}
