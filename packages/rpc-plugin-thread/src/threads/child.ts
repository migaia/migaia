import { detectServerRuntime, detectGlobalScope, ServerRuntime } from '@migaia/utils'
import {
  createEventTargetMessageResource,
  type IAdapterMessageResource
} from '@migaia/rpc-host/plugin'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { readNodeThreadRuntime } from './runtime-resource.js'
import type { IThreadWebPort } from './types.js'

/** A child guard and its automatic Peer share Core's one original raw bootstrap owner. */
const webChildResources = new WeakMap<IThreadWebPort, IAdapterMessageResource>()

/** Discover a real dedicated Worker global without treating the context as bootstrap authority. */
export function threadWebParent(): IThreadWebPort | undefined {
  /** Canonical server selection excludes browser globals before reading native thread facts. */
  const runtime = detectServerRuntime()
  /** Browser scope identity never selects this package's native Worker owner. */
  const scope = detectGlobalScope()
  if (runtime === undefined && scope !== undefined) return undefined
  if (
    runtime === ServerRuntime.deno &&
    typeof Reflect.get(globalThis, 'WorkerGlobalScope') === 'function' &&
    globalThis instanceof Reflect.get(globalThis, 'WorkerGlobalScope')
  )
    return globalThis as unknown as IThreadWebPort
  if (runtime === ServerRuntime.bun) {
    /**
     * Bun's native thread fact does not grant bootstrap authority; the original resource still
     * does.
     */
    const bun = Reflect.get(globalThis, 'Bun') as { isMainThread?: boolean } | undefined
    if (bun?.isMainThread === false && typeof Reflect.get(globalThis, 'postMessage') === 'function')
      return globalThis as unknown as IThreadWebPort
  }
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
 * identifies a branch only; Core still performs the original capability admission. Node checks the
 * actual parentPort/workerData; a main thread returns false. Web capture may reject invalid or
 * missing bootstrap rather than granting an unrelated Worker a library-child identity.
 */
export async function isThreadChild(): Promise<boolean> {
  /** Web bootstrap remains buffered by the same held resource later used by createThreadPeer. */
  const parent = threadWebParent()
  if (parent) {
    await threadChildResource(parent).receiveInitial(undefined, true)
    return true
  }
  /** Main/native child admission reads only the real module selected at package initialization. */
  const native = readNodeThreadRuntime()
  return (
    native?.parentPort !== null &&
    native !== undefined &&
    rpcMessageCapabilityControl.readInitial(native.workerData).valid
  )
}

/**
 * Factory admission stays synchronous without adding a public marker or changing child guard
 * typing.
 */
export function isNativeThreadChild(): boolean {
  if (threadWebParent()) return true
  const native = readNodeThreadRuntime()
  return (
    native !== undefined &&
    native.parentPort !== null &&
    rpcMessageCapabilityControl.readInitial(native.workerData).valid
  )
}
