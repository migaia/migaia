/** Own one parent coroutine task's abort observation; RPC and the child Host retain cleanup. */
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import type { ICoroutineConnect } from '@migaia/rpc-plugin-coroutines'
import { disposeChildHost, serveChild } from '../child/serve.ts'
import type { ITrayRuntimeOptions } from '../runtime.ts'
import type { ITrayRecord } from './registry.ts'

/** Coroutine task construction borrows the exact caller signal and native connect authority. */
export type ITrayCoroutineContext = Readonly<{
  connect: ICoroutineConnect
  signal: IAbortSignal
}>

/** Race the original child exit against task abort, then run the original child cleanup sequence. */
export async function runCoroutineTask(
  record: ITrayRecord,
  options: Pick<ITrayRuntimeOptions, 'probe'>,
  report: (error: unknown) => void,
  context: ITrayCoroutineContext
): Promise<void> {
  /** Business execution and exit retain the same original child Host. */
  const child = await serveChild(
    record.definition,
    { report, probe: options.probe },
    context.connect
  )
  /** This task alone owns the abort listener and the independent Utils deferred. */
  const aborted = new CoroutineAbort(context.signal)
  try {
    await Promise.race([aborted.promise, child.exited])
  } finally {
    aborted.release()
    await disposeChildHost(child.host, child.shutdown, report, child.transportName)
  }
}

/** One signal observation ends with native abort or this task's original finally cleanup. */
class CoroutineAbort {
  /** Utils remains the single pending task-abort Promise owner. */
  readonly #aborted = deferred<void>()
  /** Only the original task signal can settle this observation. */
  readonly #signal: IAbortSignal
  /** An already aborted task acquired no listener and therefore has no release obligation. */
  readonly #listening: boolean

  /** Match the original aborted-before-listen behavior without manufacturing a cancellation error. */
  constructor(signal: IAbortSignal) {
    this.#signal = signal
    this.#listening = !signal.aborted
    if (this.#listening) signal.addEventListener('abort', this.#stop, { once: true })
    else this.#aborted.resolve()
  }

  /** Native abort releases this exact listener before resolving its original wait. */
  readonly #stop = (): void => {
    this.#signal.removeEventListener('abort', this.#stop)
    this.#aborted.resolve()
  }

  /** Parent task races this exact Promise with the child's unchanged exit Promise. */
  get promise(): Promise<void> {
    return this.#aborted.promise
  }

  /** Final cleanup releases only a listener that this observation actually acquired. */
  release(): void {
    if (this.#listening) this.#signal.removeEventListener('abort', this.#stop)
  }
}
