/**
 * Binds child pipes, current stdio and local sockets to the shared byte owner. Physical cleanup
 * preserves their distinct destroy or pause/end behavior without terminating the process.
 */
import type { Readable, Writable, Duplex } from 'node:stream'
import { nodeByteStream } from './node-byte-stream.js'

/** The caller holds the actual independent child read/write pipes. */
export type IAdapterChildStdio = Readonly<{
  /** Readable child stdout exclusively consumed by this channel. */
  stdout: Readable
  /** Writable child stdin whose native drain supplies backpressure. */
  stdin: Writable
}>
/** Current native stdio owns its original pause/end cleanup operations. */
export type IAdapterProcessStdio = Readonly<{
  /** Current process stdin; closing the channel pauses this stream. */
  stdin: Readable
  /** Current process stdout; closing the channel ends this stream. */
  stdout: Writable
}>

/**
 * Construct one child byte channel; close destroys both pipes, while process termination stays
 * separate.
 */
export function createAdapterChildStdio(child: IAdapterChildStdio) {
  return nodeByteStream(
    child.stdout,
    child.stdin,
    () => {
      child.stdout?.destroy()
      child.stdin?.destroy()
    },
    () => child.stdout.listenerCount('data') === 1
  )
}

/** Construct current stdio without replacing native pause/end behavior. */
export function createAdapterProcessStdio(io: IAdapterProcessStdio) {
  return nodeByteStream(
    io.stdin,
    io.stdout,
    () => {
      io.stdin.pause()
      io.stdout.end()
    },
    () => io.stdin.listenerCount('data') === 1
  )
}

/**
 * Construct a byte channel over one duplex; close destroys this local socket, not its remote
 * process.
 */
export function createAdapterSocketByteIO(socket: Duplex) {
  return nodeByteStream(socket, socket, () => socket.destroy())
}
