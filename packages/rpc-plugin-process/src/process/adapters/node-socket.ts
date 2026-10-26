/** Own native local socket acquisition and pending admission; Session owns handshake and business. */
import { attachErrorIdentity } from '@migaia/utils/error'
import { lstat } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { deferred, hostRethrowReporter } from '@migaia/utils/promise'
import { RPC_ENDPOINT_ERROR_SOURCE, RpcCoreErrorCode } from '@migaia/rpc-contract/error-code'
import { IpcReporterContext, resolveAbortReason } from '@migaia/rpc-host/sdk'
import { RpcProcessErrorCode } from '@migaia/rpc-contract/error-code'

import { RpcProcessErrorText } from '../error-text.js'
import { createProcessError, tagNativeProcessError } from '../error.js'
import type {
  IListenProcessByteChannel,
  IProcessByteChannel,
  IProcessByteListener,
  IProcessPendingByteConnection
} from '../types.js'
import { createAdapterSocketByteIO } from '../node-io.js'
import {
  prepareUnixSocketPath,
  recordUnixSocketOwner,
  removeUnixSocketOwner,
  type IUnixSocketRecord
} from './unix-socket-ownership.js'

/** Node socket addresses are absolute Unix paths, Windows pipe paths, or numeric loopback TCP URLs. */
type INodeSocketAddress =
  | Readonly<{ kind: 'path'; path: string }>
  | Readonly<{ kind: 'tcp'; host: string; port: number }>

/** Reject network exposure at the adapter boundary, before Node binds or dials. */
function parseAddress(address: string): INodeSocketAddress {
  if (
    typeof address === 'string' &&
    (address.startsWith('/') ||
      (process.platform === 'win32' && address.startsWith('\\\\.\\pipe\\')))
  )
    return { kind: 'path', path: address }
  try {
    const url = new URL(address)
    if (
      url.protocol === 'tcp:' &&
      (url.hostname === '127.0.0.1' || url.hostname === '[::1]') &&
      (url.pathname === '' || url.pathname === '/') &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      /^\d+$/.test(url.port)
    )
      return {
        kind: 'tcp',
        host: url.hostname === '[::1]' ? '::1' : url.hostname,
        port: Number(url.port)
      }
  } catch {
    // Invalid addresses use the same fixed, non-secret diagnostic as forbidden hosts.
  }
  throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
    source: RPC_ENDPOINT_ERROR_SOURCE,
    code: RpcCoreErrorCode.invalidConfig
  })
}

/** Preserve the caller's error even if its diagnostic reporter fails. */
function reportSafely(report: (error: unknown) => void, error: unknown): void {
  try {
    report(error)
  } catch (reporterError) {
    hostRethrowReporter(reporterError, IpcReporterContext)
  }
}

/** Adapt one accepted socket; the upper channel alone owns its reader and close. */
function socketChannel(socket: Socket): IProcessByteChannel {
  return createAdapterSocketByteIO(socket)
}

/** Dial options are borrowed until the one native connection or its original failure settles. */
type INodeSocketDialOptions = Readonly<{
  address: string
  signal?: AbortSignal
}>

/** One dial owns its native callbacks and completion, without a closure-backed connection factory. */
class NodeSocketDial {
  /** Native cancellation is read through the original options, retaining its existing getter order. */
  readonly #options: INodeSocketDialOptions
  /** The successful channel adopts this exact socket without a second native connection. */
  readonly #socket: Socket
  /** A pre-connect native failure and the connect callback settle one original dial operation. */
  readonly #completion = deferred<IProcessByteChannel>()

  /** Acquire only the native socket; public admission has already checked address and cancellation. */
  constructor(address: INodeSocketAddress, options: INodeSocketDialOptions) {
    this.#options = options
    this.#socket =
      address.kind === 'path'
        ? createConnection({ path: address.path })
        : createConnection({ host: address.host, port: address.port })
  }

  /** Preserve error-before-abort-before-connect listener registration on the original socket. */
  open(): Promise<IProcessByteChannel> {
    try {
      this.#socket.once('error', this.#fail)
      this.#options.signal?.addEventListener('abort', this.#abort, { once: true })
      this.#socket.once('connect', this.#connected)
    } catch (error) {
      this.#completion.reject(error)
    }
    return this.#completion.promise
  }

  /** Failure removes only the dial abort subscription and retains the exact original cause. */
  readonly #fail = (reason: unknown): void => {
    this.#options.signal?.removeEventListener('abort', this.#abort)
    this.#socket.destroy()
    this.#completion.reject(createProcessError(RpcProcessErrorCode.connectFailed, reason))
  }

  /** A throwing native reason getter remains the cancellation cause without being replaced. */
  readonly #abort = (): void => {
    this.#fail(
      this.#options.signal === undefined ? undefined : resolveAbortReason(this.#options.signal)
    )
  }

  /** Transfer ownership after removing dial-only subscriptions and rechecking cancellation. */
  readonly #connected = (): void => {
    this.#socket.off('error', this.#fail)
    this.#options.signal?.removeEventListener('abort', this.#abort)
    if (this.#options.signal?.aborted) {
      this.#fail(resolveAbortReason(this.#options.signal))
      return
    }
    this.#completion.resolve(socketChannel(this.#socket))
  }
}

/**
 * Dial one absolute Unix path, supported Windows pipe, or numeric loopback TCP URL. The returned
 * channel owns only the local socket and has not yet authenticated a remote peer. Cancellation or
 * native dial failure rejects PROCESS_CHANNEL_CONNECT_FAILED with the original reason as cause;
 * invalid/nonlocal addresses reject INVALID_CONFIG before opening a socket. This operation does not
 * add retries or a dial timeout.
 */
export async function dialProcessByteChannel(
  options: INodeSocketDialOptions
): Promise<IProcessByteChannel> {
  const address = parseAddress(options.address)
  if (options.signal?.aborted)
    throw createProcessError(RpcProcessErrorCode.connectFailed, resolveAbortReason(options.signal))
  return new NodeSocketDial(address, options).open()
}

/**
 * Bind a local rendezvous point and deliver pending candidates for one actual Session acceptance.
 * Returning from onConnection without accepting closes the candidate. close shares one Promise,
 * stops accepts and pending admissions, but leaves ready channels with their adopting owners. Bind
 * failures reject PROCESS_CHANNEL_LISTEN_FAILED; later native/path cleanup errors are reported.
 * serviceId enables matching stale Unix-owner recovery, not a guarantee against external path
 * races.
 */
/**
 * Listener-owned state is shared explicitly with pending sockets until authentication transfers
 * ownership.
 */
type INodeSocketListenerScope = {
  options: Parameters<IListenProcessByteChannel>[0]
  address: INodeSocketAddress
  pendingSet: Set<(reason: unknown) => Promise<void>>
  closed: boolean
  closeReason: unknown
}

/** Own one accepted native socket until its Session admission transfers the ready channel. */
class NodeSocketCandidate {
  /** The listener alone owns terminal state and pending-candidate membership. */
  #scope: INodeSocketListenerScope
  /** The accepted socket has one canonical byte IO owner. */
  #raw: IProcessByteChannel
  /** This candidate changes ownership only after the Session admission completes. */
  #state: 'pending' | 'accepting' | 'ready' | 'closed' = 'pending'
  /** Listener cancellation rejects the same in-flight handshake race. */
  #rejectClose: ((reason: unknown) => void) | undefined
  /** This receipt is observed even before accept attaches its race. */
  #listenerClosed: Promise<never>
  /** The exact candidate passed to the caller retains stable accept and close callbacks. */
  readonly value: IProcessPendingByteConnection
  /** Acquire raw IO and its cancellation receipt before publishing a candidate. */
  constructor(scope: INodeSocketListenerScope, socket: Socket) {
    this.#scope = scope
    this.#raw = socketChannel(socket)
    this.#listenerClosed = new Promise<never>((_resolve, reject) => {
      this.#rejectClose = reject
    })
    void this.#listenerClosed.catch(() => undefined)
    scope.pendingSet.add(this.#closePending)
    this.value = Object.freeze({
      accept: this.#accept,
      close: () => this.#closePending(createProcessError(RpcProcessErrorCode.channelClosed))
    })
  }
  /** Re-read mutable state after asynchronous handshake work. */
  #wasClosed = (): boolean => this.#state === 'closed'
  /** Close only listener-owned candidates; ready channels retain their adopting owner. */
  #closePending = async (reason: unknown): Promise<void> => {
    if (this.#state === 'ready' || this.#state === 'closed') return
    this.#state = 'closed'
    this.#scope.pendingSet.delete(this.#closePending)
    this.#rejectClose?.(createProcessError(RpcProcessErrorCode.channelClosed, reason))
    await this.#raw.close()
  }
  /**
   * Adopt one pending socket through actual Session admission and transfer ownership only after the
   * original close checks.
   */
  #accept = async <T>(adopt: (raw: IProcessByteChannel) => Promise<T>): Promise<T> => {
    if (this.#state !== 'pending' || this.#scope.closed)
      throw createProcessError(RpcProcessErrorCode.channelClosed, this.#scope.closeReason)
    this.#state = 'accepting'
    try {
      const channel = await Promise.race([adopt(this.#raw), this.#listenerClosed])
      if (this.#scope.closed || this.#wasClosed()) {
        await this.#raw.close()
        throw createProcessError(RpcProcessErrorCode.channelClosed, this.#scope.closeReason)
      }
      this.#state = 'ready'
      this.#scope.pendingSet.delete(this.#closePending)
      return channel
    } catch (error) {
      await this.#closePending(error)
      throw this.#scope.closed
        ? createProcessError(RpcProcessErrorCode.channelClosed, this.#scope.closeReason)
        : error
    }
  }
  /** Deliver the candidate after native accept, then close any candidate the caller did not accept. */
  publish(): void {
    void Promise.resolve()
      .then(() => (0, this.#scope.options.onConnection)(this.value))
      .then(
        () => {
          if (this.#state === 'pending') void this.value.close().catch(this.#reportCleanup)
        },
        (error: unknown) => {
          reportSafely(this.#scope.options.report, error)
          void this.#closePending(error).catch(this.#reportCleanup)
        }
      )
  }
  /** Detached cleanup keeps its own rejection observable without replacing admission failure. */
  readonly #reportCleanup = (error: unknown): void =>
    reportSafely(this.#scope.options.report, error)
}

/** Own the native listening socket, Unix identity and still-pending admission candidates. */
class NodeSocketListener {
  /** Pending membership and terminal state are shared with candidates through one explicit context. */
  #scope: INodeSocketListenerScope
  /** Native listener close never closes already adopted sockets. */
  #server: Server
  /** Only a service-labelled Unix path participates in owner-record recovery. */
  #managedPath: string | undefined
  /** The original bound Unix path is retained without shortening caller addresses. */
  #unixPath: string | undefined
  /** Native close is checked against the exact original inode. */
  #boundIdentity: Awaited<ReturnType<typeof lstat>> | undefined
  /** The original Unix ownership record is removed only after pending sockets settle. */
  #ownerRecord: IUnixSocketRecord | undefined
  /** Every close caller observes the same cleanup transaction. */
  #closePromise: Promise<void> | undefined
  /** Prepare native callbacks without starting a second listener lifecycle. */
  constructor(options: Parameters<IListenProcessByteChannel>[0], address: INodeSocketAddress) {
    this.#scope = { options, address, pendingSet: new Set(), closed: false, closeReason: undefined }
    this.#server = createServer((socket) => {
      if (this.#scope.closed) {
        socket.destroy()
        return
      }
      new NodeSocketCandidate(this.#scope, socket).publish()
    })
    this.#server.on('error', (error) =>
      reportSafely(
        this.#scope.options.report,
        tagNativeProcessError(error, RpcProcessErrorCode.listenFailed)
      )
    )
  }
  /** Bind and record the original native socket identity before exposing the listener. */
  async open(): Promise<IProcessByteListener> {
    this.#managedPath =
      this.#scope.address.kind === 'path' &&
      !this.#scope.address.path.startsWith('\\\\.\\pipe\\') &&
      this.#scope.options.serviceId
        ? this.#scope.address.path
        : undefined
    if (this.#managedPath) {
      try {
        await prepareUnixSocketPath(this.#managedPath, this.#scope.options.serviceId!)
      } catch (error) {
        throw tagNativeProcessError(error as Error, RpcProcessErrorCode.listenFailed)
      }
    } else if (
      this.#scope.address.kind === 'path' &&
      !this.#scope.address.path.startsWith('\\\\.\\pipe\\')
    ) {
      /** Existing paths are never removed or claimed as this listener's own. */
      let occupied = false
      try {
        await lstat(this.#scope.address.path)
        occupied = true
      } catch (error) {
        if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
          throw createProcessError(RpcProcessErrorCode.listenFailed, error)
      }
      if (occupied) throw createProcessError(RpcProcessErrorCode.listenFailed)
    }
    try {
      await this.#bind()
    } catch (error) {
      throw createProcessError(RpcProcessErrorCode.listenFailed, error)
    }
    this.#unixPath =
      this.#scope.address.kind === 'path' && !this.#scope.address.path.startsWith('\\\\.\\pipe\\')
        ? this.#scope.address.path
        : undefined

    if (this.#unixPath) {
      try {
        this.#boundIdentity = await lstat(this.#unixPath)
      } catch (error) {
        this.#server.close()
        throw createProcessError(RpcProcessErrorCode.listenFailed, error)
      }
    }

    if (this.#managedPath) {
      try {
        this.#ownerRecord = await recordUnixSocketOwner(
          this.#managedPath,
          this.#scope.options.serviceId!
        )
      } catch (error) {
        this.#server.close()
        throw createProcessError(RpcProcessErrorCode.listenFailed, error)
      }
    }
    /** Port zero is replaced with the actual loopback port exposed by Node. */
    const bound = this.#server.address()
    const boundAddress =
      this.#scope.address.kind === 'tcp' && bound && typeof bound !== 'string'
        ? `tcp://${this.#scope.address.host === '::1' ? '[::1]' : this.#scope.address.host}:${bound.port}`
        : this.#scope.options.address
    this.#scope.options.signal?.addEventListener('abort', this.#onAbort, { once: true })
    if (this.#scope.options.signal?.aborted) await this.#close()
    return Object.freeze({ address: boundAddress, close: this.#close })
  }

  /** Bind callbacks and synchronous native failures settle the same one original operation. */
  #bind(): Promise<void> {
    /** The error listener's exact identity is removed by the successful native listen callback. */
    const completion = deferred<void>()
    /** Node's original error value reaches the existing coded outer listen boundary unchanged. */
    const failed = (error: Error): void => completion.reject(error)
    try {
      this.#server.once('error', failed)
      this.#server.listen(
        this.#scope.address.kind === 'path'
          ? { path: this.#scope.address.path }
          : { host: this.#scope.address.host, port: this.#scope.address.port },
        () => {
          this.#server.off('error', failed)
          completion.resolve()
        }
      )
    } catch (error) {
      completion.reject(error)
    }
    return completion.promise
  }

  /** Stop accepts, settle pending admissions and remove only this listener's ownership record. */
  #close = (): Promise<void> => {
    if (this.#closePromise) return this.#closePromise
    this.#scope.closed = true
    /** Abort-driven candidates keep the listening owner's reason on their closed-channel cause. */
    const signal = this.#scope.options.signal
    this.#scope.closeReason = signal?.aborted
      ? resolveAbortReason(signal)
      : createProcessError(RpcProcessErrorCode.channelClosed)
    this.#closePromise = this.#release()
    return this.#closePromise
  }

  /** Release only listener-owned candidates and inode records, preserving original native order. */
  async #release(): Promise<void> {
    try {
      /** Node/libuv unlinks its original bind path even if a successor has replaced the inode. */
      /** A different dev/ino marks a successor whose disappearance must be reported. */
      let successor: Awaited<ReturnType<typeof lstat>> | undefined
      if (this.#unixPath && this.#boundIdentity) {
        try {
          /** The last observable path identity precedes Node's non-atomic native close. */
          const current = await lstat(this.#unixPath)
          if (current.dev !== this.#boundIdentity.dev || current.ino !== this.#boundIdentity.ino)
            successor = current
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            reportSafely(
              this.#scope.options.report,
              createProcessError(RpcProcessErrorCode.listenFailed, error)
            )
        }
      }
      this.#server.close()
      if (this.#unixPath && successor) {
        try {
          await lstat(this.#unixPath)
        } catch (error) {
          /** Report this known native limitation once; do not recreate a foreign inode. */
          reportSafely(
            this.#scope.options.report,
            createProcessError(RpcProcessErrorCode.listenFailed, error)
          )
        }
      }
      await Promise.all(
        [...this.#scope.pendingSet].map((release) => release(this.#scope.closeReason))
      )
      /** Node owns removal of a Unix socket path created by this server. */
      if (this.#managedPath && this.#ownerRecord) {
        try {
          await removeUnixSocketOwner(this.#managedPath, this.#ownerRecord)
        } catch (error) {
          reportSafely(this.#scope.options.report, error)
        }
      }
    } finally {
      this.#scope.options.signal?.removeEventListener('abort', this.#onAbort)
    }
  }
  /** External cancellation joins the one existing close transaction. */
  #onAbort = (): void => {
    void this.#close().catch(this.#reportCleanup)
  }
  /** Signal-triggered cleanup reports through the listener's existing failure boundary. */
  readonly #reportCleanup = (error: unknown): void =>
    reportSafely(this.#scope.options.report, error)
}

export const listenProcessByteChannel: IListenProcessByteChannel = async (
  options
): Promise<IProcessByteListener> => {
  if (
    !options ||
    typeof options.onConnection !== 'function' ||
    typeof options.report !== 'function'
  )
    throw attachErrorIdentity(new TypeError(RpcProcessErrorText.optionsInvalid), {
      source: RPC_ENDPOINT_ERROR_SOURCE,
      code: RpcCoreErrorCode.invalidConfig
    })
  const address = parseAddress(options.address)
  if (options.signal?.aborted)
    throw createProcessError(RpcProcessErrorCode.listenFailed, resolveAbortReason(options.signal))

  return new NodeSocketListener(options, address).open()
}

/** The moved socket resource operation keeps native dependencies in this owning public entry. */
export { createAdapterSocketByteIO } from '../node-io.js'
