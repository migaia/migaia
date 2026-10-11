import type { IProcessLauncher, IProcessSpec } from '@migaia/supervision/process'
import { holdAdapterLaunch } from '@migaia/rpc-core/adapter'
import { readAdapterAbortReason as resolveAbortReason } from '@migaia/rpc-core/adapter'
import {
  prepareProcessRuntimeBootstrap,
  invalidProcessRuntimeBootstrap
} from './runtime-bootstrap.js'
import type { IProcessRuntimeBootstrapOptions } from './runtime-bootstrap.js'
import { createAdapterWebByteIO } from './web-byte-stream.js'

/** The supervisor's actual launch request carries its signal and private reserved generation. */
export type IAdapterProcessLaunchContext = Parameters<IProcessLauncher['launch']>[1]
/** Explicit bootstrap data remains the original caller opt-in, never a context/proof assertion. */
export type IAdapterProcessLaunchOptions = Readonly<{
  runtimeApiBootstrap?: IProcessRuntimeBootstrapOptions
}>

/** One launch operation owns bootstrap preparation and acts only on the supplied execution and I/O. */
export class AdapterProcessLaunch {
  /** Keep this actual launch's signal for the original post-spawn cancellation points. */
  #context: IAdapterProcessLaunchContext
  /** The sole bootstrap allocation is retained for the exact native write and returned identity. */
  #bootstrap: ReturnType<typeof prepareProcessRuntimeBootstrap> | undefined

  /** Prepare secret bootstrap before Native performs spawn, preserving the original option reads. */
  constructor(
    spec: IProcessSpec,
    context: IAdapterProcessLaunchContext,
    options: IAdapterProcessLaunchOptions
  ) {
    this.#context = context
    /** Only the original held supervisor request can expose Core's private launch context. */
    const runtime = holdAdapterLaunch(context).proposal
    /** Keep the original short-circuit reads of the caller's explicit bootstrap option. */
    const runtimeApiBootstrap = runtime
      ? {
          name: runtime.childName ?? options.runtimeApiBootstrap?.name ?? runtime.self.name,
          parentInstanceId: runtime.self.instanceId,
          ...(runtime.generation ? { generation: runtime.generation } : {})
        }
      : options.runtimeApiBootstrap
    if (runtimeApiBootstrap && context.signal.aborted) throw resolveAbortReason(context.signal)
    if (
      runtimeApiBootstrap &&
      (spec.bootstrap?.via !== 'stdin' ||
        spec.stdio.stdin !== 'channel' ||
        spec.stdio.stdout !== 'channel')
    )
      invalidProcessRuntimeBootstrap()
    this.#bootstrap = runtimeApiBootstrap
      ? prepareProcessRuntimeBootstrap(runtimeApiBootstrap, spec.bootstrap?.payload)
      : undefined
  }

  /** Native writes these exact prepared bytes and publishes their same safe runtime identity. */
  get bootstrap(): ReturnType<typeof prepareProcessRuntimeBootstrap> | undefined {
    return this.#bootstrap
  }

  /** Retain the original actual-signal rejection without exposing an abort-error helper. */
  assertActive(): void {
    if (this.#context.signal.aborted) throw resolveAbortReason(this.#context.signal)
  }

  /** Construct and defer only this new channel from the actual held Web Streams. */
  createWebChannel(readable: ReadableStream<Uint8Array>, writable: WritableStream<Uint8Array>) {
    /** Core builds the channel itself before assigning its private receive hand-off state. */
    const channel = createAdapterWebByteIO(readable, writable)
    return channel
  }
}

/** A custom process launcher gives Core its actual spec/request and later its owned byte streams. */
export function createAdapterProcessLaunch(
  spec: IProcessSpec,
  context: IAdapterProcessLaunchContext,
  options: IAdapterProcessLaunchOptions = {}
) {
  return new AdapterProcessLaunch(spec, context, options)
}
