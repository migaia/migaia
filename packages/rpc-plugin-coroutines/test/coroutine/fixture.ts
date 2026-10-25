import { PluginHost } from '@migaia/plugin-host'
import {
  createRpcHost,
  type IRpcHost,
  type IRpcContext,
  type IRpcNamespace
} from '@migaia/rpc-host'
import { deferred, type IAbortSignal } from '@migaia/utils/promise'
import {
  coroutinePlugin,
  type ICoroutineConnect,
  type ICoroutineTaskContext,
  type ICoroutineUserTask
} from '@migaia/rpc-plugin-coroutines'
import { assert } from 'vitest'
import type { ICoroutineNamespaceExtensions } from '@migaia/rpc-plugin-coroutines'

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
function coroutineServiceFixtureState(
  label: string,
  report: (error: unknown) => void,
  runtime: boolean,
  late: boolean
) {
  const contexts: ICoroutineTaskContext[] = []
  const finishes: ReturnType<typeof deferred<void>>[] = []
  const children: IRpcHost[] = []
  const finished: ICoroutineConnect[] = []
  const notices: unknown[] = []
  const cancellation = { entered: 0, cancelled: 0 }
  /** Runtime-mode cases retain their original child installation barrier. */
  const installed = deferred<void>()
  return {
    label,
    report,
    runtime,
    late,
    contexts,
    finishes,
    children,
    finished,
    notices,
    cancellation,
    installed
  }
}

/** Own one test resource's mutable observations without sharing a factory closure. */
class CoroutineServiceFixture {
  /** Counts, native events and construction inputs belong only to this fixture instance. */
  #state: ReturnType<typeof coroutineServiceFixtureState>
  /** Existing consumers retain the same observable fixture surface and callback identities. */
  readonly value
  /** Install the original native-shaped callbacks after their observations exist. */
  constructor(label: string, report: (error: unknown) => void, runtime = false, late = false) {
    this.#state = coroutineServiceFixtureState(label, report, runtime, late)

    this.value = {
      task: this.#task,
      contexts: this.#state.contexts,
      finishes: this.#state.finishes,
      children: this.#state.children,
      finished: this.#state.finished,
      notices: this.#state.notices,
      cancellation: this.#state.cancellation,
      installed: this.#state.installed.promise
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
    /** Reverse callbacks retain only this task's exact child, never a successor by name. */
    const current: { child?: IRpcHost } = {}
    /** Both existing fixture modes share provider lifecycle and differ only in asserted payloads. */
    const provide = {
      read: (payload: unknown) =>
        this.#state.runtime
          ? [this.#state.label, payload]
          : [this.#state.label, generation, payload],
      notice: (payload: unknown) => {
        this.#state.notices.push(payload)
      },
      values: () =>
        this.#state.runtime ? runtimeValues() : coroutineValues(this.#state.label, generation),
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
        }),
      reverse: (payload: import('@migaia/rpc-contract/protocol').IRpcPortableValue) =>
        current.child!.coroutine.request('parent.read', payload)
    }
    /** The actual global Host owns providers before exposing the genuine parent connection. */
    const child = await createRpcHost({
      plugins: [coroutinePlugin({ connectToParent: context.connect })],
      report: this.#state.report,
      provide: this.#state.runtime ? { service: provide } : provide
    })
    current.child = child
    this.#state.children.push(child)
    this.#state.installed.resolve()
    try {
      if (this.#state.late) await finish.promise
      else await Promise.race([finish.promise, aborted(context.signal)])
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

/** Read the actual namespace and native member extension without creating a facade. */
export function outlet(host: object): IRpcNamespace & ICoroutineNamespaceExtensions {
  return Reflect.get(host, 'coroutine') as IRpcNamespace & ICoroutineNamespaceExtensions
}

/** Consume the exact returned iterator and preserve its ordinary settlement. */
export async function values(stream: ReturnType<IRpcNamespace['stream']>): Promise<unknown[]> {
  assert(Symbol.asyncIterator in stream)
  const result: unknown[] = []
  for await (const value of stream) result.push(value)
  return result
}

/** Runtime migration retains its original service payloads while sharing the existing fixture owner. */
export function runtimeService(label: string, report: (error: unknown) => void, late = false) {
  return new CoroutineServiceFixture(label, report, true, late).value
}

/** Original runtime service stream order stays independent from generation-labelled fixture values. */
function* runtimeValues() {
  yield 1
  yield 2
  yield 3
}
