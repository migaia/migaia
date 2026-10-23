/**
 * Private protocol baselines retain the original assembly while production exposes only cold
 * transports.
 */
import { captureAdapterTask } from '../../rpc-host/dist/runtime-adapter/definition.js'
import { type IAdapterTask } from '../../rpc-host/dist/runtime-adapter/definition-types.js'
import {
  RuntimePluginKey,
  createAdapterSourceConfigurationError,
  validateAdapterPeerMethods,
  type IRuntimePeerOptions,
  type IRuntimePeer,
  type IRuntimeTypedPeer
} from '@migaia/rpc-host/plugin'
import {
  type IThreadParentPort,
  type IThreadRuntimeResource
} from '../dist/threads/runtime-types.js'
import { type IThreadWebPort } from '../dist/threads/types.js'
import {
  type IRuntimeThreadPeerOptions,
  createThreadSourceBinding,
  type IRuntimeThreadSpawn
} from '../dist/threads/runtime-peer.js'
import { type IThreadHandle } from '@migaia/supervision/threads'
import { getThreadMessageAdapter } from '../dist/threads/adapter.js'
import { threadChildResource, threadWebParent } from '../dist/threads/child.js'
import { defaultRpcReporter } from '@migaia/rpc-host/plugin'
import { detectServerRuntime, ServerRuntime } from '@migaia/utils'
import { threadRuntimeResource } from '../dist/threads/runtime-resource.js'
import { expandThreadSpawn, isShortThreadSpawn } from '../dist/threads/short-spawn.js'
/** Capture original options once before loaders, short-source expansion, or native port acquisition. */
export function captureThreadTask<THandle extends IThreadHandle = IThreadHandle>(
  options: IRuntimeThreadPeerOptions<THandle>
): IAdapterTask<IThreadParentPort | IThreadWebPort> {
  return captureAdapterTask(getThreadMessageAdapter(), options, RuntimePluginKey.thread)
}

/** Native branches share one held Core task while preserving their existing lifecycle owners. */
export type IThreadAdapterTask = ReturnType<typeof captureThreadTask>

/** Attach Core's original bounded raw bootstrap capture before any asynchronous preparation. */
export function createAutomaticWebThreadPeer(
  options: IRuntimeThreadPeerOptions,
  native: IThreadWebPort,
  task?: IThreadAdapterTask
): Promise<IRuntimePeer> {
  /** Core performs the original early timeout check without repeating the adapter's getter reads. */
  const captured = task ?? captureThreadTask(options)
  if (options.spawn !== undefined || options.connect !== undefined || options.listen !== undefined)
    throw createAdapterSourceConfigurationError()
  validateAdapterPeerMethods(options.provide, options.contract)
  /** Core receives the actual raw resource and retains bootstrap, capability and generation facts. */
  const resource = threadChildResource(native)
  /** The opaque preparation reads captured raw input without an adapter agreement or context DTO. */
  return captured.resourcePeer(
    { ...options, report: options.report ?? defaultRpcReporter } as IRuntimePeerOptions,
    resource
  )
}

/**
 * Create an advanced child Peer from the actual parentPort and its original native workerData. Core
 * validates bootstrap/provide and performs the original capability admission; a caller-made
 * metadata shape is not proof of native provenance. A null parent port delegates the configured
 * main-thread source path. The Peer borrows this port and retains Core's normal failure
 * identities.
 */
export function createAdapterNodeThreadPeer(
  options: IRuntimeThreadPeerOptions,
  parentPort: IThreadParentPort | null,
  workerData: unknown
): Promise<IRuntimePeer> {
  return openNodeThreadTask(options, parentPort, workerData, captureThreadTask(options))
}

/** Main factories pass only their already captured task, without adding a public trust parameter. */
export function openNodeThreadTask(
  options: IRuntimeThreadPeerOptions,
  parentPort: IThreadParentPort | null,
  workerData: unknown,
  task: IThreadAdapterTask
): Promise<IRuntimePeer> {
  /** The original early admission and genuine Host context are retained by the SDK task. */
  const preparation = task.preparation
  if (!parentPort)
    return typeof options.spawn === 'object'
      ? createThreadSourcePeer(options, undefined, task)
      : preparation.peer({
          ...options,
          self: preparation.context.self,
          report: options.report ?? defaultRpcReporter
        } as IRuntimePeerOptions)
  /** Core reads the same actual workerData and keeps the closed admission snapshot private. */
  /** Identity, local provider compilation, generation and actual ACK remain one Core operation. */
  return task.messagePeer(
    (options.report ? options : { ...options, report: defaultRpcReporter }) as IRuntimePeerOptions,
    parentPort,
    { direction: 'inbound', read: () => workerData }
  )
}

/** Construct real owned execution through the same binding and remote generation owner. */
export function createThreadSourcePeer<THandle extends IThreadHandle>(
  options: IRuntimeThreadPeerOptions<THandle>,
  expanded?: IRuntimeThreadSpawn<THandle>,
  task?: IThreadAdapterTask
): Promise<IRuntimePeer> {
  /** The opaque Core operation performs the original early timeout admission exactly once. */
  const captured = task ?? captureThreadTask(options)
  /** Native bindings share the SDK task's sole original Host preparation. */
  const preparation = captured.preparation
  if (
    (!expanded && (!options.spawn || typeof options.spawn !== 'object')) ||
    options.connect ||
    options.listen
  )
    throw createAdapterSourceConfigurationError()
  /** Original source reads remain the managed options fallback after binding selection. */
  const source = expanded ?? (options.spawn as IRuntimeThreadSpawn<THandle>)
  /** Local address is output from Core's original preparation rather than a peer claim. */
  const self = preparation.context.self
  /** One canonical producer retains the original supervisor, drain, health and exact handle maps. */
  const binding = createThreadSourceBinding(source, (launcher, childName) =>
    preparation.launcher(launcher, childName)
  )
  return captured.managed(
    {
      self,
      provide: options.provide,
      probe: options.probe,
      providerLimits: options.providerLimits,
      defaultTimeoutMs: options.defaultTimeoutMs,
      report: options.report ?? source.report,
      contract: options.contract,
      keyFactory: options.keyFactory ?? source.keyFactory,
      retryPort: options.retryPort ?? source.retryPort,
      endpointFactory: options.endpointFactory,
      authentication: options.authentication,
      callDeadlineCapMs: source.spec.limits?.callWallTimeMs
    },
    binding,
    binding.supervisor
  )
}

/**
 * Open one Worker Peer from an owned spawn, borrowed source, or the current child's real bootstrap.
 * Await isThreadChild before self-spawning so the full entry does not recursively create Workers.
 * Closing an owned source drains under its supervisor budget and requests termination; borrowed
 * MessagePorts remain physically caller-owned. Invalid entries/data reject before Worker creation;
 * Core owns request deadlines, cancellation, authentication, and negotiated binary/transfer
 * support.
 */
export function createThreadPeer<TRemote = Record<never, never>>(
  options: IRuntimeThreadPeerOptions,
  runtime?: IThreadRuntimeResource
): Promise<IRuntimeTypedPeer<TRemote>>
/** Platform implementations retain their original untyped internal callable owner. */
export function createThreadPeer(
  options: IRuntimeThreadPeerOptions,
  runtime: IThreadRuntimeResource = threadRuntimeResource
): Promise<object> {
  /** SDK capture performs the original early timeout admission before any native discovery. */
  const task = captureThreadTask(options)
  /** The actual Worker global selects automatic discovery; bootstrap still grants the connection. */
  const parent = threadWebParent()
  if (parent) return createAutomaticWebThreadPeer(options, parent, task)
  if (isShortThreadSpawn(options.spawn))
    return expandThreadSpawn(options, runtime).then((source) =>
      createThreadSourcePeer(options, source, task)
    )
  if (detectServerRuntime() === ServerRuntime.node)
    return runtime
      .load()
      .then((native) => openNodeThreadTask(options, native.parentPort, native.workerData, task))
  if (typeof options.spawn === 'object') return createThreadSourcePeer(options, undefined, task)
  /** Main-thread borrowed sources use the same Core-generated default address as spawn sources. */
  const preparation = task.preparation
  return preparation.peer({
    ...options,
    self: preparation.context.self,
    report: options.report ?? defaultRpcReporter
  } as IRuntimePeerOptions)
}
