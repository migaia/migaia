/** Executing binary codec resources carry actual borrowed buffers and explicit error metadata. */
import type { IRpcEnvelope, IRpcBinaryManifest } from '@migaia/rpc-contract/protocol'
import type { IRpcErrorWireMetadata } from '@migaia/rpc-contract/errors'
import type { RpcBinaryStorage } from './binary-constants.ts'
export type { IRpcBinaryManifest }
/** Digest ownership stays with the installing native crypto resource, never inferred from wire data. */
export type IRpcBinaryDigest = (backing: ArrayBuffer) => Promise<string>
/** Prepared metadata retains original whole backing identity for exact explicit transfer. */
export type IRpcPreparedBinary = Readonly<{
  manifest: IRpcBinaryManifest
  sidecars: readonly ArrayBuffer[]
  backingBytes: number
}>
/** Carrier-specific encoders can consume captured roots at the original pre-digest boundary. */
export type IRpcBinaryEncoding = Readonly<{
  encodeInline?: (bytes: Uint8Array) => string
  capture(manifest: IRpcBinaryManifest, roots: ReadonlyMap<object, number>): void
}>
/** One operation's explicit storage, byte budget, digest and local error presentation authority. */
export type IRpcBinaryOptions = Readonly<{
  storage: RpcBinaryStorage
  limit?: number
  digest?: IRpcBinaryDigest
  /** Local integrity demand; wire capture borrows the selected signing flow's trusted fact. */
  transferRequiresIntegrity?: boolean
  /** Caller-granted ownership handoff keeps these original backings native even below threshold. */
  transfer?: readonly ArrayBuffer[]
  errorMetadata?: IRpcErrorWireMetadata
  encoding?: IRpcBinaryEncoding
  beforeDigest?(manifest: IRpcBinaryManifest, backingBytes: number): void
}>
/** Restore receives exactly the original ordered complete backing list from its physical carrier. */
export type IRpcBinaryRestoreOptions = IRpcBinaryOptions &
  Readonly<{ sidecars?: readonly ArrayBuffer[] }>
/** Capture is operation-local and never lives in contract or an endpoint pending table. */
export type IRpcBinaryCapture = {
  envelope: IRpcEnvelope
  semanticEnvelope: IRpcEnvelope
  hasBinary: boolean
  sidecars: ArrayBuffer[]
  /** Logical aliases index these rows; only rows without inline data consume physical sidecars. */
  backings: Readonly<{ byteLength: number; data?: string }>[]
  backingBytes: number
  capturedRoots: Map<object, number> | undefined
}
