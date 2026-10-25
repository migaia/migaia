/** Copies borrowed public observations for the real four-Host forwarding fixture. */
import { probe, type IRpcProbeEventView } from '@migaia/rpc-host/plugins/probe'
import { devtoolsPlugin } from '@migaia/rpc-plugin-devtools'

/** Only application fixture configuration is passed through native args or Worker data. */
export type IForwardFixtureOptions = Readonly<{ observed: boolean; cMaxHops?: number }>

/** The actual native recipes and business assertions share this fixture's one vocabulary owner. */
export const ForwardFixture = {
  /** One trace excludes the genuine inspection requests from the business observation. */
  trace: 'a21-render',
  /** Native names are selected by each public source recipe, never by forged wire metadata. */
  b: 'b',
  c: 'c',
  d: 'd',
  /** Real provider entries supply readiness and the actual node's observation snapshot. */
  ready: 'ready',
  inspect: 'inspect',
  render: 'render',
  /** The caller uses the two actual advertised forwarding prefixes. */
  forwarded: 'c.d.render'
} as const

/** Only the selected public numeric facts and copied strings survive a probe callback. */
type IForwardProbeEvent = Pick<
  IRpcProbeEventView,
  'endpointId' | 'stage' | 'direction' | 'outcome' | 'hop' | 'maxHops'
> & { messageId: string; method: string; route: readonly string[]; rejection: string }

/** The original native node and its actual descendants are queried through their real providers. */
export type IForwardNodeSnapshot = Readonly<{
  selfId: string
  renderCalls: number
  observations?: ReturnType<ForwardObservation['snapshot']>
  child?: IForwardNodeSnapshot
}>

/** Probe and real Devtools collector share the actual installed flow observations. */
export class ForwardObservation {
  /** Each synchronous callback copies borrowed metadata before the original view is reused. */
  readonly #events: IForwardProbeEvent[] = []
  /** Default stages must include forwarding without a test-specific stage override. */
  readonly #devtools = devtoolsPlugin()
  /** This public probe observes the real owner's numeric events and no synthetic frames. */
  readonly #probe = probe({
    stages: ['forward', 'message'],
    emit: (view) => {
      if (view.trace === ForwardFixture.trace) this.#events.push(this.#copy(view))
    }
  })

  /** Actual Host installation receives the two complete existing flow plugins. */
  get plugins() {
    return [this.#probe, this.#devtools] as const
  }

  /** Copy only portable metadata; errors and captured business graphs are not fixture transport. */
  #copy(view: IRpcProbeEventView): IForwardProbeEvent {
    return {
      endpointId: view.endpointId,
      stage: view.stage,
      direction: view.direction,
      outcome: view.outcome,
      messageId: view.messageId ?? '',
      method: view.method ?? '',
      hop: view.hop,
      maxHops: view.maxHops,
      route: view.route ? [...view.route] : [],
      rejection: view.rejection ?? ''
    }
  }

  /** The caller reads actual retained collector rows, without installing a second observer. */
  snapshot() {
    return {
      probe: [...this.#events],
      devtools: this.#devtools.collector
        .query({ trace: ForwardFixture.trace })
        .events.map((event) => ({
          endpointId: event.endpointId,
          stage: event.stage,
          direction: event.direction,
          outcome: event.outcome,
          messageId: event.messageId ?? '',
          method: event.method ?? '',
          hop: event.hop ?? -1,
          maxHops: event.maxHops ?? -1,
          route: event.route ? [...event.route] : [],
          rejection: event.rejection ?? ''
        }))
    }
  }
}
