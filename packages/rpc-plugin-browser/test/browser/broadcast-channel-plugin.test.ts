import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import type { IRpcObservation } from '@migaia/rpc-host/sdk'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  defineFlowPlugin,
  HostObservationKind,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'
import { systemScheduler } from '@migaia/utils/scheduler'
import { broadcastChannelPlugin } from '../../dist/index.js'
import { BroadcastChannelControl } from '../../dist/browser/broadcast-channel-text.js'

/** Actual factory namespace types remain independent from the public root lifetime surface. */
type IRoomHost = IRpcHost<Record<never, never>, readonly [IRpcTransportPlugin<'broadcastChannel'>]>

/** Independent provider state proves every participant owns its own calls and failures. */
type IParticipant = {
  value: number
  notes: unknown[]
  reports: unknown[]
  failure: Error
  /** Actual cold observations retain accepted and retired peer instances. */
  joined: unknown[]
  departed: unknown[]
}
/** The actual native channels remain caller-owned after every logical host closes. */
type IRoom = {
  name: string
  channels: BroadcastChannel[]
  hosts: IRoomHost[]
  states: IParticipant[]
  add(value: number): Promise<IRoomHost>
  close(): Promise<void>
}

/** Open three real global BroadcastChannels; no synthetic transport or completed Peer is supplied. */
/** Allocate only the native listener's original membership and cleanup storage. */
function broadcastRoomFixtureState() {
  const name = randomUUID()
  const channels: BroadcastChannel[] = []
  const hosts: IRoomHost[] = []
  const states: IParticipant[] = []
  return { name, channels, hosts, states }
}

/** Own one native browser listener while the Host keeps accepted endpoint and directory ownership. */
class BroadcastRoomFixture {
  /** Native membership, pending preparation and the one close receipt belong to this listener. */
  #state: ReturnType<typeof broadcastRoomFixtureState>
  /** Create storage before native callbacks can publish any accepted resource. */
  constructor() {
    this.#state = broadcastRoomFixtureState()
  }
  /** Attach native acceptance and retain the original rollback and close semantics. */
  async open() {
    try {
      await this.#add(1)
      await this.#add(2)
      await this.#add(3)
      await vi.waitFor(() => {
        for (const host of this.#state.hosts)
          expect(Object.keys(host.broadcastChannel.peers)).toHaveLength(2)
      })
      return {
        name: this.#state.name,
        channels: this.#state.channels,
        hosts: this.#state.hosts,
        states: this.#state.states,
        add: this.#add,
        close: this.#close
      }
    } catch (error) {
      await this.#close()
      throw error
    }
  }
  /** Preserve the original listener operation against this listener's explicit state. */
  #close = async (): Promise<void> => {
    try {
      await Promise.all(this.#state.hosts.map((host) => host.close()))
    } finally {
      for (const channel of this.#state.channels) channel.close()
    }
  }
  /** Preserve the original listener operation against this listener's explicit state. */
  #add = async (value: number): Promise<IRoomHost> => {
    /** The third provider's original Error is deliberately observed on its original report channel. */
    const state: IParticipant = {
      value,
      notes: [],
      reports: [],
      failure: new Error('third participant provider failure'),
      joined: [],
      departed: []
    }
    this.#state.states.push(state)
    /** Separate same-named channel objects are genuine independent native participants. */
    const channel = new BroadcastChannel(this.#state.name)
    this.#state.channels.push(channel)
    /** Default host identities must be unique without manually assigning aliases. */
    const host = await createRpcHost({
      plugins: [
        defineFlowPlugin<Record<never, never>>({
          name: 'broadcast-native-observer',
          setup: () => ({
            observe: (event: IRpcObservation) => {
              if (event.kind === HostObservationKind.peerReady) state.joined.push(event.peerId)
              else if (event.kind === HostObservationKind.peerLeave)
                state.departed.push(event.peerId)
            }
          })
        }),
        broadcastChannelPlugin({ channel, connect: { timeoutMs: 1000 } })
      ],
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
    this.#state.hosts.push(host)
    return host
  }
}

/** Attach the one native listener without creating another Host or endpoint. */
async function openRoom(): Promise<IRoom> {
  return new BroadcastRoomFixture().open()
}

/** Fanout keys are the existing host target keys, using each actual accepted participant name. */
function target(host: IRoomHost): string {
  return JSON.stringify(['target', host.self.name])
}

describe('BroadcastChannel transport plugin', () => {
  it('broadcasts request notify and stream with independent participant values and failures', async () => {
    const room = await openRoom()
    const [a, b, c] = room.hosts as [IRoomHost, IRoomHost, IRoomHost]
    try {
      expect(new Set(room.hosts.map((host) => host.self.name)).size).toBe(3)
      expect(await a.broadcastChannel.request('who')).toEqual({
        fulfilled: { [target(b)]: 2, [target(c)]: 3 },
        rejected: {}
      })
      const result = await a.broadcastChannel.request('maybe')
      expect(result).toMatchObject({
        fulfilled: { [target(b)]: 2 },
        rejected: { [target(c)]: { code: 'INTERNAL' } }
      })
      expect(Object.keys((result as { rejected: object }).rejected)).toEqual([target(c)])
      await a.broadcastChannel.notify('failNote', 'broadcast notification')
      await vi.waitFor(() => {
        expect(room.states[0]!.notes).toEqual([])
        expect(room.states[1]!.notes).toEqual(['broadcast notification'])
        expect(room.states[2]!.notes).toEqual(['broadcast notification'])
        expect(room.states[2]!.reports).toContain(room.states[2]!.failure)
      })
      const streams = a.broadcastChannel.stream('sequence') as {
        fulfilled: Record<string, AsyncIterableIterator<unknown>>
        rejected: Record<string, unknown>
      }
      expect(streams.rejected).toEqual({})
      expect(await streams.fulfilled[target(b)]!.next()).toEqual({ value: 2, done: false })
      expect(await streams.fulfilled[target(c)]!.next()).toEqual({ value: 3, done: false })
      expect(await streams.fulfilled[target(b)]!.next()).toEqual({ value: 20, done: false })
      await expect(streams.fulfilled[target(c)]!.next()).rejects.toMatchObject({ code: 'INTERNAL' })
      expect(await streams.fulfilled[target(b)]!.next()).toMatchObject({ done: true })
    } finally {
      await room.close()
    }
  })

  it('sends and dispatches only to the selected live direct endpoint id', async () => {
    const room = await openRoom()
    const [a, b, c] = room.hosts as [IRoomHost, IRoomHost, IRoomHost]
    try {
      expect(await a.broadcastChannel.send(b.self.instanceId, 'who')).toBe(2)
      await a.broadcastChannel.send(b.self.instanceId, 'note', 'only second')
      a.broadcastChannel.dispatch(c.self.instanceId, 'note', 'only third')
      await vi.waitFor(() => {
        expect(room.states[0]!.notes).toEqual([])
        expect(room.states[1]!.notes).toEqual(['only second'])
        expect(room.states[2]!.notes).toEqual(['only third'])
      })
      await expect(a.broadcastChannel.send('absent-participant', 'who')).rejects.toMatchObject({
        code: 'TARGET_UNKNOWN'
      })
    } finally {
      await room.close()
    }
  })

  it('publishes a fourth accepted join and explicit leave then excludes its retired session', async () => {
    const room = await openRoom()
    const first = room.hosts[0]!
    const joined = room.states[0]!.joined
    const departed = room.states[0]!.departed
    try {
      const fourth = await room.add(4)
      await vi.waitFor(() => {
        expect(joined).toContain(fourth.self.instanceId)
        for (const host of room.hosts)
          expect(Object.keys(host.broadcastChannel.peers)).toHaveLength(3)
      })
      await fourth.close()
      await vi.waitFor(() => {
        expect(departed).toContain(fourth.self.instanceId)
        expect(Object.keys(first.broadcastChannel.peers)).toHaveLength(2)
      })
      const result = await first.broadcastChannel.request('who')
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
      expect(() =>
        room.hosts[0]!.broadcastChannel.request('echo', buffer, { transfer: [buffer] })
      ).toThrowError(expect.objectContaining({ code: 'CAPABILITY_UNSUPPORTED' }))
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
            message: 'Thread data bootstrap was not acknowledged'
          })
        )
      )
      /** The original initial-capture timer is the only configured startup timer for this source. */
      const startupTimers = schedule.mock.calls.filter(
        ([, delay]) => typeof delay === 'number' && delay > 0 && delay <= 20
      )
      expect(startupTimers).toHaveLength(1)
      expect(Object.keys(host.broadcastChannel.peers)).toEqual([])
    } finally {
      await host.close()
      channel.close()
      silent.close()
      schedule.mockRestore()
    }
  })
})
