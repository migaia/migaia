import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createNodeThreadLauncher } from '../../dist/threads/adapters/node.js'
import { createNodeThreadChannel } from '../../dist/threads/channel.js'
import { createNodeProcessLauncher } from '../../dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../dist/process/handshake.js'
import { createNativeProcessOffer } from '../../dist/process/offer.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { nativeEndpoint } from './native-runtime.mjs'

/**
 * Launches a real owned process or Worker, then negotiates its canonical channel and core.
 *
 * @param {'process' | 'worker'} mode Supported physical native path.
 * @param {object} [options] Endpoint options plus required-handshake selector.
 * @returns {Promise<object>} Fixture session whose close releases only its own native resource.
 * @throws {Error} Original launcher, handshake or endpoint construction failure.
 */
export async function nativeSession(mode, options = {}) {
  const entry = options.entry ?? fileURLToPath(new URL('./native-peer.mjs', import.meta.url))
  const directory = await mkdtemp(resolve('docs/rpc/scratch/rpc-impl-2026-10-03/native-ready-'))
  const config = {
    required: options.required === true,
    ready: join(directory, 'peer.json'),
    diagnostic: options.diagnostic === true,
    controlledClock: options.controlledClock === true,
    keepAlive: options.keepAlive === true,
    retired: join(directory, 'retired.json'),
    ...(options.telemetry ? { telemetry: options.telemetry } : {}),
    ...(process.env.RPC_REPLAY_MUTANT ? { mutant: process.env.RPC_REPLAY_MUTANT } : {})
  }
  const signal = new AbortController().signal
  const diagnostics = []
  let handle
  let channel
  try {
    if (mode === 'worker') {
      handle = await createNodeThreadLauncher().launch({ entry, data: config }, { signal })
      channel = createNodeThreadChannel(handle.port, 'peer', { scheduler: systemScheduler })
    } else {
      handle = await createNodeProcessLauncher().launch(
        {
          command: process.execPath,
          args: [...process.execArgv, entry],
          env: { inherit: ['PATH'], set: {} },
          stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
          bootstrap: { via: 'stdin', payload: new TextEncoder().encode(JSON.stringify(config)) }
        },
        {
          signal,
          output: (stream, chunk) =>
            diagnostics.push({ stream, message: new TextDecoder().decode(chunk) })
        }
      )
      channel = await createProcessTransport(handle.channel, {
        role: 'initiator',
        peerId: 'peer',
        offer: createNativeProcessOffer({
          peer: { id: 'parent', runtime: 'node' },
          stream: true,
          ...(config.required ? { auth: 'replay-r12-public-token' } : {})
        }),
        ipc: { connectionId: 'r12-parent', sessionId: 'r12-parent', log: () => undefined },
        report: (error) => diagnostics.push({ message: String(error) })
      })
    }
    const {
      required: _required,
      capture: _capture,
      diagnostic: _diagnostic,
      controlledClock: _clock,
      keepAlive: _keepAlive,
      telemetry: _telemetry,
      entry: _entry,
      ...endpointOptions
    } = options
    /** Passive capture wraps the owned physical write, leaving the frozen final transport exact. */
    const captures = []
    if (options.capture) {
      if (mode === 'worker') {
        const post = handle.port.postMessage
        handle.port.postMessage = (value, transfer) => {
          captures.push(structuredClone(value))
          return post(value, transfer)
        }
      } else {
        const write = handle.channel.write
        handle.channel.write = (value) => {
          captures.push(value.slice())
          return write(value)
        }
      }
    }
    const runtime = await nativeEndpoint(channel, 'parent', endpointOptions)
    let peerReady
    for (let attempt = 0; attempt < 500; attempt++) {
      try {
        peerReady = JSON.parse(await readFile(config.ready, 'utf8'))
        break
      } catch (error) {
        if (error.code !== 'ENOENT' || attempt === 499) throw error
        await delay(10)
      }
    }
    await runtime.endpoint.send('peer', 'echo', 'ready', { timeoutMs: 5000 })
    return {
      ...runtime,
      channel,
      handle,
      diagnostics,
      peerReady,
      fixturePaths: { ready: config.ready, retired: config.retired },
      captures,
      replay: (value) =>
        mode === 'worker' ? handle.port.postMessage(value) : handle.channel.write(value),
      async close() {
        try {
          await runtime.endpoint.dispose()
          await channel.close()
        } finally {
          handle.terminate(mode === 'process' ? 'force' : undefined)
          await handle.exited
        }
      }
    }
  } catch (error) {
    process.stderr.write(
      JSON.stringify({ stage: 'native-fixture-failed', mode, diagnostics }) + '\n'
    )
    if (channel) await channel.close()
    if (handle) {
      handle.terminate(mode === 'process' ? 'force' : undefined)
      await handle.exited
    }
    throw error
  }
}
