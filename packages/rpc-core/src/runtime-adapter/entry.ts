import { readUrlHref, type IUrlLike } from '@migaia/utils'
import { createAdapterConfigurationError, createAdapterConfigurationTypeError } from './data.js'
import {
  AdapterEntryErrorText,
  ADAPTER_NON_ENTRY_FLAGS,
  ADAPTER_TEST_ENTRY,
  ADAPTER_BUNDLED_ENTRY,
  ADAPTER_ENTRY_SCHEME,
  ADAPTER_TEST_FLAG_PREFIX
} from './entry-text.js'

/** Native owners supply entry snapshots; this pure resolver never reads runtime globals. */
export type IAdapterEntryOptions = Readonly<{
  mainEntry?: IUrlLike
  base?: IUrlLike
  execArgv?: readonly string[]
  electron?: boolean
  singleBinary?: boolean
  selfAllowed?: boolean
}>

/** Keep runtime and loader flags while removing eval, print and test-controller entry selection. */
export function retainAdapterRuntimeFlags(flags: readonly string[]): readonly string[] {
  /** Entry controller arguments cannot redirect an explicitly selected child module. */
  const retained: string[] = []
  for (let index = 0; index < flags.length; index++) {
    /** Native execArgv has already separated interpreter flags from application arguments. */
    const flag = flags[index]!
    if (flag.startsWith(ADAPTER_TEST_FLAG_PREFIX)) {
      if (!flag.includes('=') && flags[index + 1] && !flags[index + 1]!.startsWith('-')) index++
    } else if (
      ADAPTER_NON_ENTRY_FLAGS.some((item) => flag === item || flag.startsWith(`${item}=`))
    ) {
      if (!flag.includes('=')) index++
    } else retained.push(flag)
  }
  return retained
}

/**
 * Resolve short process/thread entries without caller-stack inspection. Exact URLs retain their
 * bytes; relative strings use the explicit base or main entry directory. Self spawning rejects
 * interpreter and test harness contexts before acquiring any native resource.
 */
export function resolveAdapterEntry(entry: true | IUrlLike, options: IAdapterEntryOptions): string {
  if (entry === true) {
    if (
      options.mainEntry === undefined ||
      options.selfAllowed === false ||
      options.electron ||
      options.singleBinary ||
      options.execArgv?.some((flag) =>
        ADAPTER_NON_ENTRY_FLAGS.some((item) => flag === item || flag.startsWith(`${item}=`))
      ) ||
      ADAPTER_TEST_ENTRY.test(String(options.mainEntry)) ||
      ADAPTER_BUNDLED_ENTRY.test(String(options.mainEntry))
    )
      throw createAdapterConfigurationError(AdapterEntryErrorText.selfUnavailable)
    return resolveAdapterEntry(options.mainEntry, options)
  }
  /** Any object with a string `href` (such as a WHATWG URL) is an exact URL. */
  if (typeof entry === 'object' && entry !== null && typeof entry.href === 'string')
    return entry.href
  if (typeof entry !== 'string' || !entry)
    throw createAdapterConfigurationError(AdapterEntryErrorText.invalid)
  /** A relative string is meaningful only with native-owner supplied entry data. */
  const base = options.base ?? options.mainEntry
  if (!ADAPTER_ENTRY_SCHEME.test(entry) && base === undefined)
    throw createAdapterConfigurationError(AdapterEntryErrorText.relativeUnavailable)
  try {
    return new URL(
      entry,
      ADAPTER_ENTRY_SCHEME.test(entry) || base === undefined ? undefined : readUrlHref(base)
    ).href
  } catch (cause) {
    throw createAdapterConfigurationTypeError(AdapterEntryErrorText.invalid, cause)
  }
}
