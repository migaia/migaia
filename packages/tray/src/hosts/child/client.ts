/** Child business calls use its one actual parent namespace and the original relay admission. */
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createRemote, createRoutedRemote, type ITrayInvocation } from '../remote.js'
import { readHost } from '../define-host.js'
import { TrayInternal, TrayCallKind } from '../constants.js'
import { createRoutingNamespace, builtInRouting } from '../routing.js'
import { rpcCallOptions, type ITrayRuntimeOutlet } from '../runtime.js'
import { toWire } from '../portable.js'
import type { IAnyTrayHost, ITrayInstanceInfo, ITrayClientPlugin } from '../typing.js'
import type { IChildTopics } from './topics.js'

/** One generation owns only its immutable client configuration; RPC owns physical work. */
class ChildTrayClient {
  /** Every call reads this generation's current genuine parent namespace. */
  readonly #outlet: () => ITrayRuntimeOutlet
  /** The original frozen generation metadata is returned without copying. */
  readonly #info: ITrayInstanceInfo<string, unknown>
  /** Feature construction returns one actual client object for this child generation. */
  readonly plugin: ITrayClientPlugin<any>

  /** Construct the original Feature once, without a separate connection or routing lifecycle. */
  constructor(
    outlet: () => ITrayRuntimeOutlet,
    info: ITrayInstanceInfo<string, unknown>,
    exit: (error?: unknown) => void,
    topics: IChildTopics,
    definition: IAnyTrayHost
  ) {
    this.#outlet = outlet
    this.#info = info
    /** Policy names come from the trusted definition; callbacks still execute only in the parent. */
    const names = [...builtInRouting, ...(definition.routing ?? [])].map((policy) => policy.name)
    /** The original public client contains no native handles or member-control authority. */
    const client = Object.freeze({
      self: () => this.#info,
      to: this.#to,
      exit,
      routing: createRoutingNamespace(names, this.#routed),
      publish: topics.publish,
      subscribe: topics.subscribe
    })
    this.plugin = definePlugin({
      name: TrayInternal.clientPlugin,
      features: { tray: defineFeature(() => client) },
      install: () => ({})
    }) as ITrayClientPlugin<any>
  }

  /** Relay selection stays parent-owned and per operation, with caller options kept off wire data. */
  readonly #routed = (policy: string, target: IAnyTrayHost) => {
    /** Branding is checked before constructing any callable remote. */
    const admitted = readHost(target)
    /** This immutable route is application metadata, never a native target binding. */
    const route = { host: admitted.name, policy }
    return createRoutedRemote(admitted.name, {
      request: (input, options) =>
        this.#outlet().request(
          TrayInternal.routed,
          toWire({ ...route, kind: TrayCallKind.request, ...input }),
          rpcCallOptions(options)
        ),
      notify: async (input, options) => {
        await this.#outlet().request(
          TrayInternal.routed,
          toWire({ ...route, kind: TrayCallKind.notify, ...input }),
          rpcCallOptions(options)
        )
      },
      stream: (input, options) =>
        this.#outlet().stream(
          TrayInternal.routed,
          toWire({ ...route, kind: TrayCallKind.stream, ...input }),
          rpcCallOptions(options)
        ) as AsyncIterableIterator<unknown>
    })
  }

  /** The parent issues one original admission receipt before a child can retain a direct remote. */
  readonly #to = async (host: IAnyTrayHost, id: string) => {
    /** Only this shared realm's branded host definitions are admitted. */
    const admitted = readHost(host)
    /** The actual parent provider returns the original opaque admission token. */
    const receipt = (await this.#outlet().request(TrayInternal.bind, {
      host: admitted.name,
      id
    })) as string
    /** Native replacement does not replace this target's original registry admission receipt. */
    const target = { host: admitted.name, id, receipt }
    return createRemote(id, {
      request: (input, options) =>
        this.#outlet().request(
          TrayInternal.call,
          toWire({ ...target, ...input }),
          rpcCallOptions(options)
        ),
      notify: async (input, options) => {
        await this.#outlet().notify(
          TrayInternal.notify,
          toWire({ ...target, ...input }),
          rpcCallOptions(options)
        )
      },
      stream: (input: ITrayInvocation, options) =>
        this.#outlet().stream(
          TrayInternal.relayStream,
          toWire({ ...target, ...input }),
          rpcCallOptions(options)
        ) as AsyncIterableIterator<unknown>
    })
  }
}

/** Every init binds the original client Feature to one genuine child-to-parent namespace. */
export function createTrayPlugin(
  outlet: () => ITrayRuntimeOutlet,
  info: ITrayInstanceInfo<string, unknown>,
  exit: (error?: unknown) => void,
  topics: IChildTopics,
  definition: IAnyTrayHost
): ITrayClientPlugin<any> {
  return new ChildTrayClient(outlet, info, exit, topics, definition).plugin
}
