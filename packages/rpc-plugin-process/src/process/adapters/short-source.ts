/** Expand native Process source recipes; the Host retains handshake, calls and Session ownership. */
import { resolveRpcEntry, retainRpcRuntimeFlags } from '@migaia/rpc-host/sdk'
import { detectElectronProcessType, isUrlObject, type IUrlLike } from '@migaia/utils'
import type { IAbortSignal } from '@migaia/utils/promise'
import { attachErrorIdentity } from '@migaia/utils/error'
import { systemScheduler, type IScheduler } from '@migaia/utils/scheduler'
import { createUnitBudget, SUPERVISION_SOURCE, SupervisionErrorCode } from '@migaia/supervision'
import type {
  IProcessEnv,
  IProcessHandle,
  IProcessLauncher,
  IProcessSpec,
  IProcessSupervisorOptions
} from '@migaia/supervision/process'
import { resolveAbortReason } from '@migaia/rpc-host/sdk'
import {
  RpcProcessErrorCode,
  RPC_PROCESS_ERROR_SOURCE as ERROR_SOURCE
} from '@migaia/rpc-contract/error-code'
import { RpcProcessErrorText } from '../error-text.ts'
import type {
  IProcessServeListenerIngress,
  ISpawnProcessPluginDeployment
} from '../plugin/types.ts'
import type { IProcessByteChannel, IListenProcessByteChannel } from '../types.ts'
import type { INodeProcessHandle } from './node-child-process.ts'
import { PROCESS_RUNTIME_API_ENV } from '../constants.ts'
import {
  PROCESS_CONNECT_TIMEOUT_MS,
  PROCESS_CONNECT_RETRY_MS,
  PROCESS_LOCAL_AUTH_MARKER,
  PROCESS_LOCAL_DIRECTORY_MODE,
  PROCESS_LOCAL_SOCKET_MODE,
  PROCESS_LOCAL_DIRECTORY_PREFIX,
  PROCESS_LOCAL_PIPE_PREFIX,
  PROCESS_SHORT_CHILD_NAME,
  PROCESS_SHORT_WRAP_FIELD
} from '../short-source-constants.ts'
import { defaultRpcReporter } from '@migaia/rpc-host'

/** Caller-owned command data excludes the channel, bootstrap and supervision authority. */
export type IProcessLaunchCommand = Readonly<{
  /** Executable passed directly to the native launcher, without a shell. */
  command: string
  /** Exact argument array for this launch, including any retained runtime flags. */
  args: readonly string[]
  /** Optional native working directory; undefined preserves the launcher's normal default. */
  cwd?: string
  /** Explicit inherited names and literal additions; ambient environment is not copied wholesale. */
  env: Readonly<IProcessEnv>
}>

/** Ordinary launch configuration overrides defaults without granting launch or handshake authority. */
export type IProcessShortSpawn = Readonly<{
  /** Module URL or path; omission selects the real main entry, if the runtime has one. */
  entry?: IUrlLike
  /** Explicit base for resolving relative entry paths; omission uses the main entry. */
  base?: IUrlLike
  /** Optional executable override; supplying it bypasses module-entry resolution. */
  command?: string
  /**
   * Defaults to [] for an explicit entry/command; spawn:true forwards the parent's script
   * arguments.
   */
  args?: readonly string[]
  /** Optional working directory forwarded unchanged to the native process specification. */
  cwd?: string
  /** Defaults to inherit:['PATH'] and set:{}; selected additions override inherited names. */
  env?: Partial<IProcessEnv>
  /**
   * Rewrite the command once per launch; throws/invalid returned data reject with
   * PROCESS_PLUGIN_INVALID_OPTION.
   */
  wrap?: (command: IProcessLaunchCommand) => IProcessLaunchCommand
  /**
   * Defaults to stdin:'channel', stdout:'channel', stderr:'drain'; channel/bootstrap ownership
   * stays local.
   */
  stdio?: IProcessSpec['stdio']
  /**
   * Optional supervision limits; unsupported native enforcement follows the selected isolation
   * policy.
   */
  limits?: IProcessSpec['limits']
  /**
   * Optional permissions forwarded to supervision; they do not grant an adapter unsupported
   * capabilities.
   */
  permissions?: IProcessSpec['permissions']
  /** Private credential is transported only by the original native launch bootstrap. */
  token?: string
  /** Overrides the default one-unit, best-effort process supervisor and its generated specification. */
  supervision?: Partial<IProcessSupervisorOptions<INodeProcessHandle>>
  /**
   * Receive expected unsupported-termination notices; omission uses the configured/default
   * reporter.
   */
  onNotice?(notice: unknown): void
}>

/** Plugin closures forward only source configuration after Core captures the original Host identity. */
export type IProcessShortSourceOptions = Readonly<{
  /** Credential for explicit addresses; same-user Unix named endpoints have an OS-isolated default. */
  token?: string
  /**
   * Optional listener verifier; omission compares the configured token and returns the local
   * principal.
   */
  verify?: IProcessServeListenerIngress['verify']
  /**
   * Finite nonnegative named-local rendezvous wait, default 5000ms; explicit addresses do not
   * retry.
   */
  connectTimeoutMs?: number
}>

/** Public short/full recipes expose actual native acquisition, without an endpoint factory. */
export type IProcessSourceOptions = IProcessShortSourceOptions &
  Readonly<{
    spawn?: ISpawnProcessPluginDeployment | true | IUrlLike | IProcessShortSpawn
    connect?: import('../plugin/types.ts').IConnectProcessPluginDeployment | string
    listen?: IProcessServeListenerIngress | string
    report?(error: unknown): void
  }>
/** Expansion retains every native recipe and changes only the selected short source. */
export type IProcessFullSources = Omit<IProcessSourceOptions, 'spawn' | 'connect' | 'listen'> &
  Readonly<{
    spawn?: ISpawnProcessPluginDeployment
    connect?: import('../plugin/types.ts').IConnectProcessPluginDeployment
    listen?: IProcessServeListenerIngress
  }>

/** Every default short launch shares one observable degradation notice in this native process. */
let terminationNoticeReported = false

/** Match only the original expected native termination degradation; retain every other error. */
function reportTerminationNotice(
  error: unknown,
  policy: Readonly<{
    onNotice?: (error: unknown) => void
    reportEach: boolean
    report(error: unknown): void
  }>
): void {
  /** Match only the existing expected best-effort termination notice, keeping all other errors. */
  const notice = error as {
    source?: string
    code?: string
    detail?: { capability?: string; level?: string; kind?: string }
  }
  if (
    notice?.source === SUPERVISION_SOURCE &&
    notice.code === SupervisionErrorCode.capabilityUnsupported &&
    notice.detail?.capability === 'termination' &&
    notice.detail.level === 'unsupported' &&
    notice.detail.kind === 'process'
  ) {
    if (policy.onNotice) {
      ;(0, policy.onNotice)(error)
      return
    }
    if (policy.reportEach || !terminationNoticeReported) {
      terminationNoticeReported = true
      ;(0, policy.report)(error)
    }
  } else (0, policy.report)(error)
}

/** Reject unsupported short configuration with the existing native configuration identity. */
function invalid(field: string, text: string = RpcProcessErrorText.pluginInvalidOption): never {
  throw attachErrorIdentity(new TypeError(text), {
    source: ERROR_SOURCE,
    code: RpcProcessErrorCode.pluginInvalidOption,
    detail: { field }
  })
}

/** Returned data failures have no cause because the callback completed normally. */
function invalidWrap(field: string): never {
  return invalid(`${PROCESS_SHORT_WRAP_FIELD}.${field}`)
}

/** Read only own data without executing callback-result accessors or inheriting command fields. */
function launchData(value: object, key: string, field: string = key): unknown {
  /** Descriptors distinguish an absent optional cwd from a forbidden accessor. */
  const descriptor = Object.getOwnPropertyDescriptor(value, key)
  if (descriptor && !('value' in descriptor)) invalidWrap(field)
  return descriptor?.value
}

/** Command arguments and environment names must contain strings, including at sparse positions. */
function launchStrings(value: unknown, field: string): readonly string[] {
  if (!Array.isArray(value)) invalidWrap(field)
  for (const item of value) if (typeof item !== 'string') invalidWrap(field)
  return value
}

/** Validate only the four public command fields; extra callback-result keys grant no authority. */
function validateLaunchCommand(value: unknown): IProcessLaunchCommand {
  if (!value || typeof value !== 'object') invalidWrap('command')
  /** Each projected property is read once as own data before the native launcher sees it. */
  const command = launchData(value, 'command')
  if (typeof command !== 'string' || !command) invalidWrap('command')
  /** Keep the caller's argument list after validating every actual array position. */
  const args = launchStrings(launchData(value, 'args'), 'args')
  /** Undefined is the normal absent-cwd value supplied by rpc's own command. */
  const cwd = launchData(value, 'cwd')
  if (cwd !== undefined && typeof cwd !== 'string') invalidWrap('cwd')
  /** Environment retains the existing explicit inherit/set policy instead of ambient inheritance. */
  const env = launchData(value, 'env')
  if (!env || typeof env !== 'object') invalidWrap('env')
  launchStrings(launchData(env, 'inherit', 'env'), 'env')
  /** Native environment expansion consumes only own string-valued data entries. */
  const set = launchData(env, 'set', 'env')
  if (!set || typeof set !== 'object') invalidWrap('env')
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(set)))
    if (!('value' in descriptor) || typeof descriptor.value !== 'string') invalidWrap('env')
  return { command, args, cwd, env: env as IProcessEnv }
}

/** Invoke the caller once for this launch and preserve every rpc-owned specification field. */
function projectWrapped(
  spec: IProcessSpec,
  wrap: NonNullable<IProcessShortSpawn['wrap']>
): IProcessSpec {
  /** Only callback throws acquire a native cause; invalid returned data has no synthetic cause. */
  let result: unknown
  try {
    result = wrap({ command: spec.command, args: spec.args, cwd: spec.cwd, env: spec.env })
  } catch (cause) {
    throw attachErrorIdentity(new TypeError(RpcProcessErrorText.pluginInvalidOption, { cause }), {
      source: ERROR_SOURCE,
      code: RpcProcessErrorCode.pluginInvalidOption,
      detail: { field: PROCESS_SHORT_WRAP_FIELD }
    })
  }
  /** Projection prevents planted stdio, bootstrap, limits or permissions from replacing rpc data. */
  const next = validateLaunchCommand(result)
  return { ...spec, command: next.command, args: next.args, cwd: next.cwd, env: next.env }
}

/** Delegate the selected native or caller launcher with its receiver and optional operations intact. */
function wrapLauncher<THandle extends IProcessHandle>(
  inner: IProcessLauncher<THandle>,
  wrap: NonNullable<IProcessShortSpawn['wrap']>
): IProcessLauncher<THandle> {
  return {
    capabilities: inner.capabilities,
    /** Start, restart and replacement all pass through the supervisor's original launch point. */
    launch: (spec, context) => inner.launch(projectWrapped(spec, wrap), context),
    ...(inner.probe
      ? {
          /** Recovery still belongs to the selected launcher's instance. */
          probe: (record) => inner.probe!(record)
        }
      : {}),
    ...(inner.terminateRecord
      ? {
          /** Preserve native recovery teardown without fabricating unsupported operations. */
          terminateRecord: (record) => inner.terminateRecord!(record)
        }
      : {})
  }
}

/**
 * A nonsecret name resolves deterministically for the current OS user; explicit addresses stay
 * exact.
 */
async function endpoint(value: string) {
  if (!value || (value.includes('\\') && !value.startsWith('\\\\.\\pipe\\'))) invalid('address')
  if (value.includes('/') || value.includes(':') || value.startsWith('\\\\.\\pipe\\'))
    return { address: value, local: false, principal: '', serviceId: '' }
  /** Deno uses its supported Node-compatible process metadata instead of assuming a global process. */
  const { default: process } = await import('node:process')
  /** Platform libraries are loaded only when a native named endpoint is selected. */
  const [{ createHash }, { userInfo }] = await Promise.all([
    import('node:crypto'),
    import('node:os')
  ])
  /** User identity comes from the OS, never from peer hello metadata. */
  const user = userInfo()
  /** Hashing bounds the pathname while preserving identical derivation across independent processes. */
  const name = createHash('sha256').update(value).digest('hex').slice(0, 24)
  if (process.platform === 'win32')
    return {
      address: `${PROCESS_LOCAL_PIPE_PREFIX}${createHash('sha256').update(user.username).digest('hex').slice(0, 16)}-${name}`,
      local: false,
      principal: '',
      serviceId: ''
    }
  if (user.uid < 0) invalid('token', RpcProcessErrorText.localTokenRequired)
  /** The short, per-user directory is both the rendezvous location and its OS access boundary. */
  const directory = `${PROCESS_LOCAL_DIRECTORY_PREFIX}${user.uid}`
  /** Existing directories must already belong to this user with exact owner-only permissions. */
  const { mkdir, lstat } = await import('node:fs/promises')
  try {
    await mkdir(directory, { recursive: true, mode: PROCESS_LOCAL_DIRECTORY_MODE })
  } catch (cause) {
    throw attachErrorIdentity(new Error(RpcProcessErrorText.listenFailed, { cause }), {
      source: ERROR_SOURCE,
      code: RpcProcessErrorCode.listenFailed
    })
  }
  /** Never adopt a symlink or a directory made accessible to another user. */
  const stat = await lstat(directory).catch((cause) => {
    throw attachErrorIdentity(new Error(RpcProcessErrorText.listenFailed, { cause }), {
      source: ERROR_SOURCE,
      code: RpcProcessErrorCode.listenFailed
    })
  })
  if (
    !stat.isDirectory() ||
    stat.isSymbolicLink() ||
    stat.uid !== user.uid ||
    (stat.mode & 0o777) !== PROCESS_LOCAL_DIRECTORY_MODE
  )
    invalid('address', RpcProcessErrorText.localPermissionsRequired)
  return {
    address: `${directory}/${name}.sock`,
    local: true,
    principal: `uid:${user.uid}`,
    serviceId: name
  }
}

/** One original retry delay owns its deadline and exact abort subscription. */
class ProcessRetryWait {
  /** The existing caller signal and selected monotonic clock remain borrowed. */
  readonly #ports: Readonly<{ signal: IAbortSignal; scheduler: IScheduler; delayMs: number }>
  /** At most one scheduled wait belongs to this attempted native redial. */
  #timer: ReturnType<IScheduler['schedule']> | undefined
  /** Native cancellation retains the original reason rather than synthesizing a retry error. */
  #reject: ((reason: unknown) => void) | undefined
  /** Scheduler completion resolves the same wait after removing its abort observer. */
  #resolve: (() => void) | undefined
  /** Capture only one wait's native clock inputs. */
  constructor(signal: IAbortSignal, scheduler: IScheduler, delayMs: number) {
    this.#ports = { signal, scheduler, delayMs }
  }
  /** Completion and cancellation both remove the exact original listener. */
  readonly #done = (): void => {
    this.#ports.signal.removeEventListener('abort', this.#abort)
    this.#resolve?.()
  }
  /** The existing supervisor signal cancels its pending retry task. */
  readonly #abort = (): void => {
    this.#timer?.cancel()
    this.#ports.signal.removeEventListener('abort', this.#abort)
    this.#reject?.(resolveAbortReason(this.#ports.signal))
  }
  /** Install the original single deadline and handle an already-aborted signal identically. */
  wait(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.#resolve = resolve
      this.#reject = reject
      this.#timer = this.#ports.scheduler.schedule(this.#done, this.#ports.delayMs)
      this.#ports.signal.addEventListener('abort', this.#abort, { once: true })
      if (this.#ports.signal.aborted) this.#abort()
    })
  }
}

/** Retry only a missing or not-yet-listening local endpoint within one bounded scheduler deadline. */
async function dialWhenReady(
  dial: (options: { address: string; signal?: AbortSignal }) => Promise<IProcessByteChannel>,
  address: string,
  signal: IAbortSignal,
  timeoutMs: number,
  scheduler: IScheduler
): Promise<IProcessByteChannel> {
  /** Attempts share the original connection signal and the existing monotonic clock. */
  const started = scheduler.now()
  while (true) {
    try {
      return await dial({ address, signal: signal as AbortSignal })
    } catch (error) {
      /** Only native ENOENT/ECONNREFUSED can become ready by starting the same local service. */
      const cause = error instanceof Error ? error.cause : undefined
      if (
        signal.aborted ||
        !cause ||
        typeof cause !== 'object' ||
        !('code' in cause) ||
        (cause.code !== 'ENOENT' && cause.code !== 'ECONNREFUSED') ||
        scheduler.now() - started >= timeoutMs
      )
        throw error
      await new ProcessRetryWait(
        signal,
        scheduler,
        Math.min(PROCESS_CONNECT_RETRY_MS, timeoutMs - (scheduler.now() - started))
      ).wait()
    }
  }
}

/** Apply named-local socket permissions to the original listener and roll it back on chmod failure. */
async function listenLocalProcessSocket(
  input: Parameters<IListenProcessByteChannel>[0],
  socket: Readonly<{ listenProcessByteChannel: IListenProcessByteChannel }>,
  selected: Awaited<ReturnType<typeof endpoint>>,
  report: (error: unknown) => void
): ReturnType<IListenProcessByteChannel> {
  /** The original socket listener owns both pending accepts and its stable Unix inode record. */
  const listener = await socket.listenProcessByteChannel({
    ...input,
    serviceId: selected.serviceId
  })
  try {
    const { chmod } = await import('node:fs/promises')
    await chmod(selected.address, PROCESS_LOCAL_SOCKET_MODE)
    return listener
  } catch (cause) {
    try {
      await listener.close()
    } catch (cleanup) {
      report(cleanup)
    }
    throw attachErrorIdentity(new Error(RpcProcessErrorText.listenFailed, { cause }), {
      source: ERROR_SOURCE,
      code: RpcProcessErrorCode.listenFailed
    })
  }
}

/**
 * Expand one short native launch; entry resolution, credential custody and supervision stay
 * together.
 */
async function normalizeShortProcessSpawn(
  options: IProcessSourceOptions,
  runtime: string,
  forwarded: IProcessShortSourceOptions & Partial<IProcessShortSpawn>,
  report: (error: unknown) => void,
  reportEachTerminationNotice: boolean
): Promise<ISpawnProcessPluginDeployment> {
  /** Lazy deep paths continue to own native launch; connect/listen do not acquire launchers. */
  const native =
    runtime === 'deno'
      ? await import('./deno-command.ts')
      : runtime === 'bun'
        ? await import('./bun-spawn.ts')
        : await import('./node-child-process.ts')
  /** All three native runtimes expose the same Node-compatible argument projection when needed. */
  const { default: process } = await import('node:process')
  /** Object short forms contain only ordinary user-selected launch defaults. */
  const short: IProcessShortSpawn = {
    ...forwarded,
    ...(typeof options.spawn === 'object' && !isUrlObject(options.spawn)
      ? options.spawn
      : { entry: options.spawn === true ? undefined : options.spawn })
  }
  if (short.wrap !== undefined && typeof short.wrap !== 'function')
    invalid(PROCESS_SHORT_WRAP_FIELD)
  /** Native runtime metadata is input to Core's pure entry resolver. */
  const deno = Reflect.get(globalThis, 'Deno') as
    | { mainModule: string; execPath(): string }
    | undefined
  /** Self launch must have a real main module; no caller-location stack inference occurs. */
  const { fileURLToPath, pathToFileURL } = await import('node:url')
  /** Filesystem absoluteness belongs to the native owner; URL parsing must not reinterpret ?/#. */
  const { isAbsolute } = await import('node:path')
  /** Native metadata remains data; the shared pure resolver owns usable-entry policy. */
  const mainEntry =
    runtime === 'deno'
      ? deno?.mainModule
      : process.argv[1]
        ? pathToFileURL(process.argv[1])
        : undefined
  /** The child inherits Node/Bun runtime loaders and flags, without inheriting ambient environment. */
  const flags =
    runtime === 'deno'
      ? ['run', `--allow-env=PATH,${PROCESS_RUNTIME_API_ENV}`]
      : retainRpcRuntimeFlags(process.execArgv)
  /** An explicitly supplied command retains the original profile's command validation. */
  const explicitCommand = short.command !== undefined
  /** Exact absolute paths work even when eval/REPL provides no main entry for relative resolution. */
  const selectedEntry = options.spawn === true ? true : (short.entry ?? true)
  /** A real path becomes an encoded file URL before the neutral resolver sees its bytes. */
  const nativeEntry =
    typeof selectedEntry === 'string' && isAbsolute(selectedEntry)
      ? pathToFileURL(selectedEntry)
      : selectedEntry
  /** Command specifications bypass entry resolution and remain shell-free. */
  const entry = explicitCommand
    ? undefined
    : resolveRpcEntry(nativeEntry, {
        mainEntry,
        base: short.base,
        execArgv: runtime === 'deno' ? undefined : process.execArgv,
        electron: runtime === 'deno' ? false : detectElectronProcessType() !== undefined,
        singleBinary: runtime !== 'deno' && process.argv[1] === process.execPath
      })
  /** Both supported launchers expose the same existing native byte-handle shape. */
  const launcher =
    'createDenoProcessLauncher' in native
      ? native.createDenoProcessLauncher()
      : 'createBunProcessLauncher' in native
        ? native.createBunProcessLauncher()
        : native.createNodeProcessLauncher()
  /** Wrapping follows launcher selection so a caller override receives the same command hook. */
  const selectedLauncher = short.supervision?.launcher ?? launcher
  /** Each full source receives a fresh secret transported only in its existing stdin bootstrap. */
  const { randomBytes } = await import('node:crypto')
  /** An omitted credential receives fresh entropy before this native process is launched. */
  const token = short.token ?? randomBytes(32).toString('base64url')
  /** A caller scheduler also owns the default budget's timing, preserving one clock per source. */
  const scheduler = short.supervision?.scheduler ?? systemScheduler
  /** One explicit notice record preserves original default coalescing and caller behavior. */
  const notice = { onNotice: short.onNotice, reportEach: reportEachTerminationNotice, report }
  /** One native source owns one supervised process unit and its original teardown. */
  return {
    kind: 'spawn',
    channelKind: 'byte',
    token,
    supervision: {
      id: PROCESS_SHORT_CHILD_NAME,
      scheduler,
      budget:
        short.supervision?.budget ?? createUnitBudget({ kind: 'process', maxUnits: 1, scheduler }),
      isolation: 'best-effort',
      ...short.supervision,
      launcher: short.wrap ? wrapLauncher(selectedLauncher, short.wrap) : selectedLauncher,
      report: short.supervision?.report ?? ((error) => reportTerminationNotice(error, notice)),
      spec: short.supervision?.spec ?? {
        command: short.command ?? (runtime === 'deno' ? deno!.execPath() : process.execPath),
        args: explicitCommand
          ? (short.args ?? [])
          : [
              ...flags,
              fileURLToPath(entry!),
              ...(short.args ?? (options.spawn === true ? process.argv.slice(2) : []))
            ],
        cwd: short.cwd,
        env: { inherit: short.env?.inherit ?? ['PATH'], set: short.env?.set ?? {} },
        stdio: short.stdio ?? { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        limits: short.limits,
        permissions: short.permissions,
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(token) }
      }
    },
    rawChannel: async (handle) => (handle as INodeProcessHandle).channel!
  } as ISpawnProcessPluginDeployment
}

/** Allocate independent safe labels for the original accepted native connection. */
function createProcessConnectionContext() {
  /** No label is derived from credentials or from a decoded wire identity. */
  const id = globalThis.crypto.randomUUID()
  return { peerId: id, ipc: { connectionId: id, sessionId: id, log: () => undefined } }
}

/** Resolve exactly one short source, preserving full caller-owned acquisition recipes unchanged. */
export async function normalizeProcessSources(
  options: IProcessSourceOptions,
  runtime: string,
  forwarded: IProcessShortSourceOptions & Partial<IProcessShortSpawn> = {}
): Promise<IProcessFullSources> {
  /** Default reporting remains observable; full sources retain their original report functions. */
  const configuredReport = options.report
  /** Explicit reporters receive every notice; omitted defaults are coalesced per native process. */
  const reportEachTerminationNotice = configuredReport !== undefined
  const report = configuredReport ?? defaultRpcReporter
  /** The selected native recipe stays exact; forwarded call deadlines cannot restore its decorator. */
  const settings = { ...options, ...forwarded, connect: options.connect, report }
  /** Resolved options are passed only through the held preparation, never prepared a second time. */
  const resolved = { ...settings } as {
    -readonly [K in keyof IProcessFullSources]: IProcessFullSources[K]
  }
  if (
    [options.spawn, options.connect, options.listen].filter((source) => source !== undefined)
      .length !== 1
  )
    invalid('source')
  if (options.spawn === null || options.connect === null || options.listen === null)
    invalid('source')
  if (
    options.spawn !== undefined &&
    !(typeof options.spawn === 'object' && !isUrlObject(options.spawn) && 'kind' in options.spawn)
  ) {
    resolved.spawn = await normalizeShortProcessSpawn(
      options,
      runtime,
      forwarded,
      report,
      reportEachTerminationNotice
    )
  }
  if (typeof options.connect === 'string' || typeof options.listen === 'string') {
    /** Named endpoint permissions are checked before choosing OS authentication. */
    const selected = await endpoint((options.connect ?? options.listen) as string)
    /** TCP, explicit paths and Windows pipes require an explicit credential. */
    const token = settings.token ?? (selected.local ? PROCESS_LOCAL_AUTH_MARKER : undefined)
    if (typeof token !== 'string' || !token)
      invalid('token', RpcProcessErrorText.localTokenRequired)
    /** Selected native sockets still use the one original authentication/accept implementation. */
    const socket =
      runtime === 'deno'
        ? await import('./deno-socket.ts')
        : runtime === 'bun'
          ? await import('./bun-socket.ts')
          : await import('./node-socket.ts')
    if (typeof options.connect === 'string') {
      /**
       * The wait deadline only applies to named local rendezvous, with immediate explicit-address
       * errors.
       */
      const timeoutMs = settings.connectTimeoutMs ?? PROCESS_CONNECT_TIMEOUT_MS
      if (!Number.isFinite(timeoutMs) || timeoutMs < 0) invalid('connectTimeoutMs')
      /** The repeated dial borrows these exact cold source facts without owning native IO. */
      const connecting = { selected, socket, timeoutMs }
      resolved.connect = {
        kind: 'connect',
        address: selected.address,
        token,
        dial: (address, signal) =>
          connecting.selected.local
            ? dialWhenReady(
                connecting.socket.dialProcessByteChannel,
                address,
                signal,
                connecting.timeoutMs,
                systemScheduler
              )
            : connecting.socket.dialProcessByteChannel({ address, signal: signal as AbortSignal })
      }
    } else {
      /** Permission rollback borrows the original listener module, selection and reporter. */
      const listening = { socket, selected, report }
      /** Socket mode is narrowed inside the already private directory before exposing the listener. */
      const listen: IListenProcessByteChannel = selected.local
        ? (input) =>
            listenLocalProcessSocket(input, listening.socket, listening.selected, listening.report)
        : socket.listenProcessByteChannel
      resolved.listen = {
        kind: 'listener',
        address: selected.address,
        listen,
        scheduler: systemScheduler,
        verify:
          settings.verify ??
          ((auth) => {
            if (auth !== token)
              throw attachErrorIdentity(new Error(RpcProcessErrorText.authRejected), {
                source: ERROR_SOURCE,
                code: RpcProcessErrorCode.authRejected
              })
            return selected.local ? selected.principal : selected.address
          }),
        createConnectionContext: createProcessConnectionContext
      }
    }
  }
  return resolved
}
