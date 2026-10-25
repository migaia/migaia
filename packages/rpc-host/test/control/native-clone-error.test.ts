/** Original Core clone-error vectors exercise genuine native constructors without a Host payload. */
import { MessageChannel, type MessagePort } from 'node:worker_threads'
import { expect, it } from 'vitest'
import type { IRpcCarrier } from '@migaia/rpc-contract/interfaces'
import {
  createNodeThreadCarrier,
  createWebThreadCarrier
} from '../../../rpc-plugin-thread/dist/threads/channel.js'
import { createDedicatedWorkerCarrier } from '../../../rpc-plugin-browser/dist/browser/adapters/dedicated-worker.js'

/** Each original builder row selects an existing production constructor over the same native port. */
type INativeCloneSource = Readonly<{
  legacyFactory: string
  create(port: MessagePort, report: (error: unknown) => void): IRpcCarrier
}>

/** These three fixed rows preserve the original browser-port, Node-port and Worker source matrix. */
const nativeCloneSources: readonly INativeCloneSource[] = [
  {
    legacyFactory: 'createBrowserMessagePortTransport',
    create: (port, report) => createWebThreadCarrier(port, 'clone-web-port', report)
  },
  {
    legacyFactory: 'createNodeMessagePortTransport',
    create: (port, report) => createNodeThreadCarrier(port, 'clone-node-port', report)
  },
  {
    legacyFactory: 'createWebWorkerTransport',
    create: (port, report) => createDedicatedWorkerCarrier(port, { report })
  }
]

// RPC-TEST-00776736DCA7-C003: only removed synchronous send/builder placement changes under BC3.
it.each(nativeCloneSources)(
  'codes native clone rejection from $legacyFactory without changing its DOMException family',
  async ({ create }) => {
    /** The unchanged real native resource rejects structured cloning itself for every source row. */
    const pair = new MessageChannel()
    /** Original native diagnostics are retained without replacing the returned physical failure. */
    const reports: unknown[] = []
    /** No test-side postMessage implementation or serializer participates in this construction. */
    const carrier = create(pair.port1, (error) => reports.push(error))
    try {
      /** Carrier frames contain physical values; no semantic Host/portable admission sees this data. */
      const uncloneable = () => undefined
      /** The actual native DOMException is returned through the existing carrier write completion. */
      let failure: unknown
      try {
        await carrier.write({ kind: 'message', data: uncloneable })
      } catch (error) {
        failure = error
      }
      expect(failure).toBeInstanceOf(DOMException)
      expect(failure).toMatchObject({
        name: 'DataCloneError',
        source: 'rpc.endpoint',
        code: 'TRANSPORT'
      })
      expect((failure as Error).stack).toBeTruthy()
    } finally {
      try {
        await carrier.close()
      } finally {
        pair.port1.close()
        pair.port2.close()
      }
    }
  }
)
