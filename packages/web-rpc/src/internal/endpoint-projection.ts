import { WebRpcError, WebRpcErrorCode } from '../errors.js'
import { WebRpcErrorText } from '../error-text.js'
import { registerComposedDisposalPromises } from './composed-disposal-observer.js'

/** Inputs owned by the composition shell for one immutable public endpoint projection. */
export type IEndpointProjectionOptions = {
  readonly host: object
  readonly publicKeys: readonly string[]
  readonly exposedKeys: readonly string[]
  readonly on: (...args: readonly unknown[]) => unknown
  readonly hooks: unknown
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
  defineValue(target, 'on', (...args: readonly unknown[]) => options.on(...args))
  defineValue(target, 'hooks', options.hooks)
  defineValue(target, 'dispose', dispose)
  for (const key of exposedKeys) {
    const value = values.get(key)
    defineValue(
      target,
      key,
      key === 'provide' && typeof value === 'function'
        ? (...args: readonly unknown[]) => {
            value(...args)
            return target
          }
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
