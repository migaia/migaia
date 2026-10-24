import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  createAdapterDeployment,
  defineTransportPlugin,
  type IAdapterDeploymentContext
} from '@migaia/rpc-host/plugin'
import { memoryServer } from '../../rpc-host/test/host/fixture.js'

/** Per-acquisition inputs observe real Host operations without replacing their results. */
type IRepeatableConnectOptions = Readonly<{
  beforeOpen?(index: number): void | Promise<void>
  closeErrors?: readonly (unknown | undefined)[]
  provide?(index: number): Parameters<typeof createRpcHost>[0]['provide']
}>
/** The fixture wraps only the actual native source channel returned by the canonical server. */
type IRepeatableChannel = Awaited<ReturnType<ReturnType<typeof memoryServer>['open']>>

/** Own the fixture's one close observation around an actual channel and remote Host. */
class RepeatableFixtureChannel {
  /** The channel retains its own physical cleanup semantics. */
  #channel: IRepeatableChannel
  /** The actual remote Host closes after its physical source. */
  #remote: IRpcHost<unknown>
  /** Acquisition order identifies which original native source is closing. */
  #index: number
  /** Shared observation records actual close ordering without owning production lifecycle. */
  #closeOrder: number[]
  /** This case may reject only after its real owned resources close. */
  #options: IRepeatableConnectOptions
  /** Repeated close returns the same complete cleanup receipt. */
  #closing: Promise<void> | undefined
  /** The source keeps every original operation except this case-owned close observation. */
  readonly value: IRepeatableChannel
  /** Retain the exact channel and Host already acquired by the fixture. */
  constructor(
    channel: IRepeatableChannel,
    remote: IRpcHost<unknown>,
    index: number,
    closeOrder: number[],
    options: IRepeatableConnectOptions
  ) {
    this.#channel = channel
    this.#remote = remote
    this.#index = index
    this.#closeOrder = closeOrder
    this.#options = options
    this.value = { ...channel, close: this.#close }
  }
  /** Share the exact original teardown completion across reentrant and repeated close. */
  #close = (): Promise<void> => (this.#closing ??= this.#release())
  /** Observe close before releasing the original channel and genuine remote Host in order. */
  async #release(): Promise<void> {
    this.#closeOrder.push(this.#index)
    await this.#channel.close()
    await this.#remote.close()
    if (this.#options.closeErrors?.[this.#index] !== undefined)
      throw this.#options.closeErrors[this.#index]
  }
}

/** Own one repeatable source fixture's acquisitions and remote Host observations. */
class RepeatableConnectFixture {
  /** Caller-selected acquisition behavior remains local to this fixture instance. */
  #options: IRepeatableConnectOptions
  /** Count actual source openings rather than mocked member-facade calls. */
  #opens = 0
  /** Real remote Hosts remain accessible to the fixture's existing business assertions. */
  #remotes: IRpcHost<unknown>[] = []
  /** Close-order evidence is separate from logical pool membership. */
  #closeOrder: number[] = []
  /** Preserve the original fixture surface and its actual transport authoring recipe. */
  readonly value
  /** Create the cold recipe before any acquisition can observe this fixture. */
  constructor(options: IRepeatableConnectOptions) {
    this.#options = options
    this.value = {
      transport: defineTransportPlugin({
        name: 'repeatable-connect',
        mode: 'connect',
        deployment: createAdapterDeployment({ open: this.#open })
      }),
      remotes: this.#remotes,
      closeOrder: this.#closeOrder,
      opens: () => this.#opens
    }
  }
  /** Open independent genuine remote Hosts and canonical raw channels for every acquisition. */
  #open = async (context: IAdapterDeploymentContext) => {
    /** This source number belongs to one original native acquisition. */
    const index = this.#opens++
    await this.#options.beforeOpen?.(index)
    /** A fresh server identity isolates this acquisition's accepted endpoint. */
    const server = memoryServer(`member-${index}`, `member-${crypto.randomUUID()}`)
    const remote = await createRpcHost({
      ...server.options,
      provide: this.#options.provide?.(index) ?? {
        identity: () => index,
        echo: (value: unknown) => value
      }
    })
    this.#remotes.push(remote)
    const channel = await server.open(context)
    return new RepeatableFixtureChannel(channel, remote, index, this.#closeOrder, this.#options)
      .value
  }
}

/** Create an independent observation owner for actual repeatable canonical source acquisitions. */
export function repeatableConnect(options: IRepeatableConnectOptions = {}) {
  return new RepeatableConnectFixture(options).value
}
