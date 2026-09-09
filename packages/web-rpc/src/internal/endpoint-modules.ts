import { buildCapabilityTopology, type ITopologyNode } from '@migaia/capability/graph/topology'
import type { IWebRpcEndpointModule } from '../core.js'
import { WebRpcErrorText } from '../error-text.js'
import type { IEndpointKernelHost } from '../endpoint-kernel.js'
import type { IPreparedEndpoint } from './endpoint-bootstrap.js'
import type { IWebRpcAbortSignal, IWebRpcHookEvent } from '../typing.js'
import type { IWebRpcTransport } from '../transport.js'

/** Private runtime brand; no public constructor or minting path exists. */
type IPrivateEndpointDefinition = {
  readonly key: string
  readonly requires: readonly (string | IWebRpcEndpointModule)[]
  readonly conflicts: readonly string[]
  readonly claims: IEndpointModuleClaims
  readonly install: IEndpointModuleInstaller<unknown>
}

/** Static topology claims validated before middleware preparation or transport subscription. */
export type IEndpointModuleClaims = {
  readonly routes: readonly string[]
  readonly provides: readonly string[]
  readonly consumes: readonly string[]
  readonly publicKeys: readonly string[]
  /** Public keys exposed when this token is selected as a root. */
  readonly exposedKeys: readonly string[]
  readonly activator: boolean
  readonly sharedProvides?: readonly PropertyKey[]
  readonly sharedConsumes?: readonly PropertyKey[]
  readonly sharedOptionalConsumes?: readonly PropertyKey[]
}

/** Private marker used to defer ingress activation until composition commit. */
export const endpointModuleActivator = Symbol('endpoint-module-activator')

/** Private owner marker used to inject one canonical dependency instance. */
export const endpointModuleOwner = Symbol('endpoint-module-owner')

/** Internal installation surface carrying its optional composition-commit callback. */
export type IEndpointModuleInstallation = {
  readonly [endpointModuleActivator]?: () => void
  readonly [endpointModuleOwner]?: unknown
}

/** Registers a private activation callback without expanding the public module surface. */
export function withEndpointModuleActivator<T extends object>(
  surface: T,
  activate: () => void
): T & IEndpointModuleInstallation {
  Object.defineProperty(surface, endpointModuleActivator, {
    configurable: false,
    enumerable: false,
    value: activate,
    writable: false
  })
  return surface as T & IEndpointModuleInstallation
}

/** Associates an installed public surface with its canonical private owner. */
export function withEndpointModuleOwner<T extends object>(surface: T, owner: unknown): T {
  Object.defineProperty(surface, endpointModuleOwner, {
    configurable: false,
    enumerable: false,
    value: owner,
    writable: false
  })
  return surface
}

/** Reads one dependency owner without exposing attachment state publicly. */
export function getEndpointModuleOwner(value: unknown): unknown {
  if (typeof value !== 'object' || value === null) return undefined
  return (value as IEndpointModuleInstallation)[endpointModuleOwner]
}

/** Commits one installed feature after all selected installers have succeeded. */
export function activateEndpointModule(value: unknown): void {
  if (typeof value !== 'object' || value === null) return
  const activate = (value as IEndpointModuleInstallation)[endpointModuleActivator]
  activate?.()
}

const endpointModuleDefinitions = new WeakMap<object, IPrivateEndpointDefinition>()
const endpointModuleSourceTokens = new WeakMap<object, IWebRpcEndpointModule>()
const endpointModuleRootProjections = new WeakMap<object, readonly string[]>()

/** Returns the immutable root exposure contract for one package-owned module token. */
export function getEndpointModuleExposedKeys(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) return []
  return endpointModuleDefinitions.get(value)?.claims.exposedKeys ?? []
}

/** Reads package-owned root projection metadata without exposing transitive definitions. */
export function getEndpointModuleRootProjection(value: unknown): readonly string[] {
  if (typeof value !== 'object' || value === null) return []
  return endpointModuleRootProjections.get(value) ?? getEndpointModuleExposedKeys(value)
}

/** Stable first-party topology keys shared by immutable feature definitions. */
export const EndpointModuleKey = {
  outbound: 'outbound',
  oneWay: 'one-way',
  provider: 'provider',
  discovery: 'discovery',
  control: 'control',
  chunk: 'chunk'
} as const

/** Internal installer carried by one statically declared first-party token. */
export type IEndpointModuleInstallContext<T> = {
  readonly config: T
  readonly kernel: IEndpointKernelHost
  readonly prepared: IPreparedEndpoint<string>
  /** Host-owned construction scope fields exposed to a custom feature installer. */
  readonly id: string
  readonly transport: IWebRpcTransport
  readonly signal: IWebRpcAbortSignal
  readonly hooks: (event: IWebRpcHookEvent) => void
  readonly own: <TResource>(resource: TResource, release: () => void | Promise<void>) => TResource
  /** Reads package-owned typed ports from the Host shared publication. */
  readonly getShared: (key: PropertyKey) => unknown
}

/** Internal installer attaches selected owners to the coordinator-created kernel. */
export type IEndpointModuleInstaller<T> = (
  context: IEndpointModuleInstallContext<T>
) => Promise<unknown>

/** Runtime shape retained only inside the composition kernel. */
export type IRegisteredEndpointModule<T> = IWebRpcEndpointModule & {
  readonly key: string
  readonly requires: readonly (string | IWebRpcEndpointModule)[]
  readonly install: IEndpointModuleInstaller<T>
  readonly conflicts: readonly string[]
  readonly claims: IEndpointModuleClaims
  readonly sourceToken?: IWebRpcEndpointModule
}

/** Sentinel separating deliberate duplicate detection from hostile user failures. */
export const endpointModuleDuplicate = Symbol('endpoint-module-duplicate')

/** Admits WebRPC module dependency edges through the pure capability topology owner. */
export function admitEndpointModuleTopology<T>(
  definitions: readonly IRegisteredEndpointModule<T>[]
): readonly IRegisteredEndpointModule<T>[] {
  const definitionsByKey = new Map(definitions.map((definition) => [definition.key, definition]))
  const nodes: ITopologyNode[] = definitions.map((definition, ordinal) => ({
    id: definition.key,
    dependencies: definition.requires.map((requirement) => ({
      provider: typeof requirement === 'string' ? requirement : requirement.key,
      required: true
    })),
    ordinal
  }))
  return buildCapabilityTopology(
    nodes,
    () => {
      throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
    },
    () => {
      throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
    },
    () => {
      throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
    }
  ).ordered.map((node) => definitionsByKey.get(node.id)!)
}

/** Creates one immutable first-party definition at module initialization. */
export function defineEndpointModule<
  T,
  TSurface extends object,
  TRootSurface extends object = TSurface
>(
  key: string,
  install: IEndpointModuleInstaller<T>,
  requires: readonly (string | IWebRpcEndpointModule)[] = [],
  conflicts: readonly string[] = [],
  claims: Partial<IEndpointModuleClaims> = {},
  rootProjection?: readonly (keyof TRootSurface & string)[]
): IWebRpcEndpointModule<TSurface, TRootSurface> {
  const definition = Object.freeze({
    key,
    requires: Object.freeze([...requires]),
    conflicts: Object.freeze([...conflicts]),
    claims: Object.freeze({
      routes: Object.freeze([...(claims.routes ?? [])]),
      provides: Object.freeze([...(claims.provides ?? [])]),
      consumes: Object.freeze([...(claims.consumes ?? [])]),
      publicKeys: Object.freeze([...(claims.publicKeys ?? [])]),
      exposedKeys: Object.freeze([...(claims.exposedKeys ?? claims.publicKeys ?? [])]),
      activator: claims.activator ?? false,
      sharedProvides: Object.freeze([...(claims.sharedProvides ?? [])]),
      sharedConsumes: Object.freeze([...(claims.sharedConsumes ?? [])]),
      ...(claims.sharedOptionalConsumes === undefined
        ? {}
        : {
            sharedOptionalConsumes: Object.freeze([...claims.sharedOptionalConsumes])
          })
    }),
    install
  })
  const token = Object.freeze({ key })
  endpointModuleDefinitions.set(token, definition as IPrivateEndpointDefinition)
  endpointModuleSourceTokens.set(definition, token as IWebRpcEndpointModule)
  endpointModuleRootProjections.set(
    token,
    Object.freeze([...(rootProjection ?? definition.claims.exposedKeys)])
  )
  return token as unknown as IWebRpcEndpointModule<TSurface, TRootSurface>
}

/** Snapshots and validates package-owned module tokens before endpoint side effects. */
export function snapshotEndpointModules<T>(
  input: readonly IWebRpcEndpointModule[]
): readonly IRegisteredEndpointModule<T>[] {
  let snapshot: IWebRpcEndpointModule[]
  try {
    snapshot = Array.from(input)
  } catch (error) {
    throw new TypeError(WebRpcErrorText.endpointModuleInvalid, { cause: error })
  }
  const seen = new Set<unknown>()
  let definitions: IRegisteredEndpointModule<T>[]
  try {
    definitions = snapshot.map((candidate) => {
      try {
        const module =
          typeof candidate === 'object' && candidate !== null
            ? endpointModuleDefinitions.get(candidate)
            : undefined
        if (!module) throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
        if (seen.has(module.key)) throw endpointModuleDuplicate
        if (
          module.conflicts.some((key) =>
            snapshot.some(
              (item) => item !== candidate && endpointModuleDefinitions.get(item)?.key === key
            )
          )
        )
          throw endpointModuleDuplicate
        seen.add(module.key)
        return module as unknown as IRegisteredEndpointModule<T>
      } catch (error) {
        if (error === endpointModuleDuplicate) throw error
        throw new TypeError(WebRpcErrorText.endpointModuleInvalid, { cause: error })
      }
    })
  } catch (error) {
    if (error === endpointModuleDuplicate) throw error
    throw error instanceof TypeError
      ? error
      : new TypeError(WebRpcErrorText.endpointModuleInvalid, { cause: error })
  }
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]))
  const closure = new Map(byKey)
  const visit = (definition: IRegisteredEndpointModule<T>): void => {
    for (const requirement of definition.requires) {
      const key = typeof requirement === 'string' ? requirement : requirement.key
      if (typeof requirement === 'string') continue
      const dependency = endpointModuleDefinitions.get(requirement)
      if (!dependency) throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
      if (!byKey.has(key)) closure.set(key, dependency as unknown as IRegisteredEndpointModule<T>)
      const resolved = closure.get(key)
      if (resolved && !byKey.has(key)) visit(resolved)
    }
  }
  for (const definition of definitions) visit(definition)
  definitions = [...closure.values()]
  const routeOwners = new Set<string>()
  const portProviders = new Set<string>()
  const publicOwners = new Set<string>()
  for (const definition of definitions) {
    for (const publicKey of definition.claims.publicKeys) {
      if (publicOwners.has(publicKey)) throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
      publicOwners.add(publicKey)
    }
  }
  for (const definition of definitions) {
    for (const route of definition.claims.routes) {
      if (routeOwners.has(route)) throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
      routeOwners.add(route)
    }
    for (const provided of definition.claims.provides) {
      if (portProviders.has(provided)) throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
      portProviders.add(provided)
    }
    for (const exposedKey of definition.claims.exposedKeys)
      if (!publicOwners.has(exposedKey)) throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
    for (const consumed of definition.claims.consumes)
      if (
        !portProviders.has(consumed) &&
        !definitions.some((item) => item.claims.provides.includes(consumed))
      )
        throw new TypeError(WebRpcErrorText.endpointModuleInvalid)
  }
  return admitEndpointModuleTopology(definitions).map((definition) =>
    Object.freeze({
      ...definition,
      sourceToken: endpointModuleSourceTokens.get(definition)
    })
  )
}
