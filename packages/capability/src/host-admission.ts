import { CAPABILITY_SOURCE } from './errors.ts'
import { attachErrorIdentity } from '@migaia/utils/error'
/**
 * Captures capability options, allowlists and activation recipes before publication. This module
 * owns input and thenable admission; it does not retain resources or drive host transitions.
 */
import { assimilateCapturedThen, probeThenable, ThenableProbeKind } from '@migaia/utils/function'
import type { ICapabilityDefinition, ICapabilityHandle, ICapabilityHostOptions } from './index.ts'
import { CapabilityErrorCode } from './error-code.ts'
import { CapabilityErrorText } from './error-text.ts'

/** Construction snapshot preserves the original reporter receiver without rereading options. */
export type IHostOptionsSnapshot = {
  readonly flags: Map<string, boolean>
  readonly onError: ICapabilityHostOptions['onError']
  readonly receiver: ICapabilityHostOptions
}

/** Validate option reads in their original order before creating lifecycle owners. */
export function snapshotHostOptions(options: ICapabilityHostOptions): IHostOptionsSnapshot {
  if (options === null || (typeof options !== 'object' && typeof options !== 'function')) {
    throw attachErrorIdentity(new TypeError(CapabilityErrorText.invalidOptions), {
      source: CAPABILITY_SOURCE,
      code: CapabilityErrorCode.invalidOption
    })
  }
  /** Reporter is captured first, so its failure precedes all flag reads. */
  let onError: ICapabilityHostOptions['onError']
  /** Original allowlist container is copied only after its getter succeeds. */
  let flags: ICapabilityHostOptions['flags']
  try {
    onError = options.onError
  } catch (error) {
    throw attachErrorIdentity(
      new Error(CapabilityErrorText.optionsSnapshotFailed, { cause: error }),
      { source: CAPABILITY_SOURCE, code: CapabilityErrorCode.invalidOption }
    )
  }
  if (onError !== undefined && typeof onError !== 'function') {
    throw attachErrorIdentity(new TypeError(CapabilityErrorText.invalidOnError), {
      source: CAPABILITY_SOURCE,
      code: CapabilityErrorCode.invalidOption
    })
  }
  try {
    flags = options.flags
  } catch (error) {
    throw attachErrorIdentity(
      new Error(CapabilityErrorText.optionsSnapshotFailed, { cause: error }),
      { source: CAPABILITY_SOURCE, code: CapabilityErrorCode.invalidOption }
    )
  }
  return { flags: copyHostFlags(flags), onError, receiver: options }
}

/** Copy own enumerable true data properties in O(n), without evaluating flag accessors. */
export function copyHostFlags(
  source: Readonly<Record<string, boolean>> | undefined
): Map<string, boolean> {
  /** Map treats prototype-looking names as ordinary allowlist keys. */
  const copied = new Map<string, boolean>()
  if (!source) return copied
  /** Descriptor snapshot avoids executing getter values while retaining Proxy failures. */
  let descriptors: PropertyDescriptorMap
  try {
    descriptors = Object.getOwnPropertyDescriptors(source)
  } catch (error) {
    throw attachErrorIdentity(
      new Error(CapabilityErrorText.flagsSnapshotFailed, { cause: error }),
      { source: CAPABILITY_SOURCE, code: CapabilityErrorCode.invalidOption }
    )
  }
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (descriptor.enumerable && 'value' in descriptor && descriptor.value === true)
      copied.set(name, true)
  }
  return copied
}

/** Capture registration identity and retain the frozen method receiver used by activation. */
export function snapshotHostDefinition<Context>(
  definition: ICapabilityDefinition<Context>
): ICapabilityDefinition<Context> {
  /** Name is read once before validation or duplicate lookup. */
  let name: unknown
  /** Callable is read once and retained independently from later caller mutation. */
  let activate: unknown
  try {
    name = definition?.name
    activate = definition?.activate
  } catch (error) {
    throw attachErrorIdentity(
      new Error(CapabilityErrorText.definitionSnapshotFailed, { cause: error }),
      { source: CAPABILITY_SOURCE, code: CapabilityErrorCode.invalidOption }
    )
  }
  if (typeof name !== 'string' || name.trim().length === 0) {
    throw attachErrorIdentity(new TypeError(CapabilityErrorText.invalidName), {
      source: CAPABILITY_SOURCE,
      code: CapabilityErrorCode.invalidName
    })
  }
  if (typeof activate !== 'function') {
    throw attachErrorIdentity(new TypeError(CapabilityErrorText.invalidActivate(name)), {
      source: CAPABILITY_SOURCE,
      code: CapabilityErrorCode.invalidActivate
    })
  }
  /** Native method invocation preserves this.name without retaining the mutable definition. */
  const receiver = Object.freeze({
    name,
    activate: activate as ICapabilityDefinition<Context>['activate']
  })
  return { name, activate: (context: Context) => receiver.activate(context) }
}

/** Capture a disposer once; malformed handles retain the native TypeError and original cause. */
export function snapshotHostDisposer(
  handle: ICapabilityHandle,
  name: string
): ICapabilityHandle['dispose'] {
  /** Getter result is reused for adoption and eventual cleanup. */
  let disposer: ICapabilityHandle['dispose'] | undefined
  try {
    disposer = handle?.dispose
  } catch (error) {
    throw attachErrorIdentity(
      new TypeError(CapabilityErrorText.invalidHandle(name), { cause: error }),
      { source: CAPABILITY_SOURCE, code: CapabilityErrorCode.invalidHandle }
    )
  }
  if (!handle || typeof disposer !== 'function') {
    throw attachErrorIdentity(new TypeError(CapabilityErrorText.invalidHandle(name)), {
      source: CAPABILITY_SOURCE,
      code: CapabilityErrorCode.invalidHandle
    })
  }
  return disposer
}

/** Capture cleanup thenables once while preserving protocol getter failures for host reporting. */
export function asHostCleanupPromise(value: unknown): Promise<void> | undefined {
  /** Shared protocol probe prevents duplicate reads of a hostile then getter. */
  const probe = probeThenable(value)
  if (probe.kind === ThenableProbeKind.notThenable) return undefined
  if (probe.kind === ThenableProbeKind.failed) throw probe.error
  return assimilateCapturedThen<void>(probe.thenFn, value)
}

/** Keep immediate API rejections owned without changing the rejected Promise returned to callers. */
export function rejectedHostOperation<T>(error: unknown): Promise<T> {
  /** Original rejected identity remains observable to callers awaiting admission failures. */
  const rejected = Promise.reject<T>(error)
  void rejected.catch(() => {
    // Containment only marks this rejection handled; callers still receive the original Promise.
  })
  return rejected
}
