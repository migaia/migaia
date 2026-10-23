import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { rpcMessageCapabilityControl } from '@migaia/rpc-contract/runtime'
import { systemScheduler } from '@migaia/utils/scheduler'
import { broadcastChannelPlugin } from '../../dist/index.js'
import { BroadcastChannelControl } from '../../dist/browser/broadcast-channel-text.js'

/** Independent provider state proves every participant owns its own calls and failures. */
type IParticipant = {
  value: number
  notes: unknown[]
  reports: unknown[]
  failure: Error
}
/** The actual native channels remain caller-owned after every logical host closes. */
type IRoom = {
  name: string
  channels: BroadcastChannel[]
  hosts: IRpcHost[]
  states: IParticipant[]
  add(value: number): Promise<IRpcHost>
  close(): Promise<void>
}

/** Open three real global BroadcastChannels; no synthetic transport or completed Peer is supplied. */
async function openRoom(): Promise<IRoom> {
  /** A fresh actual native channel namespace isolates each independent business case. */
  const name = randomUUID()
  /** These are the only fixture-owned native handles and logical resources. */
  const channels: BroadcastChannel[] = []
  const hosts: IRpcHost[] = []
  const states: IParticipant[] = []
  /** Close the hosts first so explicit leave traverses a still-open native carrier. */
  const close = async (): Promise<void> => {
    try {
      await Promise.all(hosts.map((host) => host.close()))
    } finally {
      for (const channel of channels) channel.close()
    }
  }
  /** Every participant exposes identical methods backed by distinct provider state. */
  const add = async (value: number): Promise<IRpcHost> => {
    /** The third provider's original Error is deliberately observed on its original report channel. */
    const state: IParticipant = {
      value,
      notes: [],
      reports: [],
      failure: new Error('third participant provider failure')
    }
    states.push(state)
    /** Separate same-named channel objects are genuine independent native participants. */
    const channel = new BroadcastChannel(name)
    channels.push(channel)
    /** Default host identities must be unique without manually assigning aliases. */
    const host = await createRpcHost({
      plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 1000 } })],
      report: (error) => state.reports.push(error),
      provide: {
        who: () => value,
        maybe: () => {
          if (value === 3) throw state.failure
          return value
        },
        note: (payload: unknown) => {
          state.notes.push(payload)
        },
        failNote: (payload: unknown) => {
          state.notes.push(payload)
          if (value === 3) throw state.failure
        },
        echo: (payload: unknown) => payload,
        sequence: async function* () {
          yield value
          if (value === 3) throw state.failure
          yield value * 10
        }
      }
    })
    hosts.push(host)
    return host
  }
  try {
    await add(1)
    await add(2)
    await add(3)
    await vi.waitFor(() => {
      for (const host of hosts) expect(Object.keys(host.peers)).toHaveLength(2)
    })
    return { name, channels, hosts, states, add, close }
  } catch (error) {
    await close()
    throw error
  }
}

/** Fanout keys are the existing host target keys, using each actual accepted participant name. */
function target(host: IRpcHost): string {
  return JSON.stringify(['target', host.self.name])
}

describe('BroadcastChannel transport plugin', () => {
  it('broadcasts request notify and stream with independent participant values and failures', async () => {
    const room = await openRoom()
    const [a, b, c] = room.hosts as [IRpcHost, IRpcHost, IRpcHost]
    try {
      expect(new Set(room.hosts.map((host) => host.self.name)).size).toBe(3)
      expect(await a.request('who')).toEqual({
        fulfilled: { [target(b)]: 2, [target(c)]: 3 },
        rejected: {}
      })
      const result = await a.request('maybe')
      expect(result).toMatchObject({
        fulfilled: { [target(b)]: 2 },
        rejected: { [target(c)]: { code: 'UNKNOWN' } }
      })
      expect(Object.keys((result as { rejected: object }).rejected)).toEqual([target(c)])
      await a.notify('failNote', 'broadcast notification')
      await vi.waitFor(() => {
        expect(room.states[0]!.notes).toEqual([])
        expect(room.states[1]!.notes).toEqual(['broadcast notification'])
        expect(room.states[2]!.notes).toEqual(['broadcast notification'])
        expect(room.states[2]!.reports).toContain(room.states[2]!.failure)
      })
      const streams = a.stream('sequence') as {
        fulfilled: Record<string, AsyncIterableIterator<unknown>>
        rejected: Record<string, unknown>
      }
      expect(streams.rejected).toEqual({})
      expect(await streams.fulfilled[target(b)]!.next()).toEqual({ value: 2, done: false })
      expect(await streams.fulfilled[target(c)]!.next()).toEqual({ value: 3, done: false })
      expect(await streams.fulfilled[target(b)]!.next()).toEqual({ value: 20, done: false })
      await expect(streams.fulfilled[target(c)]!.next()).rejects.toMatchObject({ code: 'UNKNOWN' })
      expect(await streams.fulfilled[target(b)]!.next()).toMatchObject({ done: true })
    } finally {
      await room.close()
    }
  })

  it('sends and dispatches only to the selected live direct endpoint id', async () => {
    const room = await openRoom()
    const [a, b, c] = room.hosts as [IRpcHost, IRpcHost, IRpcHost]
    try {
      expect(await a.send(b.self.instanceId, 'who')).toBe(2)
      await a.send(b.self.instanceId, 'note', 'only second')
      a.dispatch(c.self.instanceId, 'note', 'only third')
      await vi.waitFor(() => {
        expect(room.states[0]!.notes).toEqual([])
        expect(room.states[1]!.notes).toEqual(['only second'])
        expect(room.states[2]!.notes).toEqual(['only third'])
      })
      await expect(a.send('absent-participant', 'who')).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
    } finally {
      await room.close()
    }
  })

  it('publishes a fourth accepted join and explicit leave then excludes its retired session', async () => {
    const room = await openRoom()
    const first = room.hosts[0]!
    const joined: unknown[] = []
    const departed: unknown[] = []
    first.on('ready', (event) => joined.push(event.instanceId))
    first.on('exit', (event) => departed.push(event.instanceId))
    try {
      const fourth = await room.add(4)
      await vi.waitFor(() => {
        expect(joined).toContain(fourth.self.instanceId)
        for (const host of room.hosts) expect(Object.keys(host.peers)).toHaveLength(3)
      })
      await fourth.close()
      await vi.waitFor(() => {
        expect(departed).toContain(fourth.self.instanceId)
        expect(Object.keys(first.peers)).toHaveLength(2)
      })
      const result = await first.request('who')
      expect(result).toEqual({
        fulfilled: { [target(room.hosts[1]!)]: 2, [target(room.hosts[2]!)]: 3 },
        rejected: {}
      })
      /** Logical retirement borrows the physical channel; the caller can still use it. */
      const received: unknown[] = []
      room.channels[0]!.addEventListener('message', (event) => received.push(event.data), {
        once: true
      })
      room.channels[3]!.postMessage('caller channel remains open')
      await vi.waitFor(() => expect(received).toContain('caller channel remains open'))
    } finally {
      await room.close()
    }
  })

  it('rejects transfer synchronously and uses the original timeout for a silent discovered participant', async () => {
    const room = await openRoom()
    try {
      const buffer = new ArrayBuffer(8)
      expect(() => room.hosts[0]!.request('echo', buffer, { transfer: [buffer] })).toThrowError(
        expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED' })
      )
      expect(buffer.byteLength).toBe(8)
    } finally {
      await room.close()
    }
    /** This actual native participant announces itself but never answers the original handshake. */
    const name = randomUUID()
    const channel = new BroadcastChannel(name)
    const silent = new BroadcastChannel(name)
    const reports: unknown[] = []
    const schedule = vi.spyOn(systemScheduler, 'schedule')
    const host = await createRpcHost({
      plugins: [broadcastChannelPlugin({ channel, connect: { timeoutMs: 20 } })],
      report: (error) => reports.push(error)
    })
    try {
      silent.postMessage({
        protocol: BroadcastChannelControl.protocol,
        kind: BroadcastChannelControl.join,
        sender: 'silent-participant'
      })
      await vi.waitFor(() =>
        expect(reports).toContainEqual(
          expect.objectContaining({
            name: 'TypeError',
            code: 'INVALID_CONFIG',
            message: rpcMessageCapabilityControl.failureText
          })
        )
      )
      /** The original initial-capture timer is the only configured startup timer for this source. */
      const startupTimers = schedule.mock.calls.filter(
        ([, delay]) => typeof delay === 'number' && delay > 0 && delay <= 20
      )
      expect(startupTimers).toHaveLength(1)
      expect(Object.keys(host.peers)).toEqual([])
    } finally {
      await host.close()
      channel.close()
      silent.close()
      schedule.mockRestore()
    }
  })
})
