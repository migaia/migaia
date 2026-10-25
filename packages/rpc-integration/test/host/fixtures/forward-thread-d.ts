/** Actual final Worker d exposes render and records the real inbound message facts. */
import { workerData } from 'node:worker_threads'
import { createRpcHost, type IRpcHost } from '@migaia/rpc-host'
import { threadPlugin } from '@migaia/rpc-plugin-thread'
import {
  ForwardObservation,
  ForwardFixture,
  type IForwardFixtureOptions,
  type IForwardNodeSnapshot
} from './forward-observation.ts'

/** Fixture options are ordinary native recipe data, without Session or source authority. */
const configuration = workerData.data as IForwardFixtureOptions
/** The final node observes only when the test installs the real public plugins. */
const observations = configuration.observed ? new ForwardObservation() : undefined
/** Only execution of the actual final business callback increments this counter. */
let renderCalls = 0
/** Providers await the real original opening only for their explicit readiness/inspection calls. */
const opening: Promise<IRpcHost> = createRpcHost({
  plugins: [...(observations?.plugins ?? []), threadPlugin({ connectToParent: true })],
  provide: {
    /** A genuine value proves the call reached the last native Worker. */
    [ForwardFixture.render]: (value: number) => {
      renderCalls += 1
      return { rendered: value }
    },
    /** This actual provider is available only through d's accepted parent Session. */
    [ForwardFixture.ready]: async () => {
      await opening
      return true
    },
    /** The final business count is read on this same actual Host. */
    [ForwardFixture.inspect]: async (): Promise<IForwardNodeSnapshot> => ({
      selfId: (await opening).self.instanceId,
      renderCalls,
      ...(observations ? { observations: observations.snapshot() } : {})
    })
  }
})
await opening
