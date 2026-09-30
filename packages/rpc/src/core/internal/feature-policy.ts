import { RpcConfigurationError, RpcError, RpcCoreErrorCode } from '../errors.js'
import { RpcCoreErrorText, roleAdmissionMessage } from '../error-text.js'
import type { IRpcFeature } from '../feature.js'
import type { IRpcPluginClaims } from '../typing.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import {
  RpcControlRole,
  RpcControlRoleSchema,
  RpcFirstPartyRoleSchema,
  RpcProviderRole
} from './plugin-contract.js'
import { RpcPortName } from './plugin-shared-keys.js'
import { isManagedHost, openComposition } from '@migaia/plugin-host/composition'

/** Static metadata read by the pure WebRPC admission gate before Host construction. */
export type IRpcClaimAdmission = Readonly<{
  readonly name: string
  readonly claims: IRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}>

/** Static role data inspected before PluginHost mutates its installation transaction. */
export type IRpcNativeRoleClaimSource = Readonly<{
  readonly name: string
  readonly claims?: IRpcPluginClaims
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}>

/** Static WebRPC-only policy; Feature identity and dependency topology remain PluginHost-owned. */
export type IRpcFeaturePolicy = Readonly<{
  readonly publicKeys?: readonly string[]
  readonly conflicts: readonly string[]
  readonly firstPartyClaims?: IRpcPluginClaims
  /** Immutable shared-port requirements read from the native Feature entry during admission. */
  readonly sharedConsumes?: readonly PropertyKey[]
}>

/** Domain metadata store intentionally does not own Feature identity, closure, or runtime instances. */
const policies = new WeakMap<object, IRpcFeaturePolicy>()

/** Attaches the one immutable domain policy captured with a public Feature declaration. */
export const registerFeaturePolicy = (
  feature: IRpcFeature,
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
export const readFeaturePolicy = (feature: IRpcFeature): IRpcFeaturePolicy =>
  policies.get(feature) ?? EMPTY_POLICY

/** Records package-owned first-party claims without widening the public Feature definition API. */
export const registerFirstPartyFeaturePolicy = (
  feature: IRpcFeature,
  claims: IRpcPluginClaims
): void => {
  const policy = readFeaturePolicy(feature)
  policies.set(feature, Object.freeze({ ...policy, firstPartyClaims: freezeClaims(claims) }))
}

/** Binds trusted native policy and claims in one immutable write during first-party definition. */
export const registerPrivateFeaturePolicy = (
  feature: IRpcFeature,
  source: Readonly<{
    readonly publicKeys?: readonly string[]
    readonly conflicts?: readonly string[]
    readonly sharedConsumes?: readonly PropertyKey[]
  }>,
  claims: IRpcPluginClaims
): void => {
  policies.set(
    feature,
    Object.freeze({ ...snapshotPolicy(source), firstPartyClaims: freezeClaims(claims) })
  )
}

/** Keeps no-policy declarations allocation-free and immutable. */
const EMPTY_POLICY: IRpcFeaturePolicy = Object.freeze({ conflicts: Object.freeze([]) })

/** Copies data-only policy declarations without evaluating user accessors during endpoint admission. */
function snapshotPolicy(
  source: Readonly<{
    readonly publicKeys?: readonly string[]
    readonly conflicts?: readonly string[]
    readonly sharedConsumes?: readonly PropertyKey[]
  }>
): IRpcFeaturePolicy {
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
function freezeClaims(claims: IRpcPluginClaims): IRpcPluginClaims {
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
export function createInvalidFeatureError(): RpcError {
  return new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
}

/**
 * Validates static WebRPC publication and sharing claims without consulting any lifecycle owner.
 * Both native middleware and transitional descriptors use this one policy gate.
 */
export function preflightFeatureClaims(
  definitions: readonly IRpcClaimAdmission[],
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
  let current: IRpcClaimAdmission | undefined
  try {
    for (const definition of admitted) {
      current = definition
      const { claims } = definition
      if (definition.name.length === 0 || names.has(definition.name))
        throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      names.add(definition.name)
      const roleName = definition.name.replace(/^middleware:/, '')
      const expectedCancellationKey =
        roleName === 'timeout'
          ? RpcPortName.timeout
          : roleName === 'abort'
            ? RpcPortName.abort
            : undefined
      if (
        expectedCancellationKey !== undefined &&
        (definition.sharedProvides?.length !== 1 ||
          definition.sharedProvides[0] !== expectedCancellationKey)
      )
        throw new RpcConfigurationError(
          roleAdmissionMessage(roleName, 'sharedProvides', definition.sharedProvides?.[0])
        )
      const roleSchema =
        (definition.name.startsWith('middleware:') || definition.name === 'middleware-finalize') &&
        roleName in RpcFirstPartyRoleSchema
          ? RpcFirstPartyRoleSchema[roleName as keyof typeof RpcFirstPartyRoleSchema]
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
            throw new RpcConfigurationError(roleAdmissionMessage(roleName, slot, actual?.[0]))
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
        throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      if (claims.activator) activators += 1
      for (const provided of definition.sharedProvides ?? [])
        if (
          admitted.some(
            (item) => item !== definition && item.sharedProvides?.includes(provided) === true
          )
        )
          throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      for (const consumed of definition.sharedConsumes ?? [])
        if (!admitted.some((item) => item.sharedProvides?.includes(consumed) === true))
          throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      for (const route of claims.routes) {
        if (routes.has(route))
          throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        routes.add(route)
      }
      for (const provided of claims.provides) {
        if (provides.has(provided))
          throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        provides.add(provided)
      }
      for (const publicKey of claims.publicKeys) {
        if (publicKeys.has(publicKey))
          throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        publicKeys.add(publicKey)
      }
      if (requireCompleteGraph) {
        for (const exposedKey of claims.exposedKeys)
          if (
            !publicKeys.has(exposedKey) &&
            !admitted.some((item) => item.claims.publicKeys.includes(exposedKey))
          )
            throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        for (const consumed of claims.consumes)
          if (!admitted.some((item) => item.claims.provides.includes(consumed)))
            throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      }
    }
  } catch (error) {
    if (error instanceof RpcConfigurationError) throw error
    throw new RpcConfigurationError(
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
    throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
}

/** Snapshots every native admission field once so hostile getters retain their exact role and slot. */
function snapshotFeatureClaimAdmission(source: IRpcClaimAdmission): IRpcClaimAdmission {
  let name = 'unknown'
  try {
    name = source.name
  } catch (error) {
    throw new RpcConfigurationError(roleAdmissionMessage(name, 'name', undefined), error)
  }
  const read = <T>(slot: string, value: () => T): T => {
    try {
      return value()
    } catch (error) {
      throw new RpcConfigurationError(
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

/** Returns the first provider/control role violation without giving it a Host lifecycle owner. */
export function preflightNativeRoleClaims(
  definitions: readonly IRpcNativeRoleClaimSource[]
): { readonly failedName: string; readonly error: RpcConfigurationError } | undefined {
  for (const definition of definitions) {
    const snapshot = snapshotRoleClaimSource(definition)
    try {
      assertNativeProviderRole(snapshot)
      assertNativeControlRole(snapshot)
    } catch (error) {
      return Object.freeze({
        failedName: snapshot.name,
        error:
          error instanceof RpcConfigurationError
            ? error
            : new RpcConfigurationError(
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
  definitions: readonly IRpcClaimAdmission[],
  host: object,
  kernel: IEndpointKernelHost,
  runtime: Readonly<{
    readonly activated: boolean
    readonly activationPhase?: 'pre-activation' | 'post-activation'
    readonly routeKeys?: readonly string[]
  }>
): void {
  const fail = (): never => {
    throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
  }
  const claims = definitions.map((definition) => definition.claims)
  const activatorCount = claims.filter((claim) => claim.activator).length
  if (runtime.activationPhase === 'pre-activation') {
    if (!runtime.activated || activatorCount !== 1) fail()
  } else if (runtime.activated !== (activatorCount === 1)) fail()
  const sharedHost = host as { readonly getPort?: (key: PropertyKey) => unknown }
  for (const key of definitions.flatMap((definition) => definition.sharedProvides ?? []))
    if (sharedHost.getPort?.(key) === undefined) fail()
  for (const key of definitions.flatMap((definition) => definition.sharedConsumes ?? []))
    if (sharedHost.getPort?.(key) === undefined) fail()
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
    const internalReader = (host as { readonly getCurrentExtensions?: () => object })
      .getCurrentExtensions
    if (internalReader) return internalReader()
    if (isManagedHost(host)) return openComposition(host).getCurrentSnapshot().extensions
    const extensions = (host as { readonly extensions?: unknown }).extensions
    if (extensions !== null && (typeof extensions === 'object' || typeof extensions === 'function'))
      return extensions
  } catch {
    // A revoked Host view fails closed through the policy error below.
  }
  throw new RpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
}

/** Reads hostile declaration accessors once, preserving the pre-Host cutoff. */
function snapshotRoleClaimSource(source: IRpcNativeRoleClaimSource): IRpcNativeRoleClaimSource {
  let name: string = RpcProviderRole.provider
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
    throw new RpcConfigurationError(roleAdmissionMessage(name, 'claims', undefined), error)
  }
}

/** Enforces the native provider port contract at the sole static WebRPC admission point. */
function assertNativeProviderRole(source: IRpcNativeRoleClaimSource): void {
  if (source.name !== RpcProviderRole.provider || source.claims === undefined) return
  const nativeClaim =
    source.sharedProvides?.some((key) => key === RpcPortName.providerCancellation) === true ||
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
  throw new RpcConfigurationError(
    roleAdmissionMessage(RpcProviderRole.provider, 'claims', undefined)
  )
}

/** Enforces the native control port contract before PluginHost receives the definition. */
function assertNativeControlRole(source: IRpcNativeRoleClaimSource): void {
  if (source.name !== RpcControlRole.control || source.claims === undefined) return
  const schema = RpcControlRoleSchema[RpcControlRole.control]
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
    throw new RpcConfigurationError(roleAdmissionMessage(role, slot, actual?.[0]))
}
