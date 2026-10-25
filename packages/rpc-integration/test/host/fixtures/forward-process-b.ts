/** Real process b receives a's native parent and owns the next actual Worker c. */
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import {
  ForwardObservation,
  ForwardFixture,
  type IForwardFixtureOptions,
  type IForwardNodeSnapshot
} from './forward-observation.ts'

/** This is ordinary test application data passed by the original native Process recipe. */
const configuration = JSON.parse(process.argv[2]!) as IForwardFixtureOptions
/** Silent mode installs no probe or Devtools plugin on the actual forwarding nodes. */
const observations = configuration.observed ? new ForwardObservation() : undefined
/** Opening is the actual Host's installation Promise, not an independently synthesized readiness. */
const opening: Promise<IRpcHost> = createRpcHost({
  plugins: [
    ...(observations?.plugins ?? []),
    processPlugin({ connectToParent: true }),
    threadPlugin({
      name: ForwardFixture.c,
      spawn: { entry: new URL('./forward-thread-c.ts', import.meta.url), data: configuration }
    })
  ],
  provide: {
    /** Wait for actual child installation through its already-public provider entry. */
    [ForwardFixture.ready]: async () =>
      (await opening).thread.send(ForwardFixture.c, ForwardFixture.ready),
    /** Public inspection reads genuine child state through the exact accepted Worker connection. */
    [ForwardFixture.inspect]: async (): Promise<IForwardNodeSnapshot> => {
      /** The one original Host owns identity and both actual native sources. */
      const host = await opening
      return {
        selfId: host.self.instanceId,
        renderCalls: 0,
        ...(observations ? { observations: observations.snapshot() } : {}),
        child: (await host.thread.send(
          ForwardFixture.c,
          ForwardFixture.inspect
        )) as IForwardNodeSnapshot
      }
    }
  }
})
await opening
