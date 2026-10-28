/** Own authenticated relay Features; registry, routing and topics retain their canonical state. */
import { defineFeature, definePlugin, type IPluginConstraint } from '@migaia/plugin-host'
import type { IRpcContext } from '@migaia/rpc-host'
import { TrayInternal, TrayCallKind } from '../constants.ts'
import { createTrayError } from '../../errors.ts'
import { TrayErrorCode } from '../../error-code.ts'
import type { ITrayRegistry, ITrayRecord } from './registry.ts'
import type { ITraySender } from '../remote.ts'
import type { createRoutingRegistry } from '../routing.ts'
import type { IAnyTrayHost } from '../typing.ts'
import type { createParentTopics } from './topics.ts'
/** Relay envelope carries an admission receipt and omits an absent application payload. */
type IRelayCall = Readonly<{
  host: string
  id: string
  receipt: string
  path: string
  payload?: unknown
}>
/** Parent relay authenticates the sender through the outlet's accepted instance id projection. */
export function createRelay(
  registry: ITrayRegistry,
  send: (record: ITrayRecord) => ITraySender,
  routing: ReturnType<typeof createRoutingRegistry>,
  hosts: ReadonlyMap<string, IAnyTrayHost>,
  topics: ReturnType<typeof createParentTopics>,
  assertActive: () => void
): IPluginConstraint<any, any, any> {
  return new TrayRelay(registry, send, routing, hosts, topics, assertActive).plugin
}

/** One relay plugin retains the original parent authorities without a factory closure component. */
class TrayRelay {
  /** Registry owns sender admissions and opaque target receipts. */
  readonly #registry: ITrayRegistry
  /** Original record-bound sender factory retains the one counted dispatch path. */
  readonly #send: (record: ITrayRecord) => ITraySender
  /** Parent policy registry owns its shared selection sequences. */
  readonly #routing: ReturnType<typeof createRoutingRegistry>
  /** Only the parent's trusted host declarations may be routed. */
  readonly #hosts: ReadonlyMap<string, IAnyTrayHost>
  /** Existing topic owner authenticates membership and publisher metadata. */
  readonly #topics: ReturnType<typeof createParentTopics>
  /** Closing admission retains the original precedence for routed and topic operations. */
  readonly #assertActive: () => void
  /** Genuine plugin definition exposes the same relay Feature name and method surface. */
  readonly plugin: IPluginConstraint<any, any, any>

  /** Capture canonical authorities once; each Feature activation still constructs its own surface. */
  constructor(
    registry: ITrayRegistry,
    send: (record: ITrayRecord) => ITraySender,
    routing: ReturnType<typeof createRoutingRegistry>,
    hosts: ReadonlyMap<string, IAnyTrayHost>,
    topics: ReturnType<typeof createParentTopics>,
    assertActive: () => void
  ) {
    this.#registry = registry
    this.#send = send
    this.#routing = routing
    this.#hosts = hosts
    this.#topics = topics
    this.#assertActive = assertActive
    this.plugin = definePlugin({
      name: TrayInternal.relayPlugin,
      features: { relay: defineFeature(() => this.#feature()) },
      install: () => ({})
    })
  }

  /** A removed or superseded child cannot originate new relayed calls. */
  #sender(context: IRpcContext): void {
    /** Sender identity is read only from the original authenticated RPC context. */
    const admitted = this.#registry.instanceIds.get(context.senderId)
    if (!admitted || admitted.record.removed || admitted.record.generation !== admitted.generation)
      throw createTrayError(TrayErrorCode.instanceUnknown)
  }
  /** Receipt validation and forwarding share the same currently admitted record. */
  #target(input: IRelayCall, context: IRpcContext): ITraySender {
    this.#sender(context)
    return this.#send(this.#registry.receipt(input.host, input.id, input.receipt))
  }

  /** Construct the original own methods independently for every genuine Feature activation. */
  #feature() {
    return {
      bind: (input: { host: string; id: string }, context: IRpcContext) => {
        this.#sender(context)
        return this.#registry.bind(input.host, input.id)
      },
      call: (input: IRelayCall, context: IRpcContext) =>
        this.#target(input, context).request(input, {
          signal: context.signal,
          timeoutMs: context.timeoutMs
        }),
      notify: (input: IRelayCall, context: IRpcContext) =>
        this.#target(input, context).notify(input, {
          signal: context.signal,
          timeoutMs: context.timeoutMs
        }),
      stream: (input: IRelayCall, context: IRpcContext) =>
        this.#target(input, context).stream(input, {
          signal: context.signal,
          timeoutMs: context.timeoutMs
        }),
      /** Only portable routing data crosses the relay; options come from provider context. */
      routed: (
        input: {
          host: string
          policy: string
          kind: TrayCallKind
          path: string
          payload?: unknown
        },
        context: IRpcContext
      ) => {
        this.#assertActive()
        this.#sender(context)
        if (!this.#hosts.has(input.host)) throw createTrayError(TrayErrorCode.hostUnknown)
        /** Candidate selection remains parent-owned and happens exactly once per relay call. */
        const record = this.#routing.pick(input.host, input.policy)
        /** Signal and remaining deadline belong to provider context rather than portable data. */
        const options = { signal: context.signal, timeoutMs: context.timeoutMs }
        if (input.kind === TrayCallKind.request)
          return this.#registry.sendCounted(record, TrayCallKind.request, input, options)
        if (input.kind === TrayCallKind.notify)
          return this.#registry.sendCounted(record, TrayCallKind.notify, input, options)
        return this.#registry.sendCounted(record, TrayCallKind.stream, input, options)
      },
      /** Authenticated metadata is attached only by the parent topic owner. */
      publish: (input: { topic: string; payload?: unknown }, context: IRpcContext) => {
        this.#assertActive()
        this.#topics.publishChild(input, context)
      },
      /** First and last child listeners share one generation-bound parent membership. */
      subscribe: (input: { topic: string }, context: IRpcContext) => {
        this.#assertActive()
        this.#topics.register(input.topic, context)
      },
      unsubscribe: (input: { topic: string }, context: IRpcContext) =>
        this.#topics.unregister(input.topic, context)
    }
  }
}
