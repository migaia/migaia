import { createRemoteRuntimeRegistration } from '../../dist/remote/proxy.js'
import {
  createRuntimePeer,
  readRuntimePeerConnection,
  readRuntimePeerEndpoint,
  type IRuntimePeer
} from '../../dist/remote/runtime-api/peer.js'
import { runtimeSources } from '../runtime-api/fixture.js'
import { remoteHarness, REMOTE_FIXTURE_CONTRACT } from './fixture.js'
import { systemScheduler } from '@migaia/utils/scheduler'

/** A real connected pair supplies the stream/outbound owners borrowed by remote registration. */
export class RuntimeStreamFixture {
  /** Existing neutral ports own only the original supervisor's generation events. */
  readonly #ports = remoteHarness()
  /** The actual source pair retains the physical connection until both real Peers retire. */
  readonly #source: ReturnType<typeof runtimeSources>
  /** Each genuine Peer keeps its canonical endpoint brand, routes, and protocol state. */
  readonly #peers: readonly IRuntimePeer[]
  /** Repeated fixture cleanup shares the same complete native release Promise. */
  #closing: Promise<void> | undefined
  /** Observations target the actual caller endpoint rather than a structural stream port. */
  readonly served: ReturnType<typeof readRuntimePeerEndpoint>
  /** Original registration owns deadline admission and the borrowed native generation. */
  readonly registration: ReturnType<typeof createRemoteRuntimeRegistration>
  /** Background failures remain available without hiding them behind the original neutral reporter. */
  readonly reports: unknown[] = []

  /** Retain accepted native resources without constructing or branding another endpoint. */
  constructor(
    source: ReturnType<typeof runtimeSources>,
    peers: readonly IRuntimePeer[],
    callDeadlineCapMs?: number
  ) {
    this.#source = source
    this.#peers = peers
    this.served = readRuntimePeerEndpoint(peers[0]!)
    /** The registration sees the exact accepted channel and target identity of this caller. */
    const connection = readRuntimePeerConnection(peers[0]!)
    this.registration = createRemoteRuntimeRegistration({
      binding: {
        ...this.#ports.binding,
        scheduler: connection.channel.scheduler,
        openChannel: async () => ({
          ...connection.channel,
          peerId: connection.peerId,
          close: connection.channel.close!
        })
      },
      prepareRuntime: async () => peers[0]!,
      readRuntimeEndpoint: readRuntimePeerEndpoint,
      callDeadlineCapMs,
      report: (error) => this.reports.push(error)
    })
  }

  /** Prepare both actual protocol participants concurrently before borrowing their accepted caller. */
  static async open(callDeadlineCapMs?: number): Promise<RuntimeStreamFixture> {
    /** The existing source barrier publishes independently captured runtime offers. */
    const source = runtimeSources()
    /** Fixed admission time preserves exact caps while native timers still run real stream turns. */
    const scheduler =
      callDeadlineCapMs === undefined ? systemScheduler : { ...systemScheduler, now: () => 0 }
    /**
     * Actual local providers distinguish scalar, notification, generator, and async-generator
     * modes.
     */
    const peers = await Promise.all([
      createRuntimePeer({
        self: { name: 'caller', instanceId: 'caller' },
        connect: async (context) => ({ ...(await source.sources[0](context)), scheduler }),
        report: () => undefined
      }),
      createRuntimePeer({
        self: { name: 'peer', instanceId: 'peer' },
        provide: {
          p: {
            f: {
              request: () => 'result',
              oneWay: () => undefined,
              generator: function* () {
                yield 'item'
              },
              asyncGenerator: async function* () {
                yield 'item'
              }
            }
          }
        },
        contract: REMOTE_FIXTURE_CONTRACT,
        connect: async (context) => ({ ...(await source.sources[1](context)), scheduler }),
        report: () => undefined
      })
    ])
    /** Only this fixture's genuine registration owns the borrowed generation lifetime. */
    const fixture = new RuntimeStreamFixture(source, peers, callDeadlineCapMs)
    try {
      await fixture.registration.prepareGeneration(new AbortController().signal, () => undefined)
      return fixture
    } catch (error) {
      await fixture.close()
      throw error
    }
  }

  /** Release the borrowed registration before joining both actual Peer and transport owners. */
  close(): Promise<void> {
    return (this.#closing ??= this.#close())
  }

  /** Cleanup follows original ownership order and does not invent a stream cancellation path. */
  async #close(): Promise<void> {
    try {
      await this.registration.release()
    } finally {
      try {
        await this.#peers[0]!.close()
        await this.#peers[1]!.close()
      } finally {
        this.#source.close()
      }
    }
  }
}
