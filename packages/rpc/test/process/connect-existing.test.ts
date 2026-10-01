import { describe, expect, it } from 'vitest'
import { lstat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createProcessTransport } from '../../src/process/handshake.js'
import { createNativeProcessOffer } from '../../src/process/offer.js'
import {
  dialProcessByteChannel,
  listenProcessByteChannel
} from '../../src/process/adapters/node-socket.js'
import type {
  IAuthenticatedProcessChannel,
  IProcessPendingByteConnection
} from '../../src/process/types.js'

/** The listener verifies identity before handing out a routed channel. */
const responderOffer = createNativeProcessOffer({ peer: { id: 'listener', runtime: 'node' } })
/** The initiator sends one explicit token that never appears in returned metadata. */
const initiatorOffer = createNativeProcessOffer({
  peer: { id: 'dialer', runtime: 'node' },
  auth: 'socket-secret'
})

/** Connection-scoped IPC metadata is deliberately distinct on both sides. */
function ipc(id: string) {
  return { connectionId: id, sessionId: id, log: () => undefined }
}

describe('Node rendezvous sockets', () => {
  it('[D4] rejects a 16 MiB header before verifier admission', async () => {
    let verifierCalls = 0
    /** The server's rejected accept is the observable pre-auth boundary. */
    let settle: (error: unknown) => void = () => undefined
    const rejected = new Promise<unknown>((resolve) => {
      settle = resolve
    })
    const listener = await listenProcessByteChannel({
      address: 'tcp://127.0.0.1:0',
      auth: {
        mode: 'required',
        verify: () => {
          verifierCalls += 1
          return 'principal'
        }
      },
      report: () => undefined,
      async onConnection(pending) {
        try {
          await pending.accept({
            peerId: 'untrusted',
            offer: responderOffer,
            report: () => undefined,
            ipc: ipc('oversized')
          })
          settle(undefined)
        } catch (error) {
          settle(error)
        }
      }
    })
    const raw = await dialProcessByteChannel({ address: listener.address })
    try {
      /** The four-byte prefix alone declares 16 MiB; no payload is transmitted. */
      await raw.write(new Uint8Array([1, 0, 0, 0])).catch(() => undefined)
      await expect(rejected).resolves.toMatchObject({ code: 'FRAME_LIMIT_EXCEEDED' })
      expect(verifierCalls).toBe(0)
    } finally {
      await raw.close()
      await listener.close()
    }
  })

  it('[A10] accepts only a verified pending connection and keeps it after listener close', async () => {
    /** Responder fulfillment proves the socket reached the authenticated ready state. */
    let resolveAccepted: (value: IAuthenticatedProcessChannel) => void = () => undefined
    const accepted = new Promise<IAuthenticatedProcessChannel>((resolve) => {
      resolveAccepted = resolve
    })
    /** The callback receives only the pending capability, never raw socket writes. */
    let pendingKeys: string[] = []
    const listener = await listenProcessByteChannel({
      address: 'tcp://127.0.0.1:0',
      auth: {
        mode: 'required',
        verify(auth) {
          expect(auth).toBe('socket-secret')
          return 'stable-principal'
        }
      },
      report: (error) => {
        throw error
      },
      async onConnection(pending) {
        pendingKeys = Object.keys(pending)
        resolveAccepted(
          await pending.accept({
            peerId: 'dialer-route',
            offer: responderOffer,
            report: (error) => {
              throw error
            },
            ipc: ipc('responder')
          })
        )
        await expect(
          pending.accept({
            peerId: 'dialer-route',
            offer: responderOffer,
            report: () => undefined,
            ipc: ipc('duplicate')
          })
        ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
      }
    })
    const socket = await dialProcessByteChannel({ address: listener.address })
    const initiator = await createProcessTransport(socket, {
      role: 'initiator',
      peerId: 'listener-route',
      offer: initiatorOffer,
      report: () => undefined,
      ipc: ipc('initiator')
    })
    const ready = await accepted
    expect(pendingKeys).toEqual(['accept', 'close'])
    expect(ready.principalId).toBe('stable-principal')
    expect(ready.channel.peerId).toBe('dialer-route')
    expect(JSON.stringify(ready)).not.toContain('socket-secret')
    await listener.close()
    expect(initiator.transport.closed).toBe(false)
    expect(ready.channel.transport.closed).toBe(false)
    await initiator.close()
    await ready.channel.close()
  })

  it('[A10] rejects absent verifier and non-loopback addresses before bind or dial', async () => {
    await expect(
      listenProcessByteChannel({
        address: 'tcp://127.0.0.1:0',
        auth: { mode: 'none' },
        onConnection: () => undefined,
        report: () => undefined
      } as never)
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    await expect(dialProcessByteChannel({ address: 'tcp://192.0.2.1:1' })).rejects.toMatchObject({
      code: 'INVALID_CONFIG'
    })
    await expect(
      listenProcessByteChannel({
        address: 'tcp://0.0.0.0:0',
        auth: { mode: 'required', verify: () => 'principal' },
        onConnection: () => undefined,
        report: () => undefined
      })
    ).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
  })

  it('[A10] binds a Unix socket, removes only its own path, and preserves an occupied path', async () => {
    const folder = fileURLToPath(new URL('.', import.meta.url))
    /** A short temporary name stays below Darwin's Unix-domain path limit. */
    const path = join(tmpdir(), `r-${randomUUID().slice(0, 8)}.sock`)
    const listener = await listenProcessByteChannel({
      address: path,
      auth: { mode: 'required', verify: () => 'principal' },
      onConnection: (pending) => pending.close(),
      report: () => undefined
    })
    try {
      expect(listener.address).toBe(path)
      expect((await lstat(path)).isSocket()).toBe(true)
      const dialed = await dialProcessByteChannel({ address: path })
      await dialed.close()
    } finally {
      await listener.close()
    }
    await expect(lstat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    const occupied = resolve(folder, 'connect-existing.test.ts')
    await expect(
      listenProcessByteChannel({
        address: occupied,
        auth: { mode: 'required', verify: () => 'principal' },
        onConnection: () => undefined,
        report: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_LISTEN_FAILED' })
    expect((await lstat(occupied)).isFile()).toBe(true)
  })

  it('[A10] closes both held and handshaking pending sockets without invoking the verifier', async () => {
    /** The callback remains open so a held pending is not auto-closed on return. */
    let finishCallback: () => void = () => undefined
    const callbackLifetime = new Promise<void>((resolve) => {
      finishCallback = resolve
    })
    /** The first pending waits; the second starts its handshake but sends no hello. */
    let provideHeld: (pending: IProcessPendingByteConnection) => void = () => undefined
    const held = new Promise<IProcessPendingByteConnection>((resolve) => {
      provideHeld = resolve
    })
    let provideHandshaking: (pending: {
      attempt: Promise<IAuthenticatedProcessChannel>
    }) => void = () => undefined
    const handshaking = new Promise<{ attempt: Promise<IAuthenticatedProcessChannel> }>(
      (resolve) => {
        provideHandshaking = resolve
      }
    )
    let arrivals = 0
    let verifierCalls = 0
    const listener = await listenProcessByteChannel({
      address: 'tcp://127.0.0.1:0',
      auth: {
        mode: 'required',
        verify: () => {
          verifierCalls += 1
          return 'principal'
        }
      },
      report: () => undefined,
      onConnection(pending) {
        arrivals += 1
        if (arrivals === 1) provideHeld(pending)
        else {
          const attempt = pending.accept({
            offer: responderOffer,
            peerId: 'silent',
            ipc: ipc('silent'),
            report: () => undefined
          })
          void attempt.catch(() => undefined)
          provideHandshaking({ attempt })
        }
        return callbackLifetime
      }
    })
    const first = await dialProcessByteChannel({ address: listener.address })
    const pending = await held
    const second = await dialProcessByteChannel({ address: listener.address })
    const { attempt } = await handshaking
    await listener.close()
    await expect(
      pending.accept({
        offer: responderOffer,
        peerId: 'late',
        ipc: ipc('late'),
        report: () => undefined
      })
    ).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    await expect(attempt).rejects.toMatchObject({ code: 'PROCESS_CHANNEL_CLOSED' })
    expect(verifierCalls).toBe(0)
    finishCallback()
    await first.close()
    await second.close()
  })
})
