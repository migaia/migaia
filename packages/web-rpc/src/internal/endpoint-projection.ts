import { WebRpcError, WebRpcErrorCode, WebRpcLifecycleError } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { registerComposedDisposalPromises } from './composed-disposal-observer.js'

/** Inputs owned by the composition shell for one immutable public endpoint projection. */
export type IEndpointProjectionOptions = {
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
    'getShared',
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
    if (error instanceof WebRpcError) throw error
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      WebRpcErrorText.endpointModuleInvalid,
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
  return Object.freeze(target)
}

/** Reads Host own keys without executing accessors or allowing a hostile proxy to escape raw. */
function readHostKeys(host: object): readonly string[] {
  try {
    const keys = Reflect.ownKeys(host)
    if (keys.some((key) => typeof key !== 'string')) throw projectionError()
    return keys.filter((key): key is string => typeof key === 'string')
  } catch (error) {
    if (error instanceof WebRpcError) throw error
    throw new WebRpcError(
      WebRpcErrorCode.invalidConfig,
      WebRpcErrorText.endpointModuleInvalid,
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
function projectionError(): WebRpcError {
  return new WebRpcError(WebRpcErrorCode.invalidConfig, WebRpcErrorText.endpointModuleInvalid)
}

/**
 * Retells a revoked-view failure as this endpoint's own disposal error.
 *
 * A published extension closure is revoked the moment its registrations are, which is the host's
 * guarantee and the right one — but the caller here holds an _endpoint_, and what it needs to learn
 * is that the endpoint is disposed, not that some host view it never saw is gone. The host error
 * stays on `cause`, so the chain still reaches the decision that was actually made.
 *
 * Only `VIEW_REVOKED` is translated. Every other failure belongs to the member being called and is
 * rethrown untouched; widening this would make the endpoint claim disposal for faults it did not
 * cause.
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
    (error as { code?: unknown }).code === 'VIEW_REVOKED' &&
    (error as { source?: unknown }).source === '@migaia/plugin-host'
  )
    return new WebRpcLifecycleError(WebRpcErrorText.endpointDisposed, error)
  return error
}
