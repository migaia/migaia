import { RpcError, RpcCoreErrorCode, RpcLifecycleError } from '../errors.js'
import { RpcCoreErrorText } from '../error-text.js'
import { registerComposedDisposalPromises } from './composed-disposal-observer.js'
import {
  EndpointOwnerKey,
  EndpointKernelState,
  type IEndpointKernelHost
} from '../endpoint-kernel.js'

/** Canonical projections retain construction identity without adding a public endpoint member. */
const identities = new WeakMap<
  object,
  Readonly<{ identity: string; kernel?: IEndpointKernelHost }>
>()

/** Cold internal assembly reads the original kernel table through canonical projection provenance. */
export function readEndpointOwner<T extends object>(endpoint: object, key: string): T | undefined {
  /** Admission views inherit the exact prepared projection; no independent owner registry exists. */
  let projection: object | null = endpoint
  while (projection !== null) {
    const kernel = identities.get(projection)?.kernel
    if (kernel) return kernel.readOwner(key) as T | undefined
    projection = Object.getPrototypeOf(projection)
  }
  return undefined
}

/** Attach the sync resource to its own completed composition's existing identity record. */
export function retainEndpointProjection(source: object, target: object): void {
  /** Existing admission projections inherit the original canonical endpoint. */
  let projection: object | null = source
  while (projection !== null) {
    /** Reuse the original record; caller fields cannot manufacture an owner or identity. */
    const record = identities.get(projection)
    if (record) {
      identities.set(target, record)
      return
    }
    projection = Object.getPrototypeOf(projection)
  }
}

/** Read construction identity without adding a public endpoint member or reflecting user data. */
export function readEndpointIdentity(endpoint: object): string {
  /** Existing admission and drain views inherit from the original canonical projection. */
  let projection: object | null = endpoint
  while (projection !== null) {
    const identity = identities.get(projection)
    if (identity !== undefined) return identity.identity
    projection = Object.getPrototypeOf(projection)
  }
  throw projectionError()
}

/** Read O(1) sizes from the original client request and stream registries, never provider execution. */
export function readEndpointClientCounters(
  endpoint: object
): Readonly<{ inFlight: number; observedAt: number }> | undefined {
  /** Original admission views inherit canonical projection provenance and share these same owners. */
  let projection: object | null = endpoint
  while (projection !== null) {
    /** This is the existing identity record, extended with its actual composition kernel. */
    const kernel = identities.get(projection)?.kernel
    if (kernel) {
      if (kernel.state === EndpointKernelState.disposed) return undefined
      /** A missing outbound owner cannot be represented as a fabricated zero. */
      const requests = kernel.readOwner(EndpointOwnerKey.pendingRegistry) as
        | { readonly size: number }
        | undefined
      /** Missing optional stream capability contributes no streams, rather than provider counts. */
      const streams = kernel.readOwner(EndpointOwnerKey.streamConsumerRegistry) as
        | { readonly size: number }
        | undefined
      return requests
        ? { inFlight: requests.size + (streams?.size ?? 0), observedAt: kernel.time.now() }
        : undefined
    }
    projection = Object.getPrototypeOf(projection)
  }
  return undefined
}

/** Inputs owned by the composition shell for one immutable public endpoint projection. */
export type IEndpointProjectionOptions = {
  /** Original prepared endpoint identity; omitted only by standalone projection fixtures. */
  readonly identity?: string
  /** Retains only the canonical kernel for local cold reads; no new projection registry is added. */
  readonly kernel?: IEndpointKernelHost
  readonly host: object
  readonly publicKeys: readonly string[]
  readonly exposedKeys: readonly string[]
  readonly on?: (...args: readonly unknown[]) => unknown
  readonly hooks?: unknown
  /**
   * Members whose revoked-view failure must surface as a rejection rather than a throw.
   *
   * The endpoint's surface is not uniform: `ping` and `provide` guarded synchronously before the
   * call reached any promise, while the fanout members rejected. The host's liveness check now
   * preempts both, and it cannot know which shape a member used to have — so the shape is declared
   * here rather than guessed from the member's signature, which would get `ping` wrong.
   */
  readonly rejectionKeys?: readonly string[]
  readonly hostDispose: () => Promise<void>
  readonly beforeDispose?: (endpoint: object) => void
}

/**
 * Copies only admitted Host data descriptors into a frozen endpoint projection. The helper
 * delegates terminal disposal without owning a second lifecycle Promise or translating failures
 * locally.
 */
export function createEndpointProjection(
  options: IEndpointProjectionOptions
): Readonly<Record<string, unknown>> {
  const publicKeys = uniqueStrings(options.publicKeys)
  const exposedKeys = uniqueStrings(options.exposedKeys)
  const rejectionKeys = new Set(options.rejectionKeys ?? [])
  const reservedKeys = new Set([
    'on',
    'hooks',
    'dispose',
    'use',
    'unUse',
    'config',
    'getPort',
    'usePipeline',
    '__proto__'
  ])
  for (const key of [...publicKeys, ...exposedKeys]) {
    if (reservedKeys.has(key)) throw projectionError()
  }
  const hostKeys = readHostKeys(options.host)
  if (hostKeys.some((key) => !publicKeys.includes(key))) throw projectionError()

  const values = new Map<string, unknown>()
  try {
    for (const key of publicKeys) {
      const descriptor = Object.getOwnPropertyDescriptor(options.host, key)
      if (!descriptor || !('value' in descriptor) || descriptor.value === undefined)
        throw projectionError()
      values.set(key, descriptor.value)
    }
  } catch (error) {
    if (error instanceof RpcError) throw error
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.endpointModuleInvalid,
      error
    )
  }
  for (const key of exposedKeys) if (!values.has(key)) throw projectionError()

  const target = Object.create(null) as Record<string, unknown>
  /** Ensures discovery cleanup observation runs once while Host owns Promise identity. */
  let beforeDisposeCalled = false
  /** Retains the observer record once without retaining a Promise or creating a second owner. */
  let disposalObserved = false
  const dispose = (): Promise<void> => {
    if (!beforeDisposeCalled) {
      options.beforeDispose?.(target)
      beforeDisposeCalled = true
    }
    const hostPromise = options.hostDispose()
    if (!disposalObserved) {
      disposalObserved = true
      registerComposedDisposalPromises(
        target,
        Object.freeze({ host: hostPromise, endpoint: hostPromise })
      )
    }
    return hostPromise
  }
  if (options.on) defineValue(target, 'on', (...args: readonly unknown[]) => options.on!(...args))
  if (options.hooks !== undefined) defineValue(target, 'hooks', options.hooks)
  defineValue(target, 'dispose', dispose)
  for (const key of exposedKeys) {
    const value = values.get(key)
    defineValue(
      target,
      key,
      key === 'provide' && typeof value === 'function'
        ? (...args: readonly unknown[]) => {
            // `provide` 是同步的，翻译后的失败也必须同步抛出。
            translateRevokedView(() => value(...args), false)
            return target
          }
        : typeof value === 'function'
          ? (...args: readonly unknown[]) =>
              translateRevokedView(
                () => (value as (...rest: unknown[]) => unknown)(...args),
                rejectionKeys.has(key)
              )
          : value
    )
  }
  if (options.identity)
    identities.set(target, { identity: options.identity, kernel: options.kernel })
  return Object.freeze(target)
}

/** Reads Host own keys without executing accessors or allowing a hostile proxy to escape raw. */
function readHostKeys(host: object): readonly string[] {
  try {
    const keys = Reflect.ownKeys(host)
    if (keys.some((key) => typeof key !== 'string')) throw projectionError()
    return keys.filter((key): key is string => typeof key === 'string')
  } catch (error) {
    if (error instanceof RpcError) throw error
    throw new RpcError(
      RpcCoreErrorCode.invalidConfig,
      RpcCoreErrorText.endpointModuleInvalid,
      error
    )
  }
}

/** Rejects duplicate or non-string manifest values before any Host descriptor is published. */
function uniqueStrings(values: readonly string[]): readonly string[] {
  const result: string[] = []
  const seen = new Set<string>()
  for (const value of values) {
    if (typeof value !== 'string' || seen.has(value)) throw projectionError()
    seen.add(value)
    result.push(value)
  }
  return result
}

/** Defines one stable, non-configurable projection value without retaining Host mutation flags. */
function defineValue(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false
  })
}

/** Uses the package's existing invalid-composition contract for every projection rejection. */
function projectionError(): RpcError {
  return new RpcError(RpcCoreErrorCode.invalidConfig, RpcCoreErrorText.endpointModuleInvalid)
}

/**
 * Retells a revoked-registration failure as this endpoint's own disposal error.
 *
 * A published extension closure is revoked the moment its registrations are, which is the host's
 * guarantee and the right one — but the caller here holds an _endpoint_, and what it needs to learn
 * is that the endpoint is disposed, not that one host registration it never saw is gone. The host
 * error stays on `cause`, so the chain still reaches the decision that was actually made.
 *
 * `REGISTRATION_REVOKED` and the enclosing Host's terminal `HOST_DISPOSED` both mean the endpoint
 * can no longer serve the call. Every other failure belongs to the member being called.
 */
function translateRevokedView<T>(call: () => T, asRejection: boolean): T {
  try {
    const result = call()
    if (result instanceof Promise)
      return result.catch((error: unknown) => {
        throw asEndpointDisposed(error)
      }) as T
    return result
  } catch (error) {
    const translated = asEndpointDisposed(error)
    // 端点这一侧除 `provide` 外全是异步成员：同步抛出会绕过调用方的 `await`，让失败以另一种形态出现。
    // 只有真正被翻译过的失败才改变形态；其余原样抛出，不为无关故障编造一个 Promise。
    if (asRejection && translated !== error) return Promise.reject(translated) as T
    throw translated
  }
}

/** The endpoint's disposal error when `error` is a revoked view, otherwise `error` unchanged. */
function asEndpointDisposed(error: unknown): unknown {
  if (
    error &&
    typeof error === 'object' &&
    ((error as { code?: unknown }).code === 'REGISTRATION_REVOKED' ||
      (error as { code?: unknown }).code === 'HOST_DISPOSED') &&
    (error as { source?: unknown }).source === '@migaia/plugin-host'
  )
    return new RpcLifecycleError(RpcCoreErrorText.endpointDisposed, error)
  return error
}
