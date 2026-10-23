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

/** New tasks always create a genuine child host using the exact opaque handle they received. */
export function service(label: string, report: (error: unknown) => void) {
  /** Explicit generations retain independent handles, completions and child host identities. */
  const contexts: ICoroutineTaskContext[] = []
  const finishes: ReturnType<typeof deferred<void>>[] = []
  const children: IRpcHost[] = []
  const finished: ICoroutineConnect[] = []
  const notices: unknown[] = []
  const cancellation = { entered: 0, cancelled: 0 }
  /** One task entry is one actual supervised invocation, not a copied connection recipe. */
  const task: ICoroutineUserTask = async (context) => {
    /** A caller may reject this original task after its actual child connection became ready. */
    const finish = deferred<void>()
    void finish.promise.catch(() => undefined)
    contexts.push(context)
    finishes.push(finish)
    /** Generation-local values expose any accidental reuse of another task's native channel. */
    const generation = contexts.length
    const child = await createRpcHost({
      plugins: [coroutinePlugin({ connectToParent: context.connect })],
      report,
      provide: {
        read: (payload: unknown) => [label, generation, payload],
        notice: (payload: unknown) => {
          notices.push(payload)
        },
        values: async function* () {
          yield label
          yield generation
        },
        wait: (_payload: unknown, call: IRpcContext) =>
          new Promise<void>((_resolve, reject) => {
            cancellation.entered += 1
            /** Provider cancellation retains the canonical invocation's exact reason. */
            const cancel = () => {
              cancellation.cancelled += 1
              reject(call.signal.reason)
            }
            if (call.signal.aborted) cancel()
            else call.signal.addEventListener('abort', cancel, { once: true })
          })
      }
    })
    children.push(child)
    try {
      await Promise.race([finish.promise, aborted(context.signal)])
    } finally {
      await child.close()
      finished.push(context.connect)
    }
  }
  return { task, contexts, finishes, children, finished, notices, cancellation }
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
