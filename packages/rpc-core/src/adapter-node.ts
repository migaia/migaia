import type { Readable, Writable, Duplex } from 'node:stream'
import { nodeByteStream, nativeNodeByteOwner } from './adapter-owned/process/node-byte-stream.js'
import { registerNativeReplayOwner } from './core/internal/native-replay.js'

/** The caller holds these actual child pipe resources; labels grant no lifecycle or replay rights. */
export type IAdapterChildStdio = Readonly<{ stdout: Readable; stdin: Writable }>
/** The actual current-process stdio resource retains its original pause/end cleanup operations. */
export type IAdapterProcessStdio = Readonly<{ stdin: Readable; stdout: Writable }>

/**
 * Construct one child-stdio raw channel. Core installs physical observation and records only this
 * newly created channel's actual pipe lifetime/exclusive reader; no target transport is input.
 */
export function createAdapterChildStdio(child: IAdapterChildStdio) {
  /** The original close path reads the same held child's current pipe fields at termination. */
  const channel = nodeByteStream(child.stdout, child.stdin, () => {
    child.stdout?.destroy()
    child.stdin?.destroy()
  })
  registerNativeReplayOwner(channel, nativeNodeByteOwner(channel)!)
  return channel
}

/** Construct the current-process stdio channel, retaining the original pause/end close behavior. */
export function createAdapterProcessStdio(io: IAdapterProcessStdio) {
  /** Only these supplied readable/writable resources are touched by this channel's cleanup. */
  const channel = nodeByteStream(io.stdin, io.stdout, () => {
    io.stdin.pause()
    io.stdout.end()
  })
  registerNativeReplayOwner(channel, nativeNodeByteOwner(channel)!)
  return channel
}

/**
 * Construct a socket raw channel from the actual held duplex. As before, ordinary borrowed socket
 * channels do not receive launch/stdio active-replay qualification merely from their stream shape.
 */
export function createAdapterSocketByteIO(socket: Duplex) {
  return nodeByteStream(socket, socket, () => socket.destroy())
}
