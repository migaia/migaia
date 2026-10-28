/** Owns per-unit diagnostic output and bounded byte tails; sinks only observe drained data. */
import type { IUnitRuntime } from '../index.js'
import { DrainedStream } from './constants.js'
import type { IProcessLaunchContext } from './types.js'

/** One unit's bounded diagnostic tails and an always-draining output sink. */
export type IOutputAttachment = {
  readonly sink: IProcessLaunchContext['output']
  readonly stdoutTail: Uint8Array
  readonly stderrTail: Uint8Array
}

/** Delivers passive output observations without handing ownership of the drain loop to a sink. */
export function deliverOutput(
  sink: IProcessLaunchContext['output'] | undefined,
  stream: DrainedStream,
  chunk: Uint8Array,
  report: (error: unknown) => void
): void {
  try {
    sink?.(stream, chunk)
  } catch (error) {
    report(error)
  }
}

/** Keeps only the final bytes of each stream while isolating consumer callbacks. */
export function attachOutput(
  unit: IUnitRuntime,
  tailBytes: number,
  report: (error: unknown) => void,
  onChunk?: IProcessLaunchContext['output']
): IOutputAttachment {
  return new OutputAttachment(tailBytes, report, onChunk).attach(unit)
}

/** One stream ring copies only incoming bytes; snapshots own their returned storage. */
class OutputTail {
  /** Storage grows with observed output, avoiding eager allocation of the configured bound. */
  #bytes = new Uint8Array()
  /** Maximum diagnostic bytes retained for this stream. */
  #capacity: number
  /** Next ring write position. */
  #cursor = 0
  /** Number of retained bytes, capped by the admitted capacity. */
  #size = 0

  /** Stores the bound without allocating the full diagnostic tail before output exists. */
  constructor(capacity: number) {
    this.#capacity = capacity
  }

  /** Appends incoming bytes; only geometric growth revisits the retained prefix. */
  append(chunk: Uint8Array): void {
    if (chunk.length === 0) return
    this.#reserve(Math.min(this.#capacity, this.#size + chunk.length))
    if (chunk.length >= this.#capacity) {
      this.#bytes.set(chunk.subarray(chunk.length - this.#capacity))
      this.#cursor = 0
      this.#size = this.#capacity
      return
    }
    /** Only the boundary-crossing suffix requires a second contiguous copy. */
    const first = Math.min(chunk.length, this.#bytes.length - this.#cursor)
    this.#bytes.set(chunk.subarray(0, first), this.#cursor)
    if (first < chunk.length) this.#bytes.set(chunk.subarray(first), 0)
    this.#cursor = (this.#cursor + chunk.length) % this.#bytes.length
    this.#size = Math.min(this.#capacity, this.#size + chunk.length)
  }

  /** Geometric growth copies each retained byte only amortized O(1), without eager capacity cost. */
  #reserve(required: number): void {
    if (required <= this.#bytes.length) return
    /** Capacity follows observed payload rather than a possibly large configured upper bound. */
    const next = new Uint8Array(
      Math.min(this.#capacity, Math.max(required, this.#bytes.length * 2))
    )
    /** A full old ring begins at its cursor; a partial ring still begins at zero. */
    const start = this.#size === this.#bytes.length ? this.#cursor : 0
    /** Copy each chronological segment directly into the expanded storage. */
    const first = Math.min(this.#size, this.#bytes.length - start)
    next.set(this.#bytes.subarray(start, start + first))
    if (first < this.#size) next.set(this.#bytes.subarray(0, this.#size - first), first)
    this.#bytes = next
    this.#cursor = this.#size
  }

  /** Returns a fresh chronological snapshot, preserving the public mutable-copy contract. */
  snapshot(): Uint8Array {
    /** Inspection, rather than every write, pays for copying the complete retained tail. */
    const result = new Uint8Array(this.#size)
    /** Until full, the retained bytes begin at zero; once full they begin at the cursor. */
    const start = this.#size === this.#bytes.length ? this.#cursor : 0
    /** At most two segments restore chronological order after ring wraparound. */
    const first = Math.min(this.#size, this.#bytes.length - start)
    result.set(this.#bytes.subarray(start, start + first))
    if (first < this.#size) result.set(this.#bytes.subarray(0, this.#size - first), first)
    return result
  }
}

/** One unit owns its two tails, active state and passive output observer. */
class OutputAttachment {
  /** Output after scope teardown is ignored before touching tails or user callbacks. */
  #active = true
  /** Standard output has an independent byte bound and chronological snapshot. */
  #stdoutTail: OutputTail
  /** Standard error has the same bound without sharing payload storage. */
  #stderrTail: OutputTail
  /** Observer failures retain their original identity at the report boundary. */
  #report: (error: unknown) => void
  /** Optional streaming observer receives every active chunk after the tail update. */
  #onChunk?: IProcessLaunchContext['output']

  /** Both stream owners remain lazy about payload allocation. */
  constructor(
    tailBytes: number,
    report: (error: unknown) => void,
    onChunk?: IProcessLaunchContext['output']
  ) {
    this.#stdoutTail = new OutputTail(tailBytes)
    this.#stderrTail = new OutputTail(tailBytes)
    this.#report = report
    this.#onChunk = onChunk
  }

  /** Registers cleanup before exposing the original own accessor/method shape. */
  attach(unit: IUnitRuntime): IOutputAttachment {
    unit.scope.own({ close: () => this.#close() }, { force: () => this.#close() })
    return OutputAttachment.port(this)
  }

  /** Ordinary own getters preserve descriptors and accessor function names without receiver binding. */
  static port(attachment: OutputAttachment): IOutputAttachment {
    return {
      sink: (stream, chunk) => attachment.#receive(stream, chunk),
      get stdoutTail() {
        return attachment.#stdoutTail.snapshot()
      },
      get stderrTail() {
        return attachment.#stderrTail.snapshot()
      }
    }
  }

  /** Stores recognized stream bytes before reporting or forwarding the active chunk. */
  #receive(stream: DrainedStream, chunk: Uint8Array): void {
    if (!this.#active) return
    if (stream === DrainedStream.stdout) this.#stdoutTail.append(chunk)
    else if (stream === DrainedStream.stderr) this.#stderrTail.append(chunk)
    deliverOutput(this.#onChunk, stream, chunk, this.#report)
  }

  /** The scope's close and force phases share idempotent output retirement. */
  #close(): void {
    this.#active = false
  }
}
