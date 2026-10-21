/** Internal construction mode distinguishes parent launch from child connection. */
export const TrayRuntimeMode = { parent: 'parent', child: 'child' } as const
/** Construction mode stays private to host composition modules. */
export type TrayRuntimeMode = keyof typeof TrayRuntimeMode
/** Queue entry ownership separates manual operations from supervised re-init. */
export const TrayManagementMode = { manual: 'manual', background: 'background' } as const
/** Queue ownership is private metadata, never a native supervision state. */
export type TrayManagementMode = keyof typeof TrayManagementMode

/** Runtime families accepted by the host DSL and selected by the runtime adapter. */
export const TrayRuntime = {
  /** Same-realm cooperative task managed by the canonical coroutine RPC plugin. */
  coroutine: 'coroutine',
  /** Node Worker entry managed by the canonical thread RPC plugin. */
  thread: 'thread',
  /** Child-process entry managed by the canonical process RPC plugin. */
  process: 'process'
} as const
/** Value union shares the canonical runtime domain's namespace. */
export type TrayRuntime = (typeof TrayRuntime)[keyof typeof TrayRuntime]

/** Registry states derive from init completion and the rpc unit lifecycle. */
export const TrayInstanceState = {
  /** Initial admission is installing its RPC unit and running generation init. */
  starting: 'starting',
  /** The current generation has completed business plugin initialization. */
  ready: 'ready',
  /** Native replacement or recovery is waiting for a new generation's initialization. */
  restarting: 'restarting',
  /** Startup/init or terminal native recovery failed. */
  failed: 'failed',
  /** The admitted native unit is stopped, while its registry record remains discoverable. */
  stopped: 'stopped'
} as const
/** Value union shares the canonical state domain's namespace. */
export type TrayInstanceState = (typeof TrayInstanceState)[keyof typeof TrayInstanceState]

/** Read-only lifecycle topics are emitted only by registry state transitions. */
export const TrayInstanceEvent = {
  /** A new id admission was recorded, before generation readiness. */
  spawned: 'spawned',
  /** A current generation completed initialization. */
  ready: 'ready',
  /** An admitted unit entered replacement or supervised recovery. */
  restarting: 'restarting',
  /** The current admission entered failed state. */
  failed: 'failed',
  /** The record remains admitted but its native unit stopped. */
  stopped: 'stopped',
  /** The admission was revoked and its removal cleanup was attempted. */
  removed: 'removed'
} as const
/** Value union shares the canonical event domain's namespace. */
export type TrayInstanceEvent = (typeof TrayInstanceEvent)[keyof typeof TrayInstanceEvent]

/** Internal plugin names and wire paths shared by child and parent dispatchers. */
export const TrayInternal = {
  childPlugin: 'trayChild',
  clientPlugin: 'trayClient',
  relayPlugin: 'trayRelay',
  connection: 'tray',
  init: 'trayChild.init',
  invoke: 'trayChild.invoke',
  stream: 'trayChild.stream',
  deliver: 'trayChild.deliver',
  shutdown: 'trayChild.shutdown',
  bind: 'trayRelay.bind',
  call: 'trayRelay.call',
  notify: 'trayRelay.notify',
  relayStream:
    'trayRelay.stream' /** Portable routed envelopes use this existing relay category for every call kind. */,
  routed: 'trayRelay.routed',
  /** Parent authenticates the publisher before attaching topic metadata. */
  publish: 'trayRelay.publish',
  /** First child listener admits one generation-bound parent membership. */
  subscribe: 'trayRelay.subscribe',
  /** Last child listener releases its generation-bound parent membership. */
  unsubscribe: 'trayRelay.unsubscribe'
} as const

/** Business call kinds select existing RPC request, notify and stream operations. */
export const TrayCallKind = { request: 'request', notify: 'notify', stream: 'stream' } as const
/** Value/type pair keeps the internal business-call domain canonical. */
export type TrayCallKind = keyof typeof TrayCallKind

/** The per-init client Feature name belongs to the same plugin contract in every runtime. */
export const TrayClientFeature = 'tray'

/** Host fields are read as own data without evaluating caller accessors. */
export const TrayHostField = {
  name: 'name',
  runtime: 'runtime',
  entry: 'entry',
  config: 'config',
  plugins: 'plugins',
  exposes: 'exposes',
  supervisor: 'supervisor',
  limits: 'limits',
  sandbox: 'sandbox',
  routing: 'routing',
  restart: 'restart',
  mode: 'mode',
  maxRestarts: 'maxRestarts',
  windowMs: 'windowMs',
  initialDelayMs: 'initialDelayMs',
  startupTimeoutMs: 'startupTimeoutMs',
  heapBytes: 'heapBytes',
  wrap: 'wrap'
} as const

/** Restart modes are forwarded with the supervision owner's native field names. */
export const TrayRestartMode = {
  never: 'never',
  onFailure: 'on-failure',
  always: 'always'
} as const
