/** Pure exceptional-path privacy policy shared by handshake metadata and its actual JSON codec. */
import { RpcContractErrorCode } from '../error-code.ts'
import { RpcWireErrorViolation } from '../contract/wire-error-constants.ts'
import {
  RpcHandshakeInputForm,
  RpcHandshakeRedactionPath,
  RpcHandshakeRedactionText
} from '../wire/handshake-text.ts'

/** The original bounded error-chain policy preserves clean native instances through sixteen links. */
const MAX_ERROR_DEPTH = 16
/** Four input code units are the established minimum engine excerpt that must be withheld. */
const EXCERPT_UNITS = 4

/** Retain a native error only when its entire bounded cause chain contains no input subtree. */
export function redactRpcHandshakeFailure(cause: unknown): unknown {
  /** Traversal is confined to this exceptional value, never the original business or auth graph. */
  let node = cause
  for (let depth = 0; depth < MAX_ERROR_DEPTH; depth++) {
    if (!(node instanceof Error) || Object.hasOwn(node, 'errors')) break
    node = (node as Error & { cause?: unknown }).cause
    if (node === undefined) return cause
  }
  /** Only recognized wire classification survives; arbitrary error strings cannot become evidence. */
  const code = cause instanceof Error ? (cause as Error & { code?: unknown }).code : undefined
  /** Existing violation names are inert contract values rather than source-controlled diagnostics. */
  const violation =
    cause instanceof Error ? (cause as Error & { violation?: unknown }).violation : undefined
  return Object.freeze({
    redacted: true,
    form: RpcHandshakeInputForm.other,
    parsed: true,
    path: RpcHandshakeRedactionPath.error,
    wireCode:
      code === RpcContractErrorCode.invalidWireError ? code : RpcHandshakeRedactionText.marker,
    wireViolation: Object.values(RpcWireErrorViolation).includes(violation as never)
      ? violation
      : RpcHandshakeRedactionText.marker
  })
}

/** Preserve a JSON engine instance only when its message quotes no four-unit input excerpt. */
export function isRpcHandshakeExcerptFree(message: string, json: string): boolean {
  if (message.length < EXCERPT_UNITS) return true
  /** Engine-message windows are indexed once; only the failed JSON input is then scanned. */
  const windows = new Set<string>()
  for (let offset = 0; offset <= message.length - EXCERPT_UNITS; offset++)
    windows.add(message.slice(offset, offset + EXCERPT_UNITS))
  for (let offset = 0; offset <= json.length - EXCERPT_UNITS; offset++)
    if (windows.has(json.slice(offset, offset + EXCERPT_UNITS))) return false
  return true
}
