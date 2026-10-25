/**
 * Owns the single RPC wire vocabulary and closed shape keys. It declares data, never endpoint
 * state, media framing, optional plugin behavior, timers, or IO.
 */
/** One semantic profile replaces both legacy v1 and the multiplexed runtime-api syntax. */
export const RpcWireProfile = 'migaia.rpc/2'
/** The one supported incompatible protocol generation; no legacy negotiation fallback exists. */
export const RpcWireVersion = { major: 2, minor: 0 } as const
/** Each semantic kind selects one closed frame shape before any host state is consulted. */
export const RpcWireKind = {
  /** Host identity, directory and codec/extension negotiation. */ handshake: 'handshake',
  /** A request, notification or streaming invocation, selected by task.mode. */ call: 'call',
  /** Ordered fail-stop business steps, separate from optional physical batching. */ group: 'group',
  /** Successful correlated terminal, omitting only actual undefined. */ result: 'result',
  /** Failed correlated terminal carrying the complete bounded flat error graph. */ error: 'error',
  /** Cancellation of any written call, including one-way notifications. */ cancel: 'cancel',
  /** Credit-driven stream event for the original admitted task. */ stream: 'stream',
  /** Optional idempotency plugin lookup or observed store fact. */ outcome: 'outcome',
  /** Host lifecycle ping, pong, and graceful drain. */ control: 'control',
  /** Host-owned replacement of the accepted method directory. */ directory: 'directory'
} as const
/** Logical modes retain the existing runtime task/generation contract. */
export const RpcCallMode = {
  request: 'request',
  notify: 'notify',
  stream: 'stream',
  group: 'group',
  outcome: 'outcome'
} as const
/** Admission pending keeps negotiated peers bounded without falsely accepting their name. */
export const RpcWireHandshakeStep = {
  hello: 'hello',
  accept: 'accept',
  reject: 'reject',
  pending: 'pending'
} as const
/** Frame plugins wrap opaque codec output without adding another semantic protocol. */
export const RpcCarrierFrameKind = { message: 'message', extension: 'extension' } as const
/** Control has no provider invocation or optional feature implementation. */
export const RpcWireControlOperation = { ping: 'ping', pong: 'pong', drain: 'drain' } as const
/** Store continuity and step states preserve existing runtime result semantics. */
export const RpcWireStepState = {
  success: 'success',
  failure: 'failure',
  notExecuted: 'not-executed'
} as const
/** Stream finish is an existing opt-in intent, not cancellation of a new task. */
export const RpcWireStreamFinish = 'finish-without-items'
/** The new directory exchanges existing method metadata directly during handshake. */
export const RpcWireDirectoryVersion = 3
/** Mandatory JSON is a real carrier codec, also used for common bootstrap negotiation. */
export const RpcWireJsonCodec = 'json'
/** Existing capability identifiers also identify installed extension versions. */
export const RpcWireExtensionPattern = /^[a-z][a-z0-9.-]*@[1-9][0-9]*$/u
/** Codec identifiers retain the existing bounded lowercase grammar. */
export const RpcWireCodecPattern = /^[a-z][a-z0-9.-]{0,31}$/u
/** The protected binary manifest keeps the existing view/backing data vocabulary. */
export const RpcWireBinaryProfile = 'migaia.rpc.portable-binary/1'
/** Manifest storage is selected by a real physical carrier, never by a payload permission field. */
export const RpcWireBinaryStorage = { inline: 'inline', native: 'native' } as const
/** Canonical wire field keys are shared by shape schemas and diagnostic pointers. */
export const RpcWireField = {
  /** Selects optional authentication data owned by the installed auth plugin. */
  auth: 'auth',
  /** Selects the generation fact issued by the actual source/session owner. */
  generation: 'generation',
  /** Selects the outer negotiated extension identity. */
  extension: 'extension',
  /** Selects the profile slot in the wire shape and its diagnostic pointer. */
  profile: 'profile',
  /** Selects the kind slot in the wire shape and its diagnostic pointer. */
  kind: 'kind',
  /** Selects the id slot in the wire shape and its diagnostic pointer. */
  id: 'id',
  /** Selects the route slot in the wire shape and its diagnostic pointer. */
  route: 'route',
  /** Selects the task slot in the wire shape and its diagnostic pointer. */
  task: 'task',
  /** Selects the options slot in the wire shape and its diagnostic pointer. */
  options: 'options',
  /** Selects the payload slot in the wire shape and its diagnostic pointer. */
  payload: 'payload',
  /** Selects the steps slot in the wire shape and its diagnostic pointer. */
  steps: 'steps',
  /** Selects the operation slot in the wire shape and its diagnostic pointer. */
  operation: 'operation',
  /** Selects the reason slot in the wire shape and its diagnostic pointer. */
  reason: 'reason',
  /** Selects the stream slot in the wire shape and its diagnostic pointer. */
  stream: 'stream',
  /** Selects the completion slot in the wire shape and its diagnostic pointer. */
  completion: 'completion',
  /** Selects the idempotencyKey slot in the wire shape and its diagnostic pointer. */
  idempotencyKey: 'idempotencyKey',
  /** Selects the state slot in the wire shape and its diagnostic pointer. */
  state: 'state',
  /** Selects the store slot in the wire shape and its diagnostic pointer. */
  store: 'store',
  /** Selects the outcome slot in the wire shape and its diagnostic pointer. */
  outcome: 'outcome',
  /** Selects the mode slot in the wire shape and its diagnostic pointer. */
  mode: 'mode',
  /** Selects the callerId slot in the wire shape and its diagnostic pointer. */
  callerId: 'callerId',
  /** Selects the callerGeneration slot in the wire shape and its diagnostic pointer. */
  callerGeneration: 'callerGeneration',
  /** Selects the targetGeneration slot in the wire shape and its diagnostic pointer. */
  targetGeneration: 'targetGeneration',
  /** Selects the method slot in the wire shape and its diagnostic pointer. */
  method: 'method',
  /** Selects the value slot in the wire shape and its diagnostic pointer. */
  value: 'value',
  /** Selects the providerId slot in the wire shape and its diagnostic pointer. */
  providerId: 'providerId',
  /** Selects the orderKey slot in the wire shape and its diagnostic pointer. */
  orderKey: 'orderKey',
  /** Selects the cancel slot in the wire shape and its diagnostic pointer. */
  cancel: 'cancel',
  /** Selects the timeoutMs slot in the wire shape and its diagnostic pointer. */
  timeoutMs: 'timeoutMs',
  /** Selects the ok slot in the wire shape and its diagnostic pointer. */
  ok: 'ok',
  /** Selects the result slot in the wire shape and its diagnostic pointer. */
  result: 'result',
  /** Selects the error slot in the wire shape and its diagnostic pointer. */
  error: 'error',
  /** Selects the event slot in the wire shape and its diagnostic pointer. */
  event: 'event',
  /** Selects the seq slot in the wire shape and its diagnostic pointer. */
  seq: 'seq',
  /** Selects the epoch slot in the wire shape and its diagnostic pointer. */
  epoch: 'epoch',
  /** Selects the continuity slot in the wire shape and its diagnostic pointer. */
  continuity: 'continuity',
  /** Selects the root slot in the wire shape and its diagnostic pointer. */
  root: 'root',
  /** Selects the nodes slot in the wire shape and its diagnostic pointer. */
  nodes: 'nodes',
  /** Selects the source slot in the wire shape and its diagnostic pointer. */
  source: 'source',
  /** Selects the code slot in the wire shape and its diagnostic pointer. */
  code: 'code',
  /** Selects the name slot in the wire shape and its diagnostic pointer. */
  name: 'name',
  /** Selects the message slot in the wire shape and its diagnostic pointer. */
  message: 'message',
  /** Selects the stack slot in the wire shape and its diagnostic pointer. */
  stack: 'stack',
  /** Selects the cause slot in the wire shape and its diagnostic pointer. */
  cause: 'cause',
  /** Selects the errors slot in the wire shape and its diagnostic pointer. */
  errors: 'errors',
  /** Selects the data slot in the wire shape and its diagnostic pointer. */
  data: 'data',
  /** Selects the truncated slot in the wire shape and its diagnostic pointer. */
  truncated: 'truncated',
  /** Selects the applicationVersion slot in the wire shape and its diagnostic pointer. */
  applicationVersion: 'applicationVersion',
  /** Selects the senderId slot in the wire shape and its diagnostic pointer. */
  senderId: 'senderId',
  /** Selects the receiverId slot in the wire shape and its diagnostic pointer. */
  receiverId: 'receiverId',
  /** Selects the targetId slot in the wire shape and its diagnostic pointer. */
  targetId: 'targetId',
  /** Selects the sentAt slot in the wire shape and its diagnostic pointer. */
  sentAt: 'sentAt',
  /** Selects the forwardRoute slot in the wire shape and its diagnostic pointer. */
  forwardRoute: 'forwardRoute',
  /** Selects the existing explicit diagnostic trace in routing metadata. */
  trace: 'trace',
  /** Selects the remainingMs slot in the wire shape and its diagnostic pointer. */
  remainingMs: 'remainingMs',
  /** Selects the step slot in the wire shape and its diagnostic pointer. */
  step: 'step',
  /** Selects the versions slot in the wire shape and its diagnostic pointer. */
  versions: 'versions',
  /** Selects the major slot in the wire shape and its diagnostic pointer. */
  major: 'major',
  /** Selects the minor slot in the wire shape and its diagnostic pointer. */
  minor: 'minor',
  /** Selects the codecs slot in the wire shape and its diagnostic pointer. */
  codecs: 'codecs',
  /** Selects the codec slot in the wire shape and its diagnostic pointer. */
  codec: 'codec',
  /** Selects the extensions slot in the wire shape and its diagnostic pointer. */
  extensions: 'extensions',
  /** Selects the requiredExtensions slot in the wire shape and its diagnostic pointer. */
  requiredExtensions: 'requiredExtensions',
  /** Selects the peer slot in the wire shape and its diagnostic pointer. */
  peer: 'peer',
  /** Selects the runtime slot in the wire shape and its diagnostic pointer. */
  runtime: 'runtime',
  /** Selects the runtimeVersion slot in the wire shape and its diagnostic pointer. */
  runtimeVersion: 'runtimeVersion',
  /** Selects the implementation slot in the wire shape and its diagnostic pointer. */
  implementation: 'implementation',
  /** Selects the directory slot in the wire shape and its diagnostic pointer. */
  directory: 'directory',
  /** Selects the schemaVersion slot in the wire shape and its diagnostic pointer. */
  schemaVersion: 'schemaVersion',
  /** Selects the self slot in the wire shape and its diagnostic pointer. */
  self: 'self',
  /** Selects the instanceId slot in the wire shape and its diagnostic pointer. */
  instanceId: 'instanceId',
  /** Selects the methods slot in the wire shape and its diagnostic pointer. */
  methods: 'methods',
  /** Selects the nodeId slot in the wire shape and its diagnostic pointer. */
  nodeId: 'nodeId',
  /** Selects the supportedModes slot in the wire shape and its diagnostic pointer. */
  supportedModes: 'supportedModes',
  /** Selects the modeSource slot in the wire shape and its diagnostic pointer. */
  modeSource: 'modeSource',
  /** Selects the idempotent slot in the wire shape and its diagnostic pointer. */
  idempotent: 'idempotent',
  /** Selects the forwardedVia slot in the wire shape and its diagnostic pointer. */
  forwardedVia: 'forwardedVia',
  /** Selects the input slot in the wire shape and its diagnostic pointer. */
  input: 'input',
  /** Selects the output slot in the wire shape and its diagnostic pointer. */
  output: 'output',
  /** Selects the yield slot in the wire shape and its diagnostic pointer. */
  yield: 'yield',
  /** Selects the manifest slot in the wire shape and its diagnostic pointer. */
  manifest: 'manifest',
  /** Selects the storage slot in the wire shape and its diagnostic pointer. */
  storage: 'storage',
  /** Selects the envelope slot in the wire shape and its diagnostic pointer. */
  envelope: 'envelope',
  /** Selects the backings slot in the wire shape and its diagnostic pointer. */
  backings: 'backings',
  /** Selects the byteLength slot in the wire shape and its diagnostic pointer. */
  byteLength: 'byteLength',
  /** Selects the sha256 slot in the wire shape and its diagnostic pointer. */
  sha256: 'sha256',
  /** Selects the sidecars slot in the wire shape and its diagnostic pointer. */
  sidecars: 'sidecars'
} as const
/** Diagnostic paths are owned here rather than recreated at validator call sites. */
export const RpcWirePointer = {
  root: '',
  profile: '/profile',
  kind: '/kind',
  id: '/id',
  route: '/route',
  task: '/task',
  options: '/options',
  payload: '/payload',
  steps: '/steps',
  result: '/result',
  error: '/error',
  stream: '/stream',
  reason: '/reason',
  directory: '/directory',
  handshake: '/handshake',
  extensions: '/extensions',
  requiredExtensions: '/requiredExtensions',
  nodes: '/nodes',
  store: '/store',
  outcome: '/outcome',
  frame: '/frame',
  manifest: '/manifest'
} as const
/** Append one grammar-owned key/index without changing the classified error message. */
export function rpcWirePointer(parent: string, key: string | number): string {
  return `${parent}/${String(key).replaceAll('~', '~0').replaceAll('/', '~1')}`
}

/** The existing before-start cancellation option stops owning business cancellation after admission. */
export const RpcWireCancel = 'before-start'
