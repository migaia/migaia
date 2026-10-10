/** Native byte encoders share the canonical unpadded alphabet used by the binary manifest. */
export const RpcOwnedBinaryAlphabet = 'base64url'

/** A JSON-ready view and conservative byte bound belong to one admitted immutable source. */
export type IOwnedJsonSnapshot = Readonly<{ value: unknown; byteUpperBound: number }>

/** Stamp the source itself so no per-message global identity table retains prepared traffic. */
class OwnedJsonSnapshot extends class {
  /** Preserve the original object's identity, prototype and visible descriptors. */
  constructor(value: object) {
    return value
  }
} {
  /** The prepared JSON view is private and cannot be copied through caller-visible properties. */
  #snapshot: IOwnedJsonSnapshot

  /** Store only facts computed while the canonical owner constructed this exact snapshot. */
  constructor(value: object, snapshot: IOwnedJsonSnapshot) {
    super(value)
    this.#snapshot = snapshot
  }

  /** Foreign objects, copied fields and caller freezing never establish this identity proof. */
  static read(value: unknown): IOwnedJsonSnapshot | undefined {
    return value !== null &&
      (typeof value === 'object' || typeof value === 'function') &&
      #snapshot in value
      ? value.#snapshot
      : undefined
  }
}

/** Read the existing owner's exact prepared view without revisiting its business graph. */
export function readOwnedJsonSnapshot(value: unknown): IOwnedJsonSnapshot | undefined {
  return OwnedJsonSnapshot.read(value)
}

/**
 * Materialize the canonical owned JSON tree once, preserving the legacy ordering selector. Binary
 * roots are already encoded by the binary owner; their captured bounds stop this walk.
 */
export function captureOwnedJson(
  value: unknown,
  sortKeys = true,
  binaryRoots?: ReadonlyMap<object, number>
): IOwnedJsonSnapshot {
  if (typeof value === 'string') return { value, byteUpperBound: value.length * 6 + 2 }
  if (value === null || typeof value !== 'object')
    return { value: Object.is(value, -0) ? 0 : value, byteUpperBound: 32 }
  /** Exact roots were produced by the original binary walk, never selected by a wire field. */
  const binaryBound = binaryRoots?.get(value)
  if (binaryBound !== undefined) return { value, byteUpperBound: binaryBound }
  if (Array.isArray(value)) {
    /** Five bytes per slot preserve the JSON null/comma bound for legacy sparse arrays. */
    let byteUpperBound = 2 + value.length * 5
    /** Map retains the original hole shape while each present child is captured exactly once. */
    const output = value.map((item, index) => {
      /** Child facts are consumed immediately, without a second recursive sizing pass. */
      const child = captureOwnedJson(item, sortKeys, binaryRoots)
      /** Retain the original legacy bound, which also charged each present array index name. */
      byteUpperBound += String(index).length * 6 + 4 + child.byteUpperBound
      return child.value
    })
    return { value: output, byteUpperBound }
  }
  /** The original materializer publishes ordinary JSON records, defining **proto** as data. */
  const output: Record<string, unknown> = {}
  /** Sorting changes only the owned JSON view; the semantic snapshot keeps its own key order. */
  const keys = Object.keys(value)
  if (sortKeys) keys.sort()
  /** Record delimiters and escaped keys are included in the same construction pass. */
  let byteUpperBound = 2
  for (const key of keys) {
    /** The source is already admitted; original user accessors are never revisited here. */
    const child = captureOwnedJson((value as Record<string, unknown>)[key], sortKeys, binaryRoots)
    byteUpperBound += key.length * 6 + 4 + child.byteUpperBound
    Object.defineProperty(output, key, {
      value: child.value,
      enumerable: true,
      configurable: true,
      writable: true
    })
  }
  return { value: output, byteUpperBound }
}

/** Retain one owned view on its exact source without changing any public own property. */
export function prepareOwnedJsonSnapshot(value: object): IOwnedJsonSnapshot {
  /** Repeated sizing/encoding reads reuse this preparation rather than walking the source again. */
  const retained = OwnedJsonSnapshot.read(value)
  if (retained) return retained
  /** This function is called only by the original outbound owner after canonical admission. */
  const snapshot = captureOwnedJson(value)
  new OwnedJsonSnapshot(value, snapshot)
  return snapshot
}

/**
 * The binary prepare owner supplies exact JSON-ready root identities and their construction bounds.
 * Only metadata is materialized here; no encoded business root is revisited.
 */
export function prepareOwnedBinaryJsonSnapshot(
  manifest: object,
  binaryRoots: ReadonlyMap<object, number>
): void {
  /** Dummy and final manifests each capture their own metadata, sharing immutable business roots. */
  const snapshot = captureOwnedJson(manifest, true, binaryRoots)
  new OwnedJsonSnapshot(manifest, snapshot)
}
