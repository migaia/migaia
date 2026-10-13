import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createRemote } from '../remote.js'
import { readHost } from '../define-host.js'
import { TrayInternal } from '../constants.js'
import type { ITrayRuntimeOutlet } from '../runtime.js'
import type { IAnyTrayHost, ITrayInstanceInfo, ITrayClientPlugin } from '../typing.js'
/** Every init owns a new Feature definition and binds calls to that child's accepted outlet. */
export function createTrayPlugin(
  outlet: () => ITrayRuntimeOutlet,
  info: ITrayInstanceInfo<string, unknown>,
  exit: (error?: unknown) => void
): ITrayClientPlugin<any> {
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
          exit
        })
      )
    },
    install: () => ({})
  }) as ITrayClientPlugin<any>
}
