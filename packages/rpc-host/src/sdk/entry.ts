/** Resolve native-owner supplied entry facts and loader flags without reading runtime globals. */
import { readUrlHref, type IUrlLike } from '@migaia/utils'
import { createRpcError } from '../host/error-owner.ts'
import { RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { tagRpcError } from '@migaia/rpc-contract/errors'
import {
  RpcEntryErrorText,
  RPC_NON_ENTRY_FLAGS,
  RPC_TEST_ENTRY,
  RPC_BUNDLED_ENTRY,
  RPC_ENTRY_SCHEME,
  RPC_TEST_FLAG_PREFIX
} from './entry-text.ts'

/** Native owners supply entry snapshots; this pure resolver never reads runtime globals. */
export type IRpcEntryOptions = Readonly<{
  mainEntry?: IUrlLike
  base?: IUrlLike
  execArgv?: readonly string[]
  electron?: boolean
  singleBinary?: boolean
  selfAllowed?: boolean
}>

/** The compile-time controller flag list is fixed; no runtime registry is searched. */
function isRpcEntryControllerFlag(flag: string): boolean {
  return RPC_NON_ENTRY_FLAGS.some((item) => flag === item || flag.startsWith(`${item}=`))
}

/** Keep runtime and loader flags while removing eval, print and test-controller entry selection. */
export function retainRpcRuntimeFlags(flags: readonly string[]): readonly string[] {
  /** Entry controller arguments cannot redirect an explicitly selected child module. */
  const retained: string[] = []
  for (let index = 0; index < flags.length; index++) {
    /** Native execArgv has already separated interpreter flags from application arguments. */
    const flag = flags[index]!
    if (flag.startsWith(RPC_TEST_FLAG_PREFIX)) {
      if (!flag.includes('=') && flags[index + 1] && !flags[index + 1]!.startsWith('-')) index++
    } else if (isRpcEntryControllerFlag(flag)) {
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
export function resolveRpcEntry(entry: true | IUrlLike, options: IRpcEntryOptions): string {
  if (entry === true) {
    if (
      options.mainEntry === undefined ||
      options.selfAllowed === false ||
      options.electron ||
      options.singleBinary ||
      options.execArgv?.some(isRpcEntryControllerFlag) ||
      RPC_TEST_ENTRY.test(String(options.mainEntry)) ||
      RPC_BUNDLED_ENTRY.test(String(options.mainEntry))
    )
      throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcEntryErrorText.selfUnavailable)
    return resolveRpcEntry(options.mainEntry, options)
  }
  /** Any object with a string `href` (such as a WHATWG URL) is an exact URL. */
  if (typeof entry === 'object' && entry !== null && typeof entry.href === 'string')
    return entry.href
  if (typeof entry !== 'string' || !entry)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcEntryErrorText.invalid)
  /** A relative string is meaningful only with native-owner supplied entry data. */
  const base = options.base ?? options.mainEntry
  if (!RPC_ENTRY_SCHEME.test(entry) && base === undefined)
    throw createRpcError(RpcCoreErrorCode.invalidConfig, RpcEntryErrorText.relativeUnavailable)
  try {
    return new URL(
      entry,
      RPC_ENTRY_SCHEME.test(entry) || base === undefined ? undefined : readUrlHref(base)
    ).href
  } catch (cause) {
    throw tagRpcError(
      new TypeError(RpcEntryErrorText.invalid, { cause }),
      RpcCoreErrorCode.invalidConfig
    )
  }
}
