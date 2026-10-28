/** Specialized recursive portable traversal; caller policy owns value admission and output shape. */
import { isUint8Array } from '@migaia/utils/bytes'
import { bytesToBase64url, isCanonicalBase64url } from './base64.ts'
import type { createPortableWalker, IPortableWalkerStrategy } from './portable.ts'
import { PortableBytesField, PortableViolation } from './portable-contract.ts'

/** Captured hooks retain factory getter order and undefined callback receivers. */
type IPortableWalkerPolicy = Readonly<{
  maxDepth: number
  scalar: IPortableWalkerStrategy['scalar']
  binary: IPortableWalkerStrategy['binary']
  nativeByteLength: IPortableWalkerStrategy['nativeByteLength']
  record: IPortableWalkerStrategy['record']
  array: NonNullable<IPortableWalkerStrategy['array']>
  arrayValue: IPortableWalkerStrategy['arrayValue']
  key: NonNullable<IPortableWalkerStrategy['key']>
  write: NonNullable<IPortableWalkerStrategy['write']>
  finish: NonNullable<IPortableWalkerStrategy['finish']>
  violation: IPortableWalkerStrategy['violation']
}>

/** Policy context exposes current invocation state without retaining completed graphs. */
type IPortableWalkerContext = Parameters<IPortableWalkerStrategy['scalar']>[1]
/** Raw array visitors keep lexical depth, ancestor, and guard ownership explicit. */
type IPortableOwnedVisit = Parameters<NonNullable<IPortableWalkerStrategy['arrayValue']>>[1]
/** Record admission is the strategy's existing contract rather than another value domain. */
type IPortableRecord = NonNullable<ReturnType<IPortableWalkerStrategy['record']>>

/** Conservative JSON UTF-8 size uses at most six ASCII escape bytes per UTF-16 code unit. */
function portableScalarBound(value: unknown): number {
  if (typeof value === 'string') return value.length * 6 + 2
  if (typeof value === 'number') return 32
  if (typeof value === 'boolean') return 5
  if (value === null) return 4
  return 0
}

/** Default array projection preserves map/species/getter/hole semantics of existing consumers. */
const mapPortableArray = (
  value: unknown[],
  visit: (child: unknown) => unknown
): Readonly<{ value: unknown[]; length?: number; violation?: string }> => {
  /** Fresh map output owns its length; capture once instead of observing caller input again. */
  const output = value.map(visit)
  return { value: output, length: output.length }
}
/** Identity finish leaves existing codec copies mutable and decoded assertion inputs unchanged. */
const finishPortableValue = (value: unknown): unknown => value
/** Strategies without reserved fields need no key policy. */
const admitPortableKey = (): void => {}

/** Define safe own fields for the legacy ordinary-object output, including **proto**. */
function writePortableOwnField(output: Record<string, unknown>, key: string, child: unknown): void {
  Object.defineProperty(output, key, {
    value: child,
    enumerable: true,
    configurable: true,
    writable: true
  })
}

/** Construct the strategy context with its historical own fields and a dynamic guard accessor. */
function portableWalkerContext(owner: PortableWalker): IPortableWalkerContext {
  return {
    reject: (reason, cause) => owner.reject(reason, cause),
    isAncestor: (value) => owner.isAncestor(value),
    isUint8Array,
    bytesToBase64url,
    isCanonicalBase64url,
    get beforeNativeBinary() {
      return owner.beforeNativeBinary
    }
  }
}

/** One owner retains policy callbacks and primitive traversal slots across synchronous reentry. */
export class PortableWalker {
  /** Immutable callback snapshot separates policy ownership from traversal state. */
  readonly #policy: IPortableWalkerPolicy
  /** Shared callback context exposes only the currently active synchronous invocation. */
  readonly #context: IPortableWalkerContext
  /** Metadata callers collect bytes; value-only callers never observe unused output lengths. */
  #collectBounds = true
  /** Retained policy visitors can run after return without keeping invocation state alive. */
  #invocationDepth = 0
  /** Current synchronous ancestor owner; absent for root scalars and atomic binary values. */
  #active: Set<object> | undefined
  /** Optional guard is supplied by the current caller, rather than captured into another walker. */
  #beforeNativeBinary: (() => never) | undefined
  /** Exact strategy-raised error recognizes classified failures during ancestor unwinding. */
  #raised: unknown
  /** Separates an actual thrown undefined from the empty error slot. */
  #didRaise = false
  /** Raw cause propagation remains eligible for the original enclosing container boundary. */
  #rawFailure = false
  /** Last completed node's JSON/native byte bound, consumed immediately by its parent. */
  #nodeBytes = 0
  /** Last completed node's inline or native binary presence. */
  #nodeBinary = false
  /** Last completed node's native-only evidence for the caller's protocol marker. */
  #nodeNative = false
  /** First deferred validation failure, without constructing an error before projection completes. */
  #nodeInvalid: string | undefined
  /** Current array callback depth; nested arrays restore the previous visitor frame. */
  #visitDepth = 0
  /** Current array accumulator avoids per-array visitor closures and metadata wrappers. */
  #arrayBytes = 0
  /** Current array's generic binary evidence. */
  #arrayBinary = false
  /** Current array's native-only descendant evidence. */
  #arrayNative = false
  /** Current array's deferred validation priority. */
  #arrayInvalid: string | undefined
  /** Visited elements distinguish sparse holes from JSON null values. */
  #arrayVisited = 0

  /** Stable child visitor lets array policies reuse one callback without per-array allocation. */
  readonly #visit = (child: unknown): unknown => this.#visitChild(child)
  /** Stable raw visitor restores lexical ownership when caller policies retain a callback. */
  readonly #ownedVisit: IPortableOwnedVisit = (child, depth, ancestors, guard, bounds) =>
    this.#visitOwned(child, depth, ancestors, guard, bounds)
  /** Callable public handle keeps its original own value method and mutable function shape. */
  readonly result = ((value: unknown, ancestors?: Set<object>, depth = 0, guard?: () => never) =>
    this.#execute(value, ancestors, depth, guard, true)) as ReturnType<typeof createPortableWalker>

  /** Capture hooks in their historical order before publishing the callable handle. */
  constructor(strategy: IPortableWalkerStrategy) {
    /** Getter reads occur exactly once, before depth admission or invocation state is exposed. */
    const {
      maxDepth = Infinity,
      scalar,
      binary,
      nativeByteLength,
      record,
      array = mapPortableArray,
      arrayValue,
      key = admitPortableKey,
      write = writePortableOwnField,
      finish = finishPortableValue,
      violation
    } = strategy
    if (maxDepth !== Infinity && (!Number.isSafeInteger(maxDepth) || maxDepth < 0))
      violation(PortableViolation.depth)
    this.#policy = {
      maxDepth,
      scalar,
      binary,
      nativeByteLength,
      record,
      array,
      arrayValue,
      key,
      write,
      finish,
      violation
    }
    this.#context = portableWalkerContext(this)
    Object.assign(this.result, {
      value: (value: unknown, ancestors?: Set<object>, depth = 0, guard?: () => never) =>
        this.#value(value, ancestors, depth, guard)
    })
  }

  /** Query only the current ancestor path; completed sibling occurrences remain independent. */
  isAncestor(value: object): boolean {
    return this.#active?.has(value) === true
  }

  /** Expose only this invocation's caller-owned native-byte guard. */
  get beforeNativeBinary(): (() => never) | undefined {
    return this.#beforeNativeBinary
  }

  /** Preserve the exact policy failure while ancestors unwind through container boundaries. */
  reject(reason: string, cause?: unknown): never {
    /** Bare invocation preserves the strategy callback's original undefined receiver. */
    const { violation } = this.#policy
    try {
      return violation(reason, cause)
    } catch (error) {
      this.#raised = error
      this.#didRaise = true
      this.#rawFailure = error === cause
      throw error
    }
  }

  /** Produce the unchanged inline byte tag and its fused accounting metadata. */
  #tagged(base64url: string): unknown {
    /** Finalization belongs to the captured caller policy. */
    const { finish } = this.#policy
    this.#nodeBytes = 31 + base64url.length
    this.#nodeBinary = true
    this.#nodeNative = false
    this.#nodeInvalid = undefined
    return finish(
      {
        [PortableBytesField.marker]: PortableBytesField.kind,
        [PortableBytesField.data]: base64url
      },
      false
    )
  }

  /** Visit one array child and immediately consume its primitive metadata slots. */
  #visitChild(child: unknown): unknown {
    /** Completed child value is returned only after its fused metadata is consumed. */
    const result = this.#walk(child, this.#visitDepth)
    this.#arrayBytes += this.#nodeBytes
    this.#arrayBinary ||= this.#nodeBinary
    this.#arrayNative ||= this.#nodeNative
    this.#arrayInvalid ??= this.#nodeInvalid
    this.#arrayVisited++
    return result
  }

  /** Preserve raw visitor lexical state across retained callbacks and getter-driven reentry. */
  #visitOwned(
    child: unknown,
    depth: number,
    ancestors: Set<object>,
    guard: (() => never) | undefined,
    bounds: boolean
  ): unknown {
    if (this.#invocationDepth === 0) return this.#execute(child, ancestors, depth, guard, false)
    /** Save the enclosing ancestor owner across synchronous reentry. */
    const previousActive = this.#active
    /** Save the enclosing caller guard until this invocation finishes. */
    const previousGuard = this.#beforeNativeBinary
    /** Restore the enclosing metadata mode after this traversal. */
    const previousBounds = this.#collectBounds
    this.#active = ancestors
    this.#beforeNativeBinary = guard
    this.#collectBounds = bounds
    try {
      /** Completed child value is returned only after its fused metadata is consumed. */
      const result = this.#walk(child, depth)
      this.#arrayBytes += this.#nodeBytes
      this.#arrayBinary ||= this.#nodeBinary
      this.#arrayNative ||= this.#nodeNative
      this.#arrayInvalid ??= this.#nodeInvalid
      this.#arrayVisited++
      return result
    } finally {
      this.#active = previousActive
      this.#beforeNativeBinary = previousGuard
      this.#collectBounds = previousBounds
    }
  }

  /** Dispatch one node; binary admission precedes ancestor and container ownership. */
  #walk(value: unknown, depth: number): unknown {
    /** Local hook bindings preserve callback receivers without per-node allocations. */
    const { maxDepth, scalar, binary, nativeByteLength, record } = this.#policy
    if (depth > maxDepth) this.reject(PortableViolation.depth)
    if (value === null || typeof value !== 'object') {
      /** Captured policy admission determines projection without rereading strategy getters. */
      const admitted = scalar(value, this.#context)
      if (admitted !== null && typeof admitted === 'object') {
        this.#nodeBytes = this.#collectBounds ? portableScalarBound(admitted.value) : 0
        this.#nodeInvalid = admitted.violation
        this.#nodeBinary = false
        this.#nodeNative = false
        return admitted.value
      }
      this.#nodeBytes = this.#collectBounds ? portableScalarBound(admitted) : 0
      this.#nodeInvalid = undefined
      this.#nodeBinary = false
      this.#nodeNative = false
      return admitted
    }
    /** Track this node's admitted binary value or accumulated byte bound. */
    const bytes = binary(value, this.#context)
    if (typeof bytes === 'string') return this.#tagged(bytes)
    if (bytes !== undefined) {
      this.#nodeBytes = this.#collectBounds ? nativeByteLength!(bytes) : 0
      this.#nodeBinary = true
      this.#nodeNative = true
      this.#nodeInvalid = undefined
      return bytes
    }
    /** Binary admission precedes cycle checks; a supplied Set keeps its exact existing ownership. */
    const ancestors = (this.#active ??= new Set<object>())
    /** Caller-owned Set failures keep a distinct policy boundary from container access traps. */
    let cyclic: boolean
    try {
      cyclic = ancestors.has(value)
      if (!cyclic) ancestors.add(value)
    } catch (cause) {
      return this.reject(PortableViolation.ancestor, cause)
    }
    if (cyclic) this.reject(PortableViolation.cycle)
    try {
      /** Captured policy admission determines projection without rereading strategy getters. */
      const admitted = record(value, this.#context)
      if (admitted?.tag !== undefined) return this.#tagged(admitted.tag)
      if (admitted === undefined) return this.#walkArray(value as unknown[], depth, ancestors)
      return this.#walkRecord(admitted, value, depth)
    } catch (cause) {
      if (this.#didRaise && cause === this.#raised && !this.#rawFailure) throw cause
      return this.reject(PortableViolation.access, cause)
    } finally {
      try {
        ancestors.delete(value)
      } catch (cause) {
        this.reject(PortableViolation.ancestor, cause)
      }
    }
  }

  /** Own one array accumulator frame and restore the enclosing frame on every exit. */
  #walkArray(value: unknown[], depth: number, ancestors: Set<object>): unknown {
    /** Array projection and finalization retain their original captured policy callbacks. */
    const { array, arrayValue, finish } = this.#policy

    /** Save only primitive visitor state; no array-frame object or request closure is allocated. */
    const previousDepth = this.#visitDepth
    /** Preserve the enclosing byte accumulator across child traversal. */
    const previousBytes = this.#arrayBytes
    /** Preserve the enclosing binary evidence across child traversal. */
    const previousBinary = this.#arrayBinary
    /** Preserve the enclosing native-byte evidence across child traversal. */
    const previousNative = this.#arrayNative
    /** Preserve the enclosing deferred failure priority across child traversal. */
    const previousInvalid = this.#arrayInvalid
    /** Restore the enclosing array visit count after this frame. */
    const previousVisited = this.#arrayVisited
    this.#visitDepth = depth + 1
    this.#arrayBytes = 2
    this.#arrayBinary = false
    this.#arrayNative = false
    this.#arrayInvalid = undefined
    this.#arrayVisited = 0
    try {
      /** Caller policy chooses the projected array before metadata is observed. */
      const admittedArray = arrayValue
        ? arrayValue(
            value as unknown[],
            this.#ownedVisit,
            depth + 1,
            ancestors,
            this.#beforeNativeBinary,
            this.#collectBounds,
            this.#context
          )
        : array(value as unknown[], this.#visit, this.#context)
      /** Raw array results must not be probed as annotation objects. */
      const raw = arrayValue !== undefined || Array.isArray(admittedArray)
      /** Annotated admission remains the default; raw policy outputs are never probed. */
      const annotation = admittedArray as Readonly<{
        value: unknown[]
        length?: number
        violation?: string
      }>
      /** Projected value remains owned by the current node until admission finishes. */
      const output = raw ? admittedArray : annotation.value
      if (this.#collectBounds) {
        /** Captured output length determines punctuation and sparse-hole byte bounds. */
        const length = raw
          ? (output as unknown[]).length
          : (annotation.length ?? (output as unknown[]).length)
        this.#nodeBytes =
          this.#arrayBytes + Math.max(0, length - 1) + Math.max(0, length - this.#arrayVisited) * 4
      } else this.#nodeBytes = 0
      this.#nodeBinary = this.#arrayBinary
      this.#nodeNative = this.#arrayNative
      this.#nodeInvalid = this.#arrayInvalid ?? (raw ? undefined : annotation.violation)
      return finish(output, this.#nodeNative)
    } finally {
      this.#visitDepth = previousDepth
      this.#arrayBytes = previousBytes
      this.#arrayBinary = previousBinary
      this.#arrayNative = previousNative
      this.#arrayInvalid = previousInvalid
      this.#arrayVisited = previousVisited
    }
  }

  /** Traverse admitted record entries once while preserving deferred validation priority. */
  #walkRecord(admitted: IPortableRecord, value: object, depth: number): unknown {
    /** Bare hooks retain the strategy's original receiver semantics. */
    const { key, write, finish } = this.#policy
    /** Projected value remains owned by the current node until admission finishes. */
    const output = admitted.output ?? (value as Record<string, unknown>)
    /** Parent-local accounting stays on the ordinary call stack across child calls. */
    let bytes = 2
    /** Accumulate generic inline or native binary evidence for this record. */
    let binary = admitted.hasBinary === true
    /** Accumulate only native descendant evidence for finalization. */
    let native = false
    /** Retain the first child violation until record validation can choose priority. */
    let pending: string | undefined
    /** Count admitted record fields for separator accounting only. */
    let count = 0
    for (const [name, child] of admitted.entries) {
      key(name, this.#context)
      /** Finish the child before writing the next output field or reading the next getter. */
      const normalized = this.#walk(child, depth + 1)
      if (admitted.output !== undefined) write(output, name, normalized)
      if (this.#collectBounds)
        bytes += portableScalarBound(name) + 1 + this.#nodeBytes + (count++ ? 1 : 0)
      binary ||= this.#nodeBinary
      native ||= this.#nodeNative
      pending ??= this.#nodeInvalid
    }
    this.#nodeBytes = bytes
    this.#nodeBinary = binary
    this.#nodeNative = native
    this.#nodeInvalid = admitted.validate?.(output) ?? pending
    return finish(output, native)
  }

  /** Save and restore primitive invocation slots around the one recursive traversal. */
  #execute(
    value: unknown,
    ancestors: Set<object> | undefined,
    depth: number,
    guard: (() => never) | undefined,
    metadata: boolean
  ): unknown {
    /** Restore the enclosing metadata mode after this traversal. */
    const previousBounds = this.#collectBounds
    /** Save the enclosing ancestor owner across synchronous reentry. */
    const previousActive = this.#active
    /** Save the enclosing caller guard until this invocation finishes. */
    const previousGuard = this.#beforeNativeBinary
    /** Restore the enclosing exact policy failure for ancestor unwinding. */
    const previousRaised = this.#raised
    /** Retain whether the enclosing frame already classified a thrown value. */
    const previousDidRaise = this.#didRaise
    /** Retain the enclosing distinction between raw and classified policy failures. */
    const previousRaw = this.#rawFailure
    /** Preserve the enclosing byte accumulator across child traversal. */
    const previousBytes = this.#nodeBytes
    /** Preserve the enclosing binary evidence across child traversal. */
    const previousBinary = this.#nodeBinary
    /** Preserve the enclosing native-byte evidence across child traversal. */
    const previousNative = this.#nodeNative
    /** Preserve the enclosing deferred failure priority across child traversal. */
    const previousInvalid = this.#nodeInvalid
    this.#collectBounds = metadata
    this.#active = ancestors
    this.#beforeNativeBinary = guard
    this.#raised = undefined
    this.#didRaise = false
    this.#rawFailure = false
    this.#invocationDepth++
    try {
      /** Projected value remains owned by the current node until admission finishes. */
      const output = this.#walk(value, depth)
      if (this.#nodeInvalid !== undefined) this.reject(this.#nodeInvalid)
      return metadata
        ? Object.freeze({
            value: output,
            byteUpperBound: this.#nodeBytes,
            hasBinary: this.#nodeBinary
          })
        : output
    } catch (cause) {
      if (this.#didRaise && cause === this.#raised) throw cause
      return this.reject(PortableViolation.access, cause)
    } finally {
      this.#invocationDepth--
      this.#collectBounds = previousBounds
      this.#active = previousActive
      this.#beforeNativeBinary = previousGuard
      this.#raised = previousRaised
      this.#didRaise = previousDidRaise
      this.#rawFailure = previousRaw
      this.#nodeBytes = previousBytes
      this.#nodeBinary = previousBinary
      this.#nodeNative = previousNative
      this.#nodeInvalid = previousInvalid
    }
  }

  /** Skip empty-frame bookkeeping only for an outer scalar, preserving reentrant behavior. */
  #value(
    value: unknown,
    ancestors: Set<object> | undefined,
    depth: number,
    guard: (() => never) | undefined
  ): unknown {
    if (this.#invocationDepth !== 0 || (value !== null && typeof value === 'object'))
      return this.#execute(value, ancestors, depth, guard, false)
    // An outer scalar cannot have a previous frame; keep the same walk without saving empty slots.
    this.#collectBounds = false
    this.#active = ancestors
    this.#beforeNativeBinary = guard
    this.#invocationDepth = 1
    try {
      /** Projected value remains owned by the current node until admission finishes. */
      const output = this.#walk(value, depth)
      if (this.#nodeInvalid !== undefined) this.reject(this.#nodeInvalid)
      return output
    } catch (cause) {
      if (this.#didRaise && cause === this.#raised) throw cause
      return this.reject(PortableViolation.access, cause)
    } finally {
      this.#invocationDepth = 0
      this.#collectBounds = true
      this.#active = undefined
      this.#beforeNativeBinary = undefined
      this.#raised = undefined
      this.#didRaise = false
      this.#rawFailure = false
      this.#nodeInvalid = undefined
    }
  }
}
