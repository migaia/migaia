/** Uses one actual Process middle and one actual Worker leaf, with no synthetic routing. */
import { isMainThread, workerData } from 'node:worker_threads'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import {
  defineFlowFeature,
  RpcFlowPoint,
  type IRpcFlowFeature,
  type IRpcFlowStage,
  type IRpcTransportPlugin
} from '@migaia/rpc-host/sdk'
import { RpcWireKind } from '@migaia/rpc-contract/protocol'
import type { IRpcEnvelopePayload } from '@migaia/rpc-contract/interfaces'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import { FeatureScopeFixture, featureScopeAuth } from './feature-scope-child.ts'

/** One fixture vocabulary distinguishes application traffic from native bootstrap and stats calls. */
export const FeatureScopeForwardFixture = {
  middle: 'middle',
  leaf: 'leaf',
  up: 'up',
  down: 'down',
  ready: 'ready',
  stats: 'stats',
  echo: 'echo',
  forwarded: 'leaf.echo',
  marker: 'a25-group-forward-business',
  middleRole: 'a25-group-middle',
  leafRole: 'a25-group-leaf'
} as const

/** Only the two genuine envelope intervention names may enter the application snapshot. */
type IFeatureScopePoint = typeof RpcFlowPoint.envelopeInbound | typeof RpcFlowPoint.envelopeOutbound
/** Every row identifies both its installed placement and the actual pipeline's namespace. */
export type IFeatureScopeForwardRow = Readonly<{
  scope: string
  namespace: string
  point: IFeatureScopePoint
  method: string
}>
/** This counter belongs to the real final Worker provider, rather than a forwarding observation. */
type IFeatureScopeLeafStats = Readonly<{ echoCalls: number }>
/** Only the installed native namespace belongs to the final Worker's public Host. */
type IFeatureScopeLeafHost = IRpcHost<
  Record<never, never>,
  readonly [IRpcTransportPlugin<'native', object, true>]
>
/** The middle borrows exactly its two declared public namespaces and native closing capability. */
type IFeatureScopeMiddleHost = IRpcHost<
  Record<never, never>,
  readonly [IRpcTransportPlugin<'up', object, true>, IRpcTransportPlugin<'down', object, true>]
>
/** Public middle inspection reads the original two recorders and the same actual downstream leaf. */
export type IFeatureScopeForwardStats = Readonly<{
  up: readonly IFeatureScopeForwardRow[]
  down: readonly IFeatureScopeForwardRow[]
  leaf: IFeatureScopeLeafStats
}>

/** One namespace-local third-party Feature records only the selected real business call. */
class ScopedEnvelopeObservation {
  /** The installation label is independent of the context namespace being verified. */
  readonly #scope: string
  /** Business rows are copied before the original native pipeline continuation resumes. */
  readonly #rows: IFeatureScopeForwardRow[] = []
  /** The same opaque native Feature is lent directly to this transport's public options. */
  readonly feature: IRpcFlowFeature

  /** Capture no native resources; setup only publishes genuine stages to the receiving group. */
  constructor(scope: string) {
    this.#scope = scope
    this.feature = defineFlowFeature({
      name: `a25-forward-${scope}`,
      setup: () => ({
        stages: {
          [RpcFlowPoint.envelopeInbound]: this.#inbound,
          [RpcFlowPoint.envelopeOutbound]: this.#outbound
        }
      })
    })
  }

  /** Inbound observation runs at the default plaintext position after the genuine verifier. */
  readonly #inbound: IRpcFlowStage<'envelopeInbound'> = async (payload, next) => {
    await this.#record(RpcFlowPoint.envelopeInbound, payload)
    await next(payload)
  }

  /** Outbound observation runs before genuine signing without modifying prepared metadata. */
  readonly #outbound: IRpcFlowStage<'envelopeOutbound'> = async (payload, next) => {
    await this.#record(RpcFlowPoint.envelopeOutbound, payload)
    await next(payload)
  }

  /** Canonical restore supplies admitted plaintext; readiness, replies and inspection are excluded. */
  async #record(point: IFeatureScopePoint, payload: IRpcEnvelopePayload): Promise<void> {
    /** No private Session or carrier state is read to classify the actual forwarded business. */
    const message = await payload.context.restore(payload.prepared)
    if (
      message?.kind === RpcWireKind.call &&
      message.payload === FeatureScopeForwardFixture.marker &&
      (message.task.method === FeatureScopeForwardFixture.forwarded ||
        message.task.method === FeatureScopeForwardFixture.echo)
    )
      this.#rows.push({
        scope: this.#scope,
        namespace: payload.context.namespace,
        point,
        method: message.task.method
      })
  }

  /** Inspection returns a copy of the fixture's own rows, never a live execution capability. */
  snapshot(): readonly IFeatureScopeForwardRow[] {
    return [...this.#rows]
  }
}

/** The actual final Worker owns the sole business execution count. */
class FeatureScopeLeaf {
  /** Only execution of the publicly exposed echo callback increments this value. */
  #echoCalls = 0
  /** Providers wait on this original Host installation rather than inventing a readiness signal. */
  readonly #opening: Promise<IFeatureScopeLeafHost>

  /** The original Thread plugin borrows its real parent and authenticates with the same Host key. */
  constructor() {
    this.#opening = createRpcHost({
      plugins: [
        featureScopeAuth(FeatureScopeFixture.hostKey),
        threadPlugin({ namespace: 'native', connectToParent: true })
      ],
      provide: {
        [FeatureScopeForwardFixture.echo]: (value: unknown) => this.#echo(value),
        [FeatureScopeForwardFixture.ready]: async () => {
          await this.#opening
          return true
        },
        [FeatureScopeForwardFixture.stats]: (): IFeatureScopeLeafStats => ({
          echoCalls: this.#echoCalls
        })
      }
    })
  }

  /** Return the exact received value after one actual provider execution. */
  #echo(value: unknown): unknown {
    this.#echoCalls += 1
    return value
  }

  /** The native fixture remains alive through the same actual Host and its parent channel. */
  opened(): Promise<IFeatureScopeLeafHost> {
    return this.#opening
  }
}

/** The real middle Host forwards through its normal advertised leaf prefix. */
class FeatureScopeMiddle {
  /** Each transport owns an independent genuine Feature placement. */
  readonly #up = new ScopedEnvelopeObservation(FeatureScopeForwardFixture.up)
  /** Downstream state is never shared with the upstream Feature placement. */
  readonly #down = new ScopedEnvelopeObservation(FeatureScopeForwardFixture.down)
  /** This actual installation contains both native sources and their two declared pipeline groups. */
  readonly #opening: Promise<IFeatureScopeMiddleHost>

  /** Acquire only through original Process-parent and Thread-spawn source recipes. */
  constructor() {
    this.#opening = createRpcHost({
      plugins: [
        featureScopeAuth(FeatureScopeFixture.hostKey),
        processPlugin({
          namespace: FeatureScopeForwardFixture.up,
          connectToParent: true,
          features: [this.#up.feature]
        }),
        threadPlugin({
          name: FeatureScopeForwardFixture.leaf,
          namespace: FeatureScopeForwardFixture.down,
          features: [this.#down.feature],
          spawn: { entry: new URL(import.meta.url), data: FeatureScopeForwardFixture.leafRole }
        })
      ],
      provide: {
        [FeatureScopeForwardFixture.ready]: async () =>
          (await this.#opening).down.send(
            FeatureScopeForwardFixture.leaf,
            FeatureScopeForwardFixture.ready
          ),
        [FeatureScopeForwardFixture.stats]: async (): Promise<IFeatureScopeForwardStats> => ({
          up: this.#up.snapshot(),
          down: this.#down.snapshot(),
          leaf: (await (
            await this.#opening
          ).down.send(
            FeatureScopeForwardFixture.leaf,
            FeatureScopeForwardFixture.stats
          )) as IFeatureScopeLeafStats
        })
      }
    })
  }

  /** The original opening Promise gates readiness of the real forwarded directory. */
  opened(): Promise<IFeatureScopeMiddleHost> {
    return this.#opening
  }
}

// Importing fixture vocabulary into Vitest acquires nothing; only native recipes select a role.
if (isMainThread) {
  if (process.argv[2] === FeatureScopeForwardFixture.middleRole)
    await new FeatureScopeMiddle().opened()
} else if (workerData?.data === FeatureScopeForwardFixture.leafRole)
  await new FeatureScopeLeaf().opened()
