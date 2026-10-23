import { describe, expect, it } from 'vitest'
import { createNativeProcessOffer } from '../../dist/process/offer.js'
import { createProcessTransport } from '../../dist/process/handshake.js'
import { type IProcessByteChannel, type IProcessMessageChannel } from '../../dist/process/types.js'
import type { IRpcCarrierProbe } from '@migaia/rpc-host/probe'

/** Paired physical readers exercise the public process factory's genuine byte handshake. */
function bytePair(): readonly [IProcessByteChannel, IProcessByteChannel] {
  /** Each connection owns its original physical reader callback. */
  const readers: Array<((bytes: Uint8Array) => void) | undefined> = []
  /** Build one side without decorating Core's resulting transport or replacing its framer. */
  const port = (index: 0 | 1): IProcessByteChannel => ({
    kind: 'byte',
    async write(bytes) {
      await Promise.resolve()
      readers[1 - index]?.(bytes)
    },
    onData(listener) {
      readers[index] = listener
      return () => {
        readers[index] = undefined
      }
    },
    onClose: () => () => undefined,
    close: () => undefined
  })
  return [port(0), port(1)]
}

/** Cold fake probe proves the public carrier capability without loading probe-core. */
const probe: IRpcCarrierProbe = { capturing: false, emit: () => undefined }

describe('process carrier observation', () => {
  it('byte transport exposes direct observe after the genuine handshake', async () => {
    /** The raw I/O contract is shared by Node/Bun/Deno stdio and local socket adapters. */
    const [leftPort, rightPort] = bytePair()
    /** Ordinary diagnostics remain the same supplied process connection inputs. */
    const common = {
      report: () => undefined,
      ipc: { connectionId: 'probe', sessionId: 'probe', log: () => undefined }
    }
    /** Both sides use the ordinary public factory and negotiate their real JSON byte connection. */
    const [left, right] = await Promise.all([
      createProcessTransport(leftPort, {
        ...common,
        role: 'initiator',
        peerId: 'right',
        offer: createNativeProcessOffer({ peer: { id: 'left', runtime: 'node' } })
      }),
      createProcessTransport(rightPort, {
        ...common,
        role: 'responder',
        peerId: 'left',
        offer: createNativeProcessOffer({ peer: { id: 'right', runtime: 'node' } }),
        auth: { mode: 'none' }
      })
    ])
    try {
      expect(left.transport.observe).toBeTypeOf('function')
      expect(right.transport.observe).toBeTypeOf('function')
      /** This direct call is the carrier contract; a Core probe plugin is not a prerequisite. */
      const dispose = left.transport.observe!(probe)
      dispose()
      dispose()
    } finally {
      await left.close()
      await right.close()
    }
  })

  it('static whole-message transport exposes direct observe for Electron', async () => {
    /** Electron utility processes supply this whole-message port rather than byte I/O. */
    const port: IProcessMessageChannel = {
      kind: 'message',
      send: () => undefined,
      onMessage: () => () => undefined,
      onClose: () => () => undefined,
      close: () => undefined
    }
    /** Empty equal agreements retain the ordinary no-handshake message path. */
    const channel = await createProcessTransport(port, {
      peerId: 'electron-child',
      report: () => undefined,
      ipc: { connectionId: 'electron', sessionId: 'electron', log: () => undefined },
      staticAgreement: {
        local: { codec: 'identity', capabilities: [] },
        peer: { codec: 'identity', capabilities: [] }
      }
    })
    try {
      expect(channel.transport.observe).toBeTypeOf('function')
      /** The fake probe calls observe directly, independently of the Core observation plugin. */
      const dispose = channel.transport.observe!(probe)
      dispose()
      dispose()
    } finally {
      await channel.close()
    }
  })
})
