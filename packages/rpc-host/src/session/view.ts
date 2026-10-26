/** Compile accepted metadata once for ordinary and private physical Sessions. */
import type { IRpcSessionView } from '@migaia/rpc-contract/interfaces'
import type { IRpcDirectory, IRpcMethodDescription } from '@migaia/rpc-contract/protocol'

/** One prepared row retains its exact token and split-horizon visibility. */
export type IRpcDirectoryRow = Readonly<{
  method: IRpcMethodDescription
  fingerprint: string
  except?: string
  only?: string
}>

/** Namespace-owned metadata is compiled once and shared by its physical Sessions. */
export type IRpcDirectorySnapshot = Readonly<{
  header: IRpcDirectory
  fingerprint: string
  rows: readonly IRpcDirectoryRow[]
}>

/** The selected receiver belongs to the fingerprint, including an unidentified initial hello. */
export type IRpcDirectoryFingerprint = Readonly<{
  snapshot: IRpcDirectorySnapshot
  peerId?: string
}>

/** Serialize normalized method metadata once, before any receiver projects its directory. */
export function createDirectoryRow(
  method: IRpcMethodDescription,
  except?: string,
  only?: string
): IRpcDirectoryRow {
  return Object.freeze({ method, fingerprint: JSON.stringify(method), except, only })
}

/** Exact namespace equality permits unchanged broadcasts to reuse the previous shared object. */
function sameDirectorySnapshot(
  before: IRpcDirectorySnapshot,
  after: IRpcDirectorySnapshot
): boolean {
  if (before.fingerprint !== after.fingerprint || before.rows.length !== after.rows.length)
    return false
  for (let index = 0; index < before.rows.length; index++) {
    const left = before.rows[index]!
    const right = after.rows[index]!
    if (
      left.fingerprint !== right.fingerprint ||
      left.except !== right.except ||
      left.only !== right.only
    )
      return false
  }
  return true
}

/** Capture header and row tokens without retaining providers, Sessions or per-receiver copies. */
export function createDirectorySnapshot(
  directory: IRpcDirectory,
  previous?: IRpcDirectorySnapshot,
  rows: readonly IRpcDirectoryRow[] = directory.methods.map((method) => createDirectoryRow(method))
): IRpcDirectorySnapshot {
  /** Emission supplies visible method rows to this shared header. */
  const header = Object.freeze({ ...directory, methods: Object.freeze([]) })
  /** The same JSON contract preserves metadata key order and avoids a lossy hash. */
  const snapshot = Object.freeze({
    header,
    fingerprint: JSON.stringify(header),
    rows: Object.freeze(rows)
  })
  return previous && sameDirectorySnapshot(previous, snapshot) ? previous : snapshot
}

/** At most one peer is excluded, so a row needs only primary or fallback visibility. */
function directoryRowVisible(row: IRpcDirectoryRow, peerId: string | undefined): boolean {
  return (
    (row.except === undefined || row.except !== peerId) &&
    (row.only === undefined || row.only === peerId)
  )
}

/** Materialize only the method vector required by this receiver's actual wire output. */
export function directoryMethods(
  rows: readonly IRpcDirectoryRow[],
  peerId?: string
): readonly IRpcMethodDescription[] {
  /** One output-sized allocation preserves the prepared candidate order. */
  const methods: IRpcMethodDescription[] = []
  for (const row of rows) if (directoryRowVisible(row, peerId)) methods.push(row.method)
  return Object.freeze(methods)
}

/** Project a normal protocol directory after fingerprint comparison determines a write is needed. */
export function projectDirectory(snapshot: IRpcDirectorySnapshot, peerId?: string): IRpcDirectory {
  return { ...snapshot.header, methods: directoryMethods(snapshot.rows, peerId) }
}

/** Compare visible tokens directly; an unchanged shared snapshot returns in constant time. */
export function sameDirectoryFingerprint(
  before: IRpcDirectoryFingerprint,
  after: IRpcDirectoryFingerprint
): boolean {
  if (before.snapshot === after.snapshot && before.peerId === after.peerId) return true
  if (before.snapshot.fingerprint !== after.snapshot.fingerprint) return false
  /** Each cursor visits its source rows once, skipping only rows excluded from that output. */
  let left = 0
  /** The receiver may change from an unidentified hello to an admitted peer. */
  let right = 0
  while (true) {
    while (
      left < before.snapshot.rows.length &&
      !directoryRowVisible(before.snapshot.rows[left]!, before.peerId)
    )
      left++
    while (
      right < after.snapshot.rows.length &&
      !directoryRowVisible(after.snapshot.rows[right]!, after.peerId)
    )
      right++
    if (left === before.snapshot.rows.length || right === after.snapshot.rows.length)
      return left === before.snapshot.rows.length && right === after.snapshot.rows.length
    if (before.snapshot.rows[left]!.fingerprint !== after.snapshot.rows[right]!.fingerprint)
      return false
    left++
    right++
  }
}

/** Both admission paths receive the same already-normalized directory from Session. */
export function createSessionView(
  namespace: string,
  directory: IRpcDirectory,
  codec: string,
  extensions: readonly string[],
  authentication?: IRpcSessionView['authentication'],
  callTimeoutCap?: IRpcSessionView['callTimeoutCap'],
  isExclusive?: IRpcSessionView['isExclusive']
): IRpcSessionView {
  return Object.freeze({
    namespace,
    peerId: directory.self.instanceId,
    name: directory.self.name,
    generation: directory.self.generation,
    nodeId: directory.nodeId,
    ...(authentication === undefined ? {} : { authentication }),
    ...(callTimeoutCap === undefined ? {} : { callTimeoutCap }),
    ...(isExclusive === undefined ? {} : { isExclusive }),
    methods: new Map(directory.methods.map((method) => [method.name, method])),
    codec,
    extensions: new Set(extensions)
  })
}
