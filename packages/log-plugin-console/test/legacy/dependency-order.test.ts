import { defineLogPlugin } from '@migaia/log-host/plugin'
import { expect, it } from 'vitest'
import { createLogHost, forwardPlugin } from '@migaia/log-host'
import { batchFeature, formatFeature } from '@migaia/log-host/features'
import { consolePlugin, prettyFeature } from '../../src/index.ts'
import { reasoningPlugin } from '../../../log-plugin-reasoning/src/index.ts'
import { httpPlugin } from '../../../log-plugin-http/src/index.ts'
import { MemoryConsole } from '../fixtures.ts'

/** Native reasoning text remains independent from console installation order. */
async function reasoningOrder(reverse: boolean): Promise<string[]> {
  /** Exact raw writes retain their byte boundaries while completed silent entries stay hidden. */
  const writes: string[] = []
  /** The console output is still installed so lost silence would create an extra native call. */
  const console = new MemoryConsole()
  /** Each order uses the same public console formatting and standalone writer contract. */
  const output = consolePlugin({
    console,
    features: { pretty: prettyFeature({ color: 'always' }) }
  })
  /** The phase controller no longer borrows console color capabilities. */
  const reasoning = reasoningPlugin({
    write: (text) => {
      writes.push(text)
    }
  })
  /** Typed tuple alternatives retain the same merged reasoning extension. */
  const host = reverse
    ? createLogHost({ plugins: [reasoning, output] })
    : createLogHost({ plugins: [output, reasoning] })
  host.startThinking('Plan')
  host.thinking('step')
  host.endThinking()
  await host.shutdown('manual')
  expect(console.logs).toEqual([])
  expect(writes.join('')).toContain('step')
  expect(writes.join('')).not.toContain('\u001b[')
  return writes
}

/** Host-scoped and output-scoped batching preserve the same original two-message envelope. */
async function batchScope(outputScope: boolean): Promise<string[][]> {
  /** Only real POST bodies are observed; there is no deleted provider feature seam. */
  const bodies: string[] = []
  /** One descriptor can be selected at either supported scope. */
  const batch = batchFeature({ maxSize: 2 })
  /** The production HTTP output owns one attempt and the host owns the batch. */
  const host = createLogHost({
    plugins: [
      defineLogPlugin({ name: 'policy', features: outputScope ? {} : { batch: batch } }),
      httpPlugin({
        url: 'memory-only',
        features: outputScope ? { batch: batch } : {},
        fetcher: async (_url, init) => {
          bodies.push(init.body)
          return new Response(null, { status: 200 })
        }
      })
    ]
  })
  host.log('info', 'one')
  host.log('info', 'two')
  await host.flush()
  await host.shutdown('manual')
  expect(bodies).toHaveLength(1)
  return bodies.map(messages)
}

/** Decode only business messages so generated timestamps and identifiers do not hide ordering. */
function messages(body: string): string[] {
  return JSON.parse(body).entries.map(message)
}

/** Keep the projected message in its original position. */
function message(entry: { message: string }): string {
  return entry.message
}

/** Preserve both legacy order comparisons through the approved independent ownership model. */
async function independentOrder(): Promise<void> {
  expect(await reasoningOrder(true)).toEqual(await reasoningOrder(false))
  expect(await batchScope(true)).toEqual(await batchScope(false))
  expect(await batchScope(true)).toEqual([['one', 'two']])
}
it('preserves reasoning installation order and both host batch scopes', independentOrder)

/** Structured forwarding exposes display topics without serializing private cycle authority. */
async function forwardedTopics(): Promise<void> {
  /** JSON text is observed only through the actual borrowed console. */
  const console = new MemoryConsole()
  /** Target topic extends the original path at the forwarding boundary. */
  const target = createLogHost({
    topic: 'audit',
    plugins: [
      defineLogPlugin({ name: 'policy', features: { format: formatFeature({ format: 'json' }) } }),
      consolePlugin({ console })
    ]
  })
  /** The public forward plugin replaces the removed extends facade operation. */
  const source = createLogHost({ topic: 'source', plugins: [forwardPlugin({ targets: [target] })] })
  source.log('info', 'forwarded')
  await source.flush()
  /** The host's canonical JSON shape keeps display topics inside ordinary entry data. */
  const entry = JSON.parse(String(console.logs[0][0]))
  expect(entry.data.topicChain).toEqual(['source', 'audit'])
  expect(entry).not.toHaveProperty('extendPath')
  expect(entry).not.toHaveProperty('forwardPath')
  await source.shutdown('manual')
  await target.shutdown('manual')
}
it('renders forwarded topic chains without exposing cycle bookkeeping', forwardedTopics)
