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
  let active = true
  let stdoutTail: Uint8Array<ArrayBufferLike> = new Uint8Array()
  let stderrTail: Uint8Array<ArrayBufferLike> = new Uint8Array()
  unit.scope.own(
    {
      close: () => {
        active = false
      }
    },
    {
      force: () => {
        active = false
      }
    }
  )
  const append = (tail: Uint8Array, chunk: Uint8Array): Uint8Array => {
    if (chunk.length >= tailBytes) return chunk.slice(chunk.length - tailBytes)
    const keep = Math.min(tail.length, tailBytes - chunk.length)
    const next = new Uint8Array(keep + chunk.length)
    next.set(tail.subarray(tail.length - keep))
    next.set(chunk, keep)
    return next
  }
  return {
    sink: (stream, chunk) => {
      if (!active) return
      if (stream === DrainedStream.stdout) stdoutTail = append(stdoutTail, chunk)
      else if (stream === DrainedStream.stderr) stderrTail = append(stderrTail, chunk)
      deliverOutput(onChunk, stream, chunk, report)
    },
    get stdoutTail() {
      return stdoutTail.slice()
    },
    get stderrTail() {
      return stderrTail.slice()
    }
  }
}
