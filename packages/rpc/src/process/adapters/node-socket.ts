import { lstat } from 'node:fs/promises'
import { createConnection, createServer, type Server, type Socket } from 'node:net'
import { hostRethrowReporter } from '@migaia/utils/promise'
import { RpcCoreErrorCode } from '../../core/index.js'
import { tagRpcError } from '../../core/transport-kit.js'
import { resolveAbortReason } from '../../core/internal/async-control.js'
import { IpcReporterContext } from '../../core/plugins/reporter-context.js'
import { RpcProcessErrorCode } from '../error-code.js'
import { createProcessError } from '../error.js'
import { RpcProcessErrorText } from '../error-text.js'
import { createProcessTransport } from '../handshake.js'
import type {
  IListenProcessByteChannel,
  IProcessByteChannel,
  IProcessByteListener,
  IProcessPendingByteConnection
} from '../types.js'
import { nodeByteStream } from './node-byte-stream.js'
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
  throw tagRpcError(
    new TypeError(RpcProcessErrorText.optionsInvalid),
    RpcCoreErrorCode.invalidConfig
  )
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
  return nodeByteStream(socket, socket, () => socket.destroy())
}

/** Connect to an existing process without taking ownership of its process lifetime. */
export async function dialProcessByteChannel(
  options: Readonly<{
    address: string
    signal?: AbortSignal
  }>
): Promise<IProcessByteChannel> {
  const address = parseAddress(options.address)
  if (options.signal?.aborted)
    throw createProcessError(RpcProcessErrorCode.connectFailed, resolveAbortReason(options.signal))
  return new Promise<IProcessByteChannel>((resolve, reject) => {
    /** Only one pre-connect failure may settle the dial. */
    const socket =
      address.kind === 'path'
        ? createConnection({ path: address.path })
        : createConnection({ host: address.host, port: address.port })
    const fail = (reason: unknown): void => {
      options.signal?.removeEventListener('abort', abort)
      socket.destroy()
      reject(createProcessError(RpcProcessErrorCode.connectFailed, reason))
    }
    const abort = (): void =>
      fail(options.signal === undefined ? undefined : resolveAbortReason(options.signal))
    socket.once('error', fail)
    options.signal?.addEventListener('abort', abort, { once: true })
    socket.once('connect', () => {
      socket.off('error', fail)
      options.signal?.removeEventListener('abort', abort)
      if (options.signal?.aborted) {
        fail(resolveAbortReason(options.signal))
        return
      }
      resolve(socketChannel(socket))
    })
  })
}

/** Bind a local authenticated rendezvous point without exposing unverified bytes. */
export const listenProcessByteChannel: IListenProcessByteChannel = async (
  options
): Promise<IProcessByteListener> => {
  if (
    !options ||
    options.auth?.mode !== 'required' ||
    typeof options.auth.verify !== 'function' ||
    typeof options.onConnection !== 'function' ||
    typeof options.report !== 'function'
  )
    throw tagRpcError(
      new TypeError(RpcProcessErrorText.optionsInvalid),
      RpcCoreErrorCode.invalidConfig
    )
  const address = parseAddress(options.address)
  if (options.signal?.aborted)
    throw createProcessError(RpcProcessErrorCode.listenFailed, resolveAbortReason(options.signal))
  /** Only connections without a completed accept remain owned by this listener. */
  const pendingSet = new Set<(reason: unknown) => Promise<void>>()
  /** Closing state precedes OS close, so racing accepts see the same terminal reason. */
  let closed = false
  let closeReason: unknown
  let closePromise: Promise<void> | undefined
  /** This server never reads or writes a business frame itself. */
  const server: Server = createServer((socket) => {
    if (closed) {
      socket.destroy()
      return
    }
    const raw = socketChannel(socket)
    /** State transfers ownership only after responder handshake fulfills. */
    let state: 'pending' | 'accepting' | 'ready' | 'closed' = 'pending'
    /** Re-read mutable state after asynchronous handshake work. */
    const wasClosed = (): boolean => state === 'closed'
    /** Listener close can reject an in-flight handshake immediately. */
    let rejectClose: ((reason: unknown) => void) | undefined
    const listenerClosed = new Promise<never>((_resolve, reject) => {
      rejectClose = reject
    })
    /** Observe a close even before accept attaches to the race. */
    void listenerClosed.catch(() => undefined)
    const closePending = async (reason: unknown): Promise<void> => {
      if (state === 'ready' || state === 'closed') return
      state = 'closed'
      pendingSet.delete(closePending)
      rejectClose?.(createProcessError(RpcProcessErrorCode.channelClosed, reason))
      await raw.close()
    }
    pendingSet.add(closePending)
    const pending: IProcessPendingByteConnection = Object.freeze({
      async accept(acceptOptions) {
        if (state !== 'pending' || closed)
          throw createProcessError(RpcProcessErrorCode.channelClosed, closeReason)
        state = 'accepting'
        /** The verifier's principal is retained only for this accepted connection. */
        let principalId: string | undefined
        try {
          const channel = await Promise.race([
            createProcessTransport(raw, {
              ...acceptOptions,
              role: 'responder',
              auth: {
                mode: 'required',
                async verify(auth, peer) {
                  if (closed || state === 'closed')
                    throw createProcessError(RpcProcessErrorCode.channelClosed, closeReason)
                  const verified = await options.auth.verify(auth, peer)
                  if (typeof verified !== 'string' || verified.length === 0)
                    throw createProcessError(RpcProcessErrorCode.authRejected)
                  principalId = verified
                }
              }
            }),
            listenerClosed
          ])
          if (closed || wasClosed()) {
            await channel.close()
            throw createProcessError(RpcProcessErrorCode.channelClosed, closeReason)
          }
          state = 'ready'
          pendingSet.delete(closePending)
          return Object.freeze({ channel, principalId: principalId! })
        } catch (error) {
          await closePending(error)
          throw closed ? createProcessError(RpcProcessErrorCode.channelClosed, closeReason) : error
        }
      },
      close: () => closePending(createProcessError(RpcProcessErrorCode.channelClosed))
    })
    void Promise.resolve()
      .then(() => options.onConnection(pending))
      .then(
        () => {
          if (state === 'pending') void pending.close()
        },
        (error: unknown) => {
          reportSafely(options.report, error)
          void closePending(error)
        }
      )
  })
  /** Listener errors after bind are diagnostic; they never close ready channels. */
  server.on('error', (error) => reportSafely(options.report, error))
  const managedPath =
    address.kind === 'path' && !address.path.startsWith('\\\\.\\pipe\\') && options.serviceId
      ? address.path
      : undefined
  if (managedPath) await prepareUnixSocketPath(managedPath, options.serviceId!)
  else if (address.kind === 'path' && !address.path.startsWith('\\\\.\\pipe\\')) {
    /** Existing paths are never removed or claimed as this listener's own. */
    let occupied = false
    try {
      await lstat(address.path)
      occupied = true
    } catch (error) {
      if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
        throw createProcessError(RpcProcessErrorCode.listenFailed, error)
    }
    if (occupied) throw createProcessError(RpcProcessErrorCode.listenFailed)
  }
  try {
    await new Promise<void>((resolve, reject) => {
      const failed = (error: Error): void => reject(error)
      server.once('error', failed)
      server.listen(
        address.kind === 'path'
          ? { path: address.path }
          : { host: address.host, port: address.port },
        () => {
          server.off('error', failed)
          resolve()
        }
      )
    })
  } catch (error) {
    throw createProcessError(RpcProcessErrorCode.listenFailed, error)
  }
  /** All Unix listeners retain their bound inode without shortening the caller's address. */
  const unixPath =
    address.kind === 'path' && !address.path.startsWith('\\\\.\\pipe\\') ? address.path : undefined
  /** Identity distinguishes this socket from a successor created before native close. */
  let boundIdentity: Awaited<ReturnType<typeof lstat>> | undefined
  if (unixPath) {
    try {
      boundIdentity = await lstat(unixPath)
    } catch (error) {
      server.close()
      throw createProcessError(RpcProcessErrorCode.listenFailed, error)
    }
  }
  /** The exact inode is recorded before exposing this listener as recoverable. */
  let ownerRecord: IUnixSocketRecord | undefined
  if (managedPath) {
    try {
      ownerRecord = await recordUnixSocketOwner(managedPath, options.serviceId!)
    } catch (error) {
      server.close()
      throw createProcessError(RpcProcessErrorCode.listenFailed, error)
    }
  }
  /** Port zero is replaced with the actual loopback port exposed by Node. */
  const bound = server.address()
  const boundAddress =
    address.kind === 'tcp' && bound && typeof bound !== 'string'
      ? `tcp://${address.host === '::1' ? '[::1]' : address.host}:${bound.port}`
      : options.address
  const close = async (): Promise<void> => {
    if (closePromise) return closePromise
    closed = true
    closeReason = createProcessError(RpcProcessErrorCode.channelClosed)
    closePromise = (async () => {
      /** Node/libuv unlinks its original bind path even if a successor has replaced the inode. */
      /** A different dev/ino marks a successor whose disappearance must be reported. */
      let successor: Awaited<ReturnType<typeof lstat>> | undefined
      if (unixPath && boundIdentity) {
        try {
          /** The last observable path identity precedes Node's non-atomic native close. */
          const current = await lstat(unixPath)
          if (current.dev !== boundIdentity.dev || current.ino !== boundIdentity.ino)
            successor = current
        } catch (error) {
          if (!(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT'))
            reportSafely(
              options.report,
              createProcessError(RpcProcessErrorCode.listenFailed, error)
            )
        }
      }
      server.close()
      if (unixPath && successor) {
        try {
          await lstat(unixPath)
        } catch (error) {
          /** Report this known native limitation once; do not recreate a foreign inode. */
          reportSafely(options.report, createProcessError(RpcProcessErrorCode.listenFailed, error))
        }
      }
      await Promise.all([...pendingSet].map((release) => release(closeReason)))
      /** Node owns removal of a Unix socket path created by this server. */
      if (managedPath && ownerRecord) {
        try {
          await removeUnixSocketOwner(managedPath, ownerRecord)
        } catch (error) {
          reportSafely(options.report, error)
        }
      }
      options.signal?.removeEventListener('abort', onAbort)
    })()
    return closePromise
  }
  const onAbort = (): void => {
    void close()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  if (options.signal?.aborted) await close()
  return Object.freeze({ address: boundAddress, close })
}
