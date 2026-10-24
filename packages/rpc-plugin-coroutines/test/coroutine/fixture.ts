import { PluginHost } from '@migaia/plugin-host'
import { createRpcHost, type IRpcHost, type IRpcContext } from '@migaia/rpc-host'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import {
  coroutinePlugin,
  type ICoroutineConnect,
  type ICoroutineReplaceSpec,
  type ICoroutineTaskContext,
  type ICoroutineUserTask
} from '../../dist/index.js'
import type { IRuntimeOutlet } from '../../../rpc-host/dist/remote/runtime-api/outlet.js'

/** Cooperative task completion observes only its actual original cancellation signal. */
export async function aborted(signal: IAbortSignal): Promise<void> {
  if (signal.aborted) return
  await new Promise<void>((resolve) =>
    signal.addEventListener('abort', () => resolve(), { once: true })
  )
}

/**
 * Yield this generation's original provider values without capturing the provider object's
 * receiver.
 */
async function* coroutineValues(
  label: string,
  generation: number
): AsyncIterableIterator<string | number> {
  yield label
  yield generation
}

/** New tasks always create a genuine child host using the exact opaque handle they received. */
/** Allocate only this case's original observations before installing native-shaped callbacks. */
function coroutineServiceFixtureState(label: string, report: (error: unknown) => void) {
  const contexts: ICoroutineTaskContext[] = []
  const finishes: ReturnType<typeof deferred<void>>[] = []
  const children: IRpcHost[] = []
  const finished: ICoroutineConnect[] = []
  const notices: unknown[] = []
  const cancellation = { entered: 0, cancelled: 0 }
  return { label, report, contexts, finishes, children, finished, notices, cancellation }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class CoroutineServiceFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof coroutineServiceFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor(label: string, report: (error: unknown) => void) {
    this.#state = coroutineServiceFixtureState(label, report)

    this.value = {
      task: this.#task,
      contexts: this.#state.contexts,
      finishes: this.#state.finishes,
      children: this.#state.children,
      finished: this.#state.finished,
      notices: this.#state.notices,
      cancellation: this.#state.cancellation
    }
  }
  /** Drive the original fixture operation through its sole state owner. */
  #task: ICoroutineUserTask = async (context) => {
    /** A caller may reject this original task after its actual child connection became ready. */
    const finish = deferred<void>()
    void finish.promise.catch(() => undefined)
    this.#state.contexts.push(context)
    this.#state.finishes.push(finish)
    /** Generation-local values expose any accidental reuse of another task's native channel. */
    const generation = this.#state.contexts.length
    const child = await createRpcHost({
      plugins: [coroutinePlugin({ connectToParent: context.connect })],
      report: this.#state.report,
      provide: {
        read: (payload: unknown) => [this.#state.label, generation, payload],
        notice: (payload: unknown) => {
          this.#state.notices.push(payload)
        },
        values: () => coroutineValues(this.#state.label, generation),
        wait: (_payload: unknown, call: IRpcContext) =>
          new Promise<void>((_resolve, reject) => {
            this.#state.cancellation.entered += 1
            /** Provider cancellation retains the canonical invocation's exact reason. */
            const cancel = () => {
              this.#state.cancellation.cancelled += 1
              reject(call.signal.reason)
            }
            if (call.signal.aborted) cancel()
            else call.signal.addEventListener('abort', cancel, { once: true })
          })
      }
    })
    this.#state.children.push(child)
    try {
      await Promise.race([finish.promise, aborted(context.signal)])
    } finally {
      await child.close()
      this.#state.finished.push(context.connect)
    }
  }
}

/** Create one independent owner for the existing native-boundary fixture. */
export function service(label: string, report: (error: unknown) => void) {
  return new CoroutineServiceFixture(label, report).value
}

/** Ordinary plugin-host retains its real mutation, slot and disposer owners. */
export function ordinaryHost() {
  return new PluginHost<Record<string, never>>({
    execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
  })
}

/** The owning package types replacement; generic host only transports its opaque specification. */
type ITestCoroutineOutlet = Omit<IRuntimeOutlet, 'replace'> &
  Readonly<{
    replace(name: string, spec?: ICoroutineReplaceSpec): ReturnType<IRuntimeOutlet['replace']>
  }>

/** Read the real public coroutine facade, without creating an alternate outlet or registry. */
export function outlet(host: object): ITestCoroutineOutlet {
  return Reflect.get(host, 'coroutine') as ITestCoroutineOutlet
}

/** Consume the exact returned iterator and preserve its ordinary settlement. */
export async function values(stream: AsyncIterable<unknown>): Promise<unknown[]> {
  const result: unknown[] = []
  for await (const value of stream) result.push(value)
  return result
}
