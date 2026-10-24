import { fileURLToPath } from 'node:url'
import { mkdtemp, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { createNodeThreadLauncher } from '../../../rpc-plugin-thread/dist/threads/adapters/node.js'
import { createNodeThreadChannel } from '../../../rpc-plugin-thread/dist/threads/channel.js'
import { createNodeProcessLauncher } from '../../../rpc-plugin-process/dist/process/adapters/node-child-process.js'
import { createProcessTransport } from '../../../rpc-plugin-process/dist/process/handshake.js'
import { createNativeProcessOffer } from '../../../rpc-plugin-process/dist/process/offer.js'
import { systemScheduler } from '@migaia/utils/scheduler'
import { nativeEndpoint } from '../../../rpc-host/test/replay-window/native-runtime.mjs'

/**
 * Launches a real owned process or Worker, then negotiates its canonical channel and core.
 *
 * @param {'process' | 'worker'} mode Supported physical native path.
 * @param {object} [options] Endpoint options plus required-handshake selector.
 * @returns {Promise<object>} Fixture session whose close releases only its own native resource.
 * @throws {Error} Original launcher, handshake or endpoint construction failure.
 */
/** @typedef {ReturnType<typeof nativeState>} INativeState */
/**
 * @param {'process' | 'worker'} mode Physical path. @param {object} options Original fixture
 *   controls. @param {string} directory Owned ready-receipt directory. @returns {object} Explicit
 *   native preparation context.
 */
function nativeState(mode, options, directory) {
  return {
    mode,
    options,
    entry: options.entry ?? fileURLToPath(new URL('./native-peer.mjs', import.meta.url)),
    config: {
      required: options.required === true,
      ready: join(directory, 'peer.json'),
      diagnostic: options.diagnostic === true,
      controlledClock: options.controlledClock === true,
      keepAlive: options.keepAlive === true,
      retired: join(directory, 'retired.json'),
      ...(options.telemetry ? { telemetry: options.telemetry } : {}),
      ...(process.env.RPC_REPLAY_MUTANT ? { mutant: process.env.RPC_REPLAY_MUTANT } : {})
    },
    signal: new AbortController().signal,
    diagnostics: [],
    captures: [],
    handle: undefined,
    channel: undefined,
    runtime: undefined,
    peerReady: undefined
  }
}
/**
 * @param {INativeState} state Original native source and negotiation inputs. @returns
 *   {Promise<void>}
 */
async function acquireNative(state) {
  if (state.mode === 'worker') {
    state.handle = await createNodeThreadLauncher().launch(
      { entry: state.entry, data: state.config },
      { signal: state.signal }
    )
    state.channel = createNodeThreadChannel(state.handle.port, 'peer', {
      scheduler: systemScheduler
    })
  } else {
    state.handle = await createNodeProcessLauncher().launch(
      {
        command: process.execPath,
        args: [...process.execArgv, state.entry],
        env: { inherit: ['PATH'], set: {} },
        stdio: { stdin: 'channel', stdout: 'channel', stderr: 'drain' },
        bootstrap: { via: 'stdin', payload: new TextEncoder().encode(JSON.stringify(state.config)) }
      },
      {
        signal: state.signal,
        output: (stream, chunk) =>
          state.diagnostics.push({ stream, message: new TextDecoder().decode(chunk) })
      }
    )
    state.channel = await createProcessTransport(state.handle.channel, {
      role: 'initiator',
      peerId: 'peer',
      offer: createNativeProcessOffer({
        peer: { id: 'parent', runtime: 'node' },
        stream: true,
        ...(state.config.required ? { auth: 'replay-r12-public-token' } : {})
      }),
      ipc: { connectionId: 'parent-1', sessionId: 'parent-1', log: () => undefined },
      report: (error) => state.diagnostics.push({ message: String(error) })
    })
  }
}
/** @param {INativeState} state Passive byte/message capture sink. @returns {void} */
function installNativeCapture(state) {
  if (state.options.capture) {
    if (state.mode === 'worker') {
      const post = state.handle.port.postMessage
      state.handle.port.postMessage = (value, transfer) => {
        state.captures.push(structuredClone(value))
        return post(value, transfer)
      }
    } else {
      const write = state.handle.channel.write
      state.handle.channel.write = (value) => {
        state.captures.push(value.slice())
        return write(value)
      }
    }
  }
}
/** @param {INativeState} state Original file-receipt readiness. @returns {Promise<void>} */
async function readNativeReady(state) {
  state.peerReady = undefined
  for (let attempt = 0; attempt < 500; attempt++) {
    try {
      state.peerReady = JSON.parse(await readFile(state.config.ready, 'utf8'))
      break
    } catch (error) {
      if (error.code !== 'ENOENT' || attempt === 499) throw error
      await delay(10)
    }
  }
}
/** @param {INativeState} state Original physical ownership graph. @returns {Promise<void>} */
async function closeNative(state) {
  try {
    await state.runtime.endpoint.dispose()
    await state.channel.close()
  } finally {
    state.handle.terminate(state.mode === 'process' ? 'force' : undefined)
    await state.handle.exited
  }
}
/**
 * Launch the original process or Worker and negotiate its canonical native endpoint.
 *
 * @param {'process' | 'worker'} mode Physical native path.
 * @param {object} [options] Existing endpoint and fixture options.
 * @returns {Promise<object>} Original native handles, passive observations and cleanup.
 * @throws {Error} Original launch/negotiation failure.
 */
export async function nativeSession(mode, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'rpc-native-ready-'))
  const state = nativeState(mode, options, directory)
  try {
    await acquireNative(state)
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
    installNativeCapture(state)
    state.runtime = await nativeEndpoint(state.channel, 'parent', endpointOptions)
    await readNativeReady(state)
    await state.runtime.endpoint.send('peer', 'echo', 'ready', { timeoutMs: 5000 })
    return {
      ...state.runtime,
      channel: state.channel,
      handle: state.handle,
      diagnostics: state.diagnostics,
      peerReady: state.peerReady,
      fixturePaths: { ready: state.config.ready, retired: state.config.retired },
      captures: state.captures,
      replay: (value) =>
        state.mode === 'worker'
          ? state.handle.port.postMessage(value)
          : state.handle.channel.write(value),
      close: () => closeNative(state)
    }
  } catch (error) {
    process.stderr.write(
      JSON.stringify({ stage: 'native-fixture-failed', mode, diagnostics: state.diagnostics }) +
        '\n'
    )
    if (state.channel) await state.channel.close()
    if (state.handle) {
      state.handle.terminate(mode === 'process' ? 'force' : undefined)
      await state.handle.exited
    }
    throw error
  }
}
