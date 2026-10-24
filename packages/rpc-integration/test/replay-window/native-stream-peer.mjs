import { parentPort, workerData, threadId } from 'node:worker_threads'
import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs'
import { dirname, join } from 'node:path'
import '../../../rpc-plugin-thread/dist/threads/adapters/node.js'
import { readThreadBootstrap } from '../../../rpc-plugin-thread/dist/threads/bootstrap.js'
import { createNodeThreadChannel } from '../../../rpc-plugin-thread/dist/threads/channel.js'
import { openProcessStdioChannel } from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { RequestReplayLedger } from '../../../rpc-host/dist/core/internal/request-replay-ledger.js'
import { nativeEndpoint } from '../../../rpc-host/test/replay-window/native-runtime.mjs'
import { nativeFixtureAuthentication } from '../../../rpc-plugin-browser/test/replay-window/native-auth-fixture.mjs'
import { loadedModules } from '../../../rpc-plugin-browser/test/replay-window/native-loaded.mjs'
import { classifyProviderRejection } from '../../../rpc-host/test/replay-window/native-telemetry.mjs'

/** The native resource is registered by the same canonical deep adapters as production. */
let config, channel
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
    auth: { mode: 'none' },
    scheduler: systemScheduler,
    ipc: { connectionId: 'stream-peer', sessionId: 'stream-peer', log: () => undefined },
    report: (error) => process.stderr.write(String(error) + '\n')
  })
}
/** Mutation calls are retained only to establish that the red fixture reached stream admission. */
const mutations = []
/**
 * The explicit settled-stream mutant uses the previous admission-time legacy record for stream-open
 * only.
 */
if (config.mutant === 'stream-admission-time-tombstone') {
  const admit = RequestReplayLedger.prototype.admit
  RequestReplayLedger.prototype.admit = function (key, peer, now, mode, hold) {
    mutations.push({ now, mode, hold })
    return Reflect.apply(admit, this, [key, peer, now, hold ? false : mode, false])
  }
}
/** Only the supported scheduler clock advances; native timers and physical liveness remain real. */
let offset = 0
const scheduler = { ...systemScheduler, now: () => systemScheduler.now() + offset }
/** Independent pending next/return tasks make early stream Map deletion insufficient for release. */
let starts = 0,
  nextPending = false,
  returnPending = false,
  releaseNext,
  releaseReturn
const rejections = []
const commandFile = join(dirname(config.ready), 'stream-command.json')
const stateFile = join(dirname(config.ready), 'stream-state.json')
const auth = nativeFixtureAuthentication(parentPort ? 'any' : 'string')
const runtime = await nativeEndpoint(channel, 'peer', {
  scheduler,
  middlewares: [auth.plugin],
  providerLimits: {
    maxReplayEntriesPerPeer: 1,
    onRejected: (value) => rejections.push(classifyProviderRejection(value))
  }
})
/** The file is a functional-test observation only, never sampled during formal performance windows. */
const state = () => {
  writeFileSync(
    stateFile + '.next',
    JSON.stringify({
      pid: process.pid,
      threadId,
      starts,
      nextPending,
      returnPending,
      offset,
      rejections,
      mutations,
      qualified: runtime.receipt.qualified,
      active: runtime.receipt.active,
      providerState: runtime.snapshot()?.providerState
    })
  )
  renameSync(stateFile + '.next', stateFile)
}
runtime.endpoint.provide('echo', (context) => context.success(context.data))
runtime.endpoint.stream.provide('heldStream', () => {
  starts++
  const first = starts === 1
  state()
  return {
    [Symbol.asyncIterator]() {
      return this
    },
    next() {
      if (!first) return Promise.resolve({ done: true, value: undefined })
      nextPending = true
      state()
      return new Promise((resolve) => {
        releaseNext = () => {
          nextPending = false
          state()
          resolve({ done: true, value: undefined })
        }
      })
    },
    return() {
      if (!first) return Promise.resolve({ done: true, value: undefined })
      returnPending = true
      state()
      return new Promise((resolve) => {
        releaseReturn = () => {
          returnPending = false
          state()
          resolve({ done: true, value: undefined })
        }
      })
    }
  }
})
/** File commands release only owned fixture work and add an actual physical reader. */
let sequence = 0
setInterval(() => {
  if (!existsSync(commandFile)) return
  const command = JSON.parse(readFileSync(commandFile, 'utf8'))
  if (command.sequence === sequence) {
    state()
    return
  }
  sequence = command.sequence
  if (command.stage === 'lose-and-clock') {
    if (parentPort) parentPort.on('message', () => undefined)
    else process.stdin.on('data', () => undefined)
    offset += 310_001
  } else if (command.stage === 'next') releaseNext?.()
  else if (command.stage === 'return') releaseReturn?.()
  else if (command.stage === 'clock') offset += 310_001
  state()
}, 10).unref()
state()
writeFileSync(
  config.ready,
  JSON.stringify({
    pid: process.pid,
    threadId,
    qualified: runtime.receipt.qualified,
    loaded: loadedModules()
  }),
  { flag: 'wx' }
)
