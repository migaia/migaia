import assert from 'node:assert/strict'
import { createRpcHost } from '@migaia/rpc-host'
import { processPlugin } from '@migaia/rpc-plugin-process'
import { threadPlugin } from '@migaia/rpc-plugin-thread'

/** This fixture executes within an actual runtime; a Node host cannot grant its PASS. */
const deno = typeof Deno !== 'undefined'
/** Each owned process/Worker path exercises the public transport plugin of the actual runtime. */
const mode = deno ? Deno.args[0] : process.argv[2]
/** Peer name the parent assigns to its child; the child adopts it from its bootstrap. */
const childName = 'cross-runtime-child'
/** Reverse calls must reach a separately counted provider on the actual parent host. */
let reverseCalls = 0
/** Only a successfully constructed host is closed. */
let host
try {
  /** The child transport selected by mode; both spawn through the runtime's own launcher. */
  const child =
    mode === 'thread'
      ? threadPlugin({
          name: childName,
          spawn: { entry: new URL('./automatic-web-worker.mjs', import.meta.url) }
        })
      : processPlugin({
          name: childName,
          spawn: { entry: new URL('./automatic-process.mjs', import.meta.url) }
        })
  host = await createRpcHost({
    self: { name: 'parent', instanceId: 'cross-runtime-parent' },
    plugins: [child],
    provide: {
      parentEcho: () => {
        reverseCalls += 1
        return host.self.instanceId
      }
    },
    report: () => undefined
  })
  /** The namespace of the selected child transport. */
  const namespace = mode === 'thread' ? host.thread : host.process
  /** Forward call into the child, which itself calls back into the parent once. */
  const result = await namespace.send(childName, 'probe', 'actual-runtime-ready')
  assert.equal(
    result.value,
    'actual-runtime-ready',
    'forward business ran in the actual platform child'
  )
  assert.equal(result.self.name, childName, 'child identity is the name its parent assigned')
  assert.equal(typeof result.self.instanceId, 'string', 'child has its own instance id')
  assert.notEqual(result.self.instanceId, host.self.instanceId, 'child identity is distinct')
  assert.equal(
    result.parent,
    'cross-runtime-parent',
    'actual child reverse request returns parent business'
  )
  assert.equal(reverseCalls, 1, 'exactly one genuine reverse dispatch executed')
  console.log(
    JSON.stringify({
      runtime: deno ? 'deno' : 'bun',
      mode,
      forwardCalls: 1,
      reverseCalls,
      identityMatched: true
    })
  )
} finally {
  await host?.close()
}
if (deno) Deno.exit(0)
else process.exit(0)
