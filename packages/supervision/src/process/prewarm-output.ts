/** Owns ordered idle output; only whole oldest chunks are evicted before handoff. */
import { DrainedStream } from './constants.ts'
import { deliverOutput } from './output-tail.ts'
import type { IProcessLaunchContext } from './types.ts'

/** Baseline pool retention bound; one final oversized chunk is deliberately retained. */
const OUTPUT_BYTES = 65_536

/** Incremental queue avoids revisiting buffered chunks on every write. */
export class PrewarmOutput {
  /** Live chunks retain source order without retaining consumed array slots. */
  #chunks = new Map<number, { stream: DrainedStream; chunk: Uint8Array }>()
  /** Monotonic keys keep insertion and removal independent of queue length. */
  #sequence = 0
  /** First live key translates the baseline array's current indexes without prefix moves. */
  #headKey = 0
  /** Total retained payload, updated only when a chunk enters or leaves. */
  #bytes = 0

  /** Copies one incoming chunk and evicts each obsolete chunk at most once. */
  append(stream: DrainedStream, chunk: Uint8Array): void {
    /** Count the owned snapshot, matching the baseline's post-copy length calculation. */
    const buffered = chunk.slice()
    this.#chunks.set(this.#sequence++, { stream, chunk: buffered })
    this.#bytes += buffered.length
    while (this.#bytes > OUTPUT_BYTES && this.#chunks.size > 1) {
      /** Every eviction advances the same logical head that Array.shift used to move. */
      const oldest = this.#chunks.get(this.#headKey)!
      this.#bytes -= oldest.chunk.length
      this.#chunks.delete(this.#headKey++)
    }
  }

  /** Preserves array-index iteration when a replay callback synchronously appends and evicts. */
  drain(sink: IProcessLaunchContext['output'], report: (error: unknown) => void): void {
    for (let index = 0; index < this.#chunks.size; index++) {
      /** Re-read the current head after each callback, matching Array's live logical indexes. */
      const item = this.#chunks.get(this.#headKey + index)!
      deliverOutput(sink, item.stream, item.chunk, report)
    }
    this.#chunks.clear()
    this.#bytes = 0
    this.#headKey = this.#sequence
  }
}
