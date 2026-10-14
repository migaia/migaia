import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createRemote, createRoutedRemote } from '../remote.js'
import { readHost } from '../define-host.js'
import { TrayInternal, TrayCallKind } from '../constants.js'
import { createRoutingNamespace, builtInRouting } from '../routing.js'
import type { ITrayRuntimeOutlet } from '../runtime.js'
import type { IAnyTrayHost, ITrayInstanceInfo, ITrayClientPlugin } from '../typing.js'
import type { IChildTopics } from './topics.js'
/** Every init owns a new Feature definition and binds calls to that child's accepted outlet. */
export function createTrayPlugin(
  outlet: () => ITrayRuntimeOutlet,
  info: ITrayInstanceInfo<string, unknown>,
  exit: (error?: unknown) => void,
  topics: IChildTopics,
  definition: IAnyTrayHost
): ITrayClientPlugin<any> {
  /** Child declaration grants names only; the callback remains unused in this realm. */
  const names = [...builtInRouting, ...(definition.routing ?? [])].map((policy) => policy.name)
  /** Options apply to the caller's RPC operation and never become portable envelope fields. */
  const routing = createRoutingNamespace(names, (policy, target) => {
    const admitted = readHost(target)
    const envelope = (kind: TrayCallKind, input: { path: string; payload?: unknown }) => ({
      host: admitted.name,
      policy,
      kind,
      ...input
    })
    return createRoutedRemote(admitted.name, {
      request: (input, options) =>
        outlet().request(
          TrayInternal.connection,
          TrayInternal.routed,
          envelope(TrayCallKind.request, input),
          options
        ),
      notify: async (input, options) => {
        await outlet().request(
          TrayInternal.connection,
          TrayInternal.routed,
          envelope(TrayCallKind.notify, input),
          options
        )
      },
      stream: (input, options) =>
        outlet().stream(
          TrayInternal.connection,
          TrayInternal.routed,
          envelope(TrayCallKind.stream, input),
          options
        )
    })
  })
  return definePlugin({
    name: TrayInternal.clientPlugin,
    features: {
      tray: defineFeature(() =>
        Object.freeze({
          self: () => info,
          to: async (host: IAnyTrayHost, id: string) => {
            /** The parent issues one opaque receipt for the target's current admission. */
            const admitted = readHost(host)
            const receipt = (await outlet().request(TrayInternal.connection, TrayInternal.bind, {
              host: admitted.name,
              id
            })) as string
            /** Calls carry the receipt even after a same-id replacement of the registry admission. */
            const envelope = (payload: { path: string; payload?: unknown }) => ({
              host: admitted.name,
              id,
              receipt,
              ...payload
            })
            return createRemote(id, {
              request: (payload, options) =>
                outlet().request(
                  TrayInternal.connection,
                  TrayInternal.call,
                  envelope(payload),
                  options
                ),
              notify: (payload, options) =>
                outlet().notify(
                  TrayInternal.connection,
                  TrayInternal.notify,
                  envelope(payload),
                  options
                ),
              stream: (payload, options) =>
                outlet().stream(
                  TrayInternal.connection,
                  TrayInternal.relayStream,
                  envelope(payload),
                  options
                )
            })
          },
          exit,
          routing,
          publish: topics.publish,
          subscribe: topics.subscribe
        })
      )
    },
    install: () => ({})
  }) as ITrayClientPlugin<any>
}
