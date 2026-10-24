import {
  createRpcConfigurationError,
  createRpcError,
  isLocalRpcError,
  RpcConfigurationError,
  RpcCoreErrorCode,
  RpcError
} from '../errors.js'

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
  return createRpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
}

/** Snapshot indexes lend only membership facts to the original ordered validation pass. */
type IFeatureClaimIndex = Readonly<{
  sharedOwners: ReadonlyMap<PropertyKey, IRpcClaimAdmission | false>
  declaredProvides: ReadonlySet<string>
  declaredPublicKeys: ReadonlySet<string>
}>

/** Index already snapshotted cross-record claims once without changing rejection precedence. */
function indexFeatureClaims(admitted: readonly IRpcClaimAdmission[]): IFeatureClaimIndex {
  /** Complete sharing indexes are read only after every hostile declaration was snapshotted. */
  const sharedOwners = new Map<PropertyKey, IRpcClaimAdmission | false>()
  /** These complete inventories answer cross-record claims while the validation loop keeps order. */
  const declaredProvides = new Set<string>()
  /** Future public keys are visible to valid expose claims without revisiting every declaration. */
  const declaredPublicKeys = new Set<string>()
  for (const definition of admitted) {
    for (const provided of definition.sharedProvides ?? []) {
      /** Repeated keys in the same declaration retain the original cross-owner-only check. */
      const previous = sharedOwners.get(provided)
      sharedOwners.set(
        provided,
        previous === undefined || previous === definition ? definition : false
      )
    }
    for (const provided of definition.claims.provides) declaredProvides.add(provided)
    for (const key of definition.claims.publicKeys) declaredPublicKeys.add(key)
  }
  return { sharedOwners, declaredProvides, declaredPublicKeys }
}

/**
 * Validate static publication and sharing claims in original order, without a lifecycle owner.
 * Native middleware and transitional descriptors share this same admission boundary.
 */
export function preflightFeatureClaims(
  definitions: readonly IRpcClaimAdmission[],
  options: Readonly<{ readonly requireCompleteGraph?: boolean }> = {}
): void {
  const requireCompleteGraph = options.requireCompleteGraph ?? true
  /** Freeze hostile admission fields before cross-record checks can misattribute their owner. */
  const admitted = definitions.map(snapshotFeatureClaimAdmission)
  const { sharedOwners, declaredProvides, declaredPublicKeys } = indexFeatureClaims(admitted)
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
        throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
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
        throw createRpcConfigurationError(
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
            throw createRpcConfigurationError(roleAdmissionMessage(roleName, slot, actual?.[0]))
        }
        assertExactKeys('sharedProvides', definition.sharedProvides, roleSchema.sharedProvides)
        assertExactKeys('sharedConsumes', definition.sharedConsumes, roleSchema.sharedConsumes)
        assertExactKeys(
          'sharedOptionalConsumes',
          definition.sharedOptionalConsumes,
          roleSchema.sharedOptionalConsumes
        )
      }
      /** Local self-consumption keeps its original rejection before cross-owner conflict checks. */
      const localConsumes = new Set(definition.sharedConsumes ?? [])
      if (definition.sharedProvides?.some((key) => localConsumes.has(key)))
        throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      if (claims.activator) activators += 1
      for (const provided of definition.sharedProvides ?? [])
        if (sharedOwners.get(provided) === false)
          throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      for (const consumed of definition.sharedConsumes ?? [])
        if (!sharedOwners.has(consumed))
          throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      for (const route of claims.routes) {
        if (routes.has(route))
          throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        routes.add(route)
      }
      for (const provided of claims.provides) {
        if (provides.has(provided))
          throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        provides.add(provided)
      }
      for (const publicKey of claims.publicKeys) {
        if (publicKeys.has(publicKey))
          throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        publicKeys.add(publicKey)
      }
      if (requireCompleteGraph) {
        for (const exposedKey of claims.exposedKeys)
          if (!publicKeys.has(exposedKey) && !declaredPublicKeys.has(exposedKey))
            throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
        for (const consumed of claims.consumes)
          if (!declaredProvides.has(consumed))
            throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
      }
    }
  } catch (error) {
    if (isLocalRpcError(error, RpcConfigurationError)) throw error
    throw createRpcConfigurationError(
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
    throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
}

/** Snapshots every native admission field once so hostile getters retain their exact role and slot. */
function snapshotFeatureClaimAdmission(source: IRpcClaimAdmission): IRpcClaimAdmission {
  let name = 'unknown'
  try {
    name = source.name
  } catch (error) {
    throw createRpcConfigurationError(roleAdmissionMessage(name, 'name', undefined), error)
  }
  const read = <T>(slot: string, value: () => T): T => {
    try {
      return value()
    } catch (error) {
      throw createRpcConfigurationError(
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
        error: isLocalRpcError(error, RpcConfigurationError)
          ? error
          : createRpcConfigurationError(
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
    throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
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
  throw createRpcConfigurationError(RpcCoreErrorText.endpointModuleInvalid)
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
    throw createRpcConfigurationError(roleAdmissionMessage(name, 'claims', undefined), error)
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
  throw createRpcConfigurationError(
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
    throw createRpcConfigurationError(roleAdmissionMessage(role, slot, actual?.[0]))
}
