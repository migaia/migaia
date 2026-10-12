import {
  createEventTargetMessageResource,
  type IAdapterMessageResource
} from '@migaia/rpc-core/adapter'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { threadRuntimeResource } from './runtime-resource.js'
import type { IThreadWebPort } from './types.js'

/** A child guard and its automatic Peer share Core's one original raw bootstrap owner. */
const webChildResources = new WeakMap<IThreadWebPort, IAdapterMessageResource>()

/** Discover a real dedicated Worker global without treating the context as bootstrap authority. */
export function threadWebParent(): IThreadWebPort | undefined {
  /** Browser Workers have a native dedicated-global identity rather than an injected label. */
  const Scope = Reflect.get(globalThis, 'DedicatedWorkerGlobalScope') as
    | (new (...args: never[]) => object)
    | undefined
  /** Deno's actual Worker global uses a different native constructor identity. */
  const DenoScope = Reflect.get(globalThis, 'Deno')
    ? (Reflect.get(globalThis, 'WorkerGlobalScope') as
        | (new (...args: never[]) => object)
        | undefined)
    : undefined
  /** Bun exposes its own native thread flag while retaining EventTarget parent messaging. */
  const bun = Reflect.get(globalThis, 'Bun') as { isMainThread?: boolean } | undefined
  if (
    (typeof Scope === 'function' && globalThis instanceof Scope) ||
    (typeof DenoScope === 'function' && globalThis instanceof DenoScope) ||
    (bun?.isMainThread === false && typeof Reflect.get(globalThis, 'postMessage') === 'function')
  )
    return globalThis as unknown as IThreadWebPort
  return undefined
}

/** Reuse the guard's captured bootstrap when automatic Peer construction takes this actual port. */
export function threadChildResource(port: IThreadWebPort): IAdapterMessageResource {
  /** Resource identity preserves Core's original capture and never accepts a claimed agreement. */
  let resource = webChildResources.get(port)
  if (!resource) {
    resource = createEventTargetMessageResource(port)
    webChildResources.set(port, resource)
  }
  return resource
}

/**
 * Read the library launcher's existing bootstrap in the actual child runtime. Await this guard
 * before self-spawning: a Web child must first receive its parent's initial message. This
 * identifies a branch only; Core still performs the original capability admission.
 */
export async function isThreadChild(): Promise<boolean> {
  /** Web bootstrap remains buffered by the same held resource later used by createThreadPeer. */
  const parent = threadWebParent()
  if (parent) {
    await threadChildResource(parent).receiveInitial(undefined, true)
    return true
  }
  if (Reflect.get(globalThis, 'Bun') || Reflect.get(globalThis, 'Deno')) return false
  if (typeof process === 'undefined' || process.versions?.node === undefined) return false
  /** Node workerData is the original native initial value, available without adding a wire marker. */
  const native = await threadRuntimeResource.load()
  return (
    native.parentPort !== null && rpcMessageCapabilityControl.readInitial(native.workerData).valid
  )
}
