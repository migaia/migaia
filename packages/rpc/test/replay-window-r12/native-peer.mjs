import { parentPort, workerData, threadId } from 'node:worker_threads'
import { writeFile, rename } from 'node:fs/promises'
import { writeFileSync, appendFileSync } from 'node:fs'
import '../../dist/threads/adapters/node.js'
import { createNodeThreadChannel } from '../../dist/threads/channel.js'
import { readThreadBootstrap } from '../../dist/threads/index.js'
import { openProcessStdioChannel } from '../../dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../dist/process/offer.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { nativeEndpoint } from './native-runtime.mjs'
import { NativeReplayReceipt } from '../../dist/core/internal/native-replay.js'
import { loadedModules } from './native-loaded.mjs'
import { classifyFailure, classifyProviderRejection, nativeSample } from './native-telemetry.mjs'

/** Physical adapters, rather than fixture fields, register the owned replay resource. */
let channel
/** Public fixture data contains no credential; required-auth comparisons use one fixed test token. */
let config
if (parentPort) {
  config = readThreadBootstrap(workerData).data
  channel = createNodeThreadChannel(parentPort, 'parent', { scheduler: systemScheduler })
} else {
  const opened = await openProcessStdioChannel({ bootstrap: 'stdin' })
  config = JSON.parse(new TextDecoder().decode(opened.bootstrap))
  channel = await createProcessTransport(opened.channel, {
    role: 'responder',
    peerId: 'parent',
    offer: createNativeProcessOffer({ peer: { id: 'peer', runtime: 'node' }, stream: true }),
    auth: config.required
      ? {
          mode: 'required',
          verify: (actual) => {
            if (actual !== 'replay-r12-public-token') throw new Error('fixture auth mismatch')
          }
        }
      : { mode: 'none' },
    scheduler: systemScheduler,
    ipc: { connectionId: 'r12-peer', sessionId: 'r12-peer', log: () => undefined },
    report: (error) => process.stderr.write(String(error) + '\n')
  })
}
/** Isolated peer-only mutant removes the exact settlement/receive observation under examination. */
if (config.mutant === 'missing-owner-checkpoint')
  NativeReplayReceipt.prototype.observeOwner = () => undefined
/** The original classes are instrumented only in a separate E2 diagnostic session. */
const counters = config.diagnostic ? await import('./native-counters.mjs') : undefined
/** A supported scheduler seam advances identity age while physical timers keep their real deadlines. */
let clockOffset = 0
const controlledScheduler = { ...systemScheduler, now: () => systemScheduler.now() + clockOffset }
/** Provider concurrency is measured at actual callback entry, separately from client in-flight. */
let active = 0
/** Peak is cumulative across the measurement window and reset only explicitly by the caller. */
let peak = 0
/** Business callback count excludes diagnostic calls to stats. */
let calls = 0
/** Holds exactly one real provider operation for native duplicate and downgrade evidence. */
let releaseHold
/** Counts actual callback entry independently of client send or diagnostic request counts. */
let heldCalls = 0
/** Observes the real endpoint's ledger and physical receipt without adding a production API. */
const runtime = await nativeEndpoint(channel, 'peer', {
  ...(config.controlledClock ? { scheduler: controlledScheduler } : {}),
  collectDiagnostics: !config.telemetry,
  providerLimits: {
    onRejected: (value) => {
      if (config.telemetry)
        appendFileSync(
          config.telemetry,
          JSON.stringify({
            kind: 'rejection',
            UTC: new Date().toISOString(),
            ...classifyProviderRejection(value)
          }) + '\n'
        )
    }
  },
  onFailure: (event) => {
    const value = {
      kind: 'failure',
      UTC: new Date().toISOString(),
      ...classifyFailure(event.error, event.detail?.reason)
    }
    if (config.telemetry) appendFileSync(config.telemetry, JSON.stringify(value) + '\n')
    else process.stderr.write(JSON.stringify(value) + '\n')
  }
})
/** Periodic peer-isolate observations use their own file, not diagnostic RPC calls during timing. */
if (config.telemetry) {
  const sample = () =>
    appendFileSync(
      config.telemetry,
      JSON.stringify({
        kind: 'sample',
        ...nativeSample(runtime),
        provider: { active, peak, calls }
      }) + '\n'
    )
  sample()
  setInterval(sample, 1000).unref()
}
/** A local physical-close fixture holds the actual peer VM alive independently of its RPC channel. */
if (config.keepAlive) setInterval(() => undefined, 1000)
/** An actual receipt retirement records state without asking a closed channel for another response. */
if (config.controlledClock || config.keepAlive)
  runtime.receipt.onRetire(() =>
    writeFileSync(
      config.retired,
      JSON.stringify({
        heldCalls,
        qualified: runtime.receipt.qualified,
        active: runtime.receipt.active,
        snapshot: runtime.snapshot()
      }),
      { flag: 'wx' }
    )
  )
runtime.endpoint.provide('echo', async (context) => {
  active += 1
  peak = Math.max(peak, active)
  calls += 1
  try {
    await Promise.resolve()
    return context.success(context.data)
  } finally {
    active -= 1
  }
})
runtime.endpoint.provide('hold', (context) => {
  heldCalls += 1
  return new Promise((resolve) => {
    releaseHold = () => resolve(context.success('held-result'))
  })
})
runtime.endpoint.provide('releaseHold', (context) => {
  releaseHold?.()
  return context.success('released')
})
/** Physical VM exit, rather than endpoint disposal, supplies the native terminal-first oracle. */
runtime.endpoint.provide('naturalExit', (context) => {
  setImmediate(() => process.exit(0))
  return context.success('exiting')
})
/** Close the actual child MessagePort while the independent fixture timer keeps its VM alive. */
runtime.endpoint.provide('closeLocalPort', (context) => {
  if (parentPort) setImmediate(() => parentPort.close())
  return context.success('closing-local-port')
})
/** Move only the injected monotonic identity clock across its unchanged 30,000,000ms hard limit. */
runtime.endpoint.provide('advanceBindingClock', (context) => {
  clockOffset += 30_000_001
  return context.success(clockOffset)
})
/** A reverse request proves the peer's outbound allocator and parent's provider ledger execute. */
runtime.endpoint.provide('reverseRequest', async (context) =>
  context.success(await runtime.endpoint.send('parent', 'reverse', context.data))
)
runtime.endpoint.provide('loseExclusivity', (context) => {
  /** A real second native listener triggers the explicit observation checkpoint on settlement. */
  if (parentPort) parentPort.on('message', () => undefined)
  else process.stdin.on('data', () => undefined)
  return context.success('listener-added')
})
/** Lose the real reader exclusivity and settle held work before any later physical input. */
runtime.endpoint.provide('loseAndRelease', (context) => {
  if (parentPort) parentPort.on('message', () => undefined)
  else process.stdin.on('data', () => undefined)
  releaseHold?.()
  return context.success('lost-and-released')
})
/** Diagnostic snapshots omit undefined optional fields; business echo never runs this conversion. */
runtime.endpoint.provide('stats', (context) =>
  context.success(
    JSON.parse(
      JSON.stringify({
        pid: process.pid,
        threadId,
        active,
        peak,
        calls,
        heldCalls,
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        threadCpu: process.threadCpuUsage?.(),
        snapshot: runtime.snapshot(),
        qualified: runtime.receipt?.qualified,
        physicalActive: runtime.receipt?.active,
        providerState: runtime.snapshot()?.providerState,
        counters: counters?.executionCounters(),
        rejections: runtime.rejections.map((value) => ({ ...value, request: undefined })),
        failures: runtime.failures.map((value) => ({
          name: value.error?.name,
          source: value.error?.source,
          code: value.error?.code,
          message: value.error?.message
        }))
      })
    )
  )
)
await writeFile(
  config.ready + '.next',
  JSON.stringify({
    pid: process.pid,
    threadId,
    qualified: runtime.receipt?.qualified,
    loaded: loadedModules()
  }),
  { flag: 'wx' }
)
await rename(config.ready + '.next', config.ready)
