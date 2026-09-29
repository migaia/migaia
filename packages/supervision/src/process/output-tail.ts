import type { IUnitRuntime } from '../index.js'
import { DrainedStream } from './constants.js'
import type { IProcessLaunchContext } from './types.js'

/** One unit's bounded diagnostic tails and an always-draining output sink. */
export type IOutputAttachment = {
  readonly sink: IProcessLaunchContext['output']
  readonly stdoutTail: Uint8Array
  readonly stderrTail: Uint8Array
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
      try {
        onChunk?.(stream, chunk)
      } catch (error) {
        report(error)
      }
    },
    get stdoutTail() {
      return stdoutTail.slice()
    },
    get stderrTail() {
      return stderrTail.slice()
    }
  }
}
