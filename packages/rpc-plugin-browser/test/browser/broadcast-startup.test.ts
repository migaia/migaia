/** Native BroadcastChannel discovery already orders route installation before semantic startup. */
import { randomUUID } from 'node:crypto'
import { createRpcHost } from '@migaia/rpc-host'
import { broadcastChannelPlugin } from '@migaia/rpc-plugin-browser'
import { expect, it, vi } from 'vitest'
import { BroadcastChannelControl } from '../../dist/browser/broadcast-channel-text.js'

/** Observe a semantic hello inside the existing native discovery shell without modifying it. */
function hello(value: unknown): boolean {
  /** Native sender routing remains separate from the actual common codec's physical frame. */
  const frame = value as { kind: string; payload?: { data: string } }
  if (frame.kind !== BroadcastChannelControl.data) return false
  /** Startup assertions observe only genuine JSON data emitted by the original codec. */
  const message = JSON.parse(frame.payload!.data)
  return message.kind === 'handshake' && message.step === 'hello'
}

it('reuses targeted native join ordering when the first participant starts before its peer exists', async () => {
  /** The peer channel does not exist when the first join is sent, so native broadcast drops it. */
  const left = new BroadcastChannel(randomUUID())
  /** Record the real native send order while preserving BroadcastChannel's actual delivery. */
  const sentLeft = vi.spyOn(left, 'postMessage')
  /** Both participants retain independently owned diagnostics. */
  const reports: unknown[] = []
  /** A listener-style Host can start before any native participant is present. */
  const first = await createRpcHost({
    self: { name: 'left', instanceId: 'a-native-broadcast' },
    plugins: [broadcastChannelPlugin({ channel: left, connect: { timeoutMs: 100 } })],
    report: (error) => reports.push(error)
  })
  expect(sentLeft.mock.calls).toHaveLength(1)
  /** Only now create the opposing native channel; the original untargeted join cannot be replayed. */
  const right = new BroadcastChannel(left.name)
  /** The responder's original semantic hello must also be sent only once. */
  const sentRight = vi.spyOn(right, 'postMessage')
  /** Joining the room triggers the existing targeted join before either side sends semantic data. */
  const second = await createRpcHost({
    self: { name: 'right', instanceId: 'z-native-broadcast' },
    plugins: [broadcastChannelPlugin({ channel: right, connect: { timeoutMs: 100 } })],
    report: (error) => reports.push(error)
  })
  try {
    await vi.waitFor(() => {
      expect(Object.keys(first.broadcastChannel.peers)).toHaveLength(1)
      expect(Object.keys(second.broadcastChannel.peers)).toHaveLength(1)
    })
    /** The original sender posts targeted discovery before the queued Session hello can run. */
    const writtenLeft = sentLeft.mock.calls.map(([frame]) => frame)
    expect(writtenLeft[1]).toMatchObject({
      kind: BroadcastChannelControl.join,
      target: second.self.instanceId
    })
    expect(writtenLeft[2]).toMatchObject({ kind: BroadcastChannelControl.data })
    expect(writtenLeft.filter(hello)).toHaveLength(1)
    expect(sentRight.mock.calls.map(([frame]) => frame).filter(hello)).toHaveLength(1)
    expect(reports).toEqual([])
  } finally {
    await Promise.all([first.close(), second.close()])
    left.close()
    right.close()
  }
})
