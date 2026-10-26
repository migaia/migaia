import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

/** This entire graph runs in the requested runtime, including its actual native child. */
const runtime = typeof Deno !== 'undefined' ? Deno.args[0] : process.argv[2]
/** The native final provider varies only its process versus Worker source. */
const mode = typeof Deno !== 'undefined' ? Deno.args[1] : process.argv[3]
/** Same-user local endpoint name; the operating system isolates it to this user. */
const address = 'relay-' + randomUUID()
/** All operational failures remain visible with their full package classification. */
const failures = []
/** Expected unsupported-termination notices from the runtime launcher, kept apart from failures. */
const notices = []
/** Report callback keeps redacted classification of every reported failure. */
const report = (error) => {
  /** Bun and Deno launchers cannot guarantee tree termination; this notice is expected. */
  if (error?.source === 'supervision' && error?.code === 'CAPABILITY_UNSUPPORTED') {
    notices.push(error.code)
    return
  }
  failures.push({
    source: error?.source,
    code: error?.code,
    name: error?.name,
    message: String(error?.message ?? '').slice(0, 160)
  })
}
/** Only hosts constructed by this fixture are closed in finally. */
let server, client
try {
  /** The final native provider c; the server reaches it through its own namespace. */
  const leaf =
    mode === 'thread'
      ? threadPlugin({
          name: 'c',
          spawn: { entry: new URL('./runtime-api-worker.mjs', import.meta.url) }
        })
      : processPlugin({
          namespace: 'child',
          name: 'c',
          spawn: { entry: new URL('./runtime-api-process.mjs', import.meta.url) }
        })
  server = await createRpcHost({
    self: { name: 'relay-server', instanceId: 'relay-server' },
    plugins: [leaf, processPlugin({ listen: address })],
    report
  })
  client = await createRpcHost({
    self: { name: 'client', instanceId: 'client-1' },
    provide: { reverse: () => 9 },
    plugins: [processPlugin({ connect: { target: address, timeoutMs: 5000 } })],
    report
  })
  /** Both payload levels cross client-to-server and the server-to-c forwarding hop. */
  const payload = { marker: 'one-hop', nested: { value: mode } }
  assert.equal(await client.process.request('c.binaryCount'), 0)
  /** Forwarded echo through the server to c. */
  const value = await client.process.request('c.echo', payload)
  assert.equal(value.marker, payload.marker)
  assert.equal(value.nested.value, mode)
  assert.equal(
    await client.process.request('c.binaryCount'),
    1,
    'final native business executes once through the forwarding hop'
  )
  assert.equal(
    await server.process.send('client', 'reverse'),
    9,
    'accepted listener connection preserves reverse business'
  )
  assert.deepEqual(failures, [])
  console.log(
    JSON.stringify({
      runtime,
      mode,
      cases: ['named-connect', 'named-listen', 'actual-native-one-hop', 'reverse'],
      effects: 1
    })
  )
} finally {
  await client?.close()
  await server?.close()
}
if (runtime === 'deno') Deno.exit(0)
else process.exit(0)
