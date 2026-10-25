/** Real Worker c borrows b's native parent and owns the last actual Worker d. */
import { workerData } from 'node:worker_threads'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import {
  ForwardObservation,
  ForwardFixture,
  type IForwardFixtureOptions,
  type IForwardNodeSnapshot
} from './forward-observation.ts'

/** Only the original recipe's application data is read; bootstrap relationship fields stay private. */
const configuration = workerData.data as IForwardFixtureOptions
/** Each real observing node owns its public probe and default-stage Devtools collector. */
const observations = configuration.observed ? new ForwardObservation() : undefined
/** The same actual opening Promise supplies the provider's installation barrier. */
const opening: Promise<IRpcHost> = createRpcHost({
  ...(configuration.cMaxHops === undefined ? {} : { forward: { maxHops: configuration.cMaxHops } }),
  plugins: [
    ...(observations?.plugins ?? []),
    threadPlugin({ namespace: 'parent', connectToParent: true }),
    threadPlugin({
      name: ForwardFixture.d,
      spawn: { entry: new URL('./forward-thread-d.ts', import.meta.url), data: configuration }
    })
  ],
  provide: {
    /** Installation and actual downstream readiness precede the caller's forwarding business. */
    [ForwardFixture.ready]: async () =>
      (await opening).thread.send(ForwardFixture.d, ForwardFixture.ready),
    /** Inspect only genuine public providers and copied borrowed observations. */
    [ForwardFixture.inspect]: async (): Promise<IForwardNodeSnapshot> => {
      /** The sole Host owns the parent and spawned Session, with namespace isolation. */
      const host = await opening
      return {
        selfId: host.self.instanceId,
        renderCalls: 0,
        ...(observations ? { observations: observations.snapshot() } : {}),
        child: (await host.thread.send(
          ForwardFixture.d,
          ForwardFixture.inspect
        )) as IForwardNodeSnapshot
      }
    }
  }
})
await opening
