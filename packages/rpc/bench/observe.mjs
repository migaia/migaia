import { createHash } from 'node:crypto'
import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { parentPort, workerData, threadId } from 'node:worker_threads'
import { performance } from 'node:perf_hooks'
import { IpcBenchControl } from './text.mjs'

/** Deno exposes Node compatibility zeroes for ELU/threadId, rather than native observations. */
const deno = typeof Deno !== 'undefined'
/** Physical Worker entry has a global messaging port; stdio children retain their real argv. */
const isolateRole =
  parentPort || (deno && typeof globalThis.postMessage === 'function')
    ? 'worker'
    : process.argv.includes('--child')
      ? 'peer'
      : 'parent'
/** Actual loaded dist bytes are retained per isolate; formal execution never applies an overlay. */
const loaded = []
/** Each child owns its out-of-band snapshot sequence, outside measured exchanges. */
let sequence = 0
/** Snapshot files belong to the selected side's serial measurement window. */
const stem = workerData?.benchStem ?? workerData?.data?.benchStem ?? process.env.IPC_BENCH_STEM
/** Genuine runtime launchers keep portable data separate from the transferred observation port. */
let observationReady = Promise.resolve()

/**
 * Join cold observation-port transfer before installing the real automatic Worker endpoint.
 *
 * @returns {Promise<void>} The separate port is ready; no RPC message or timing counter is added.
 */
export function waitForObservation() {
  return observationReady
}

/**
 * Record exactly the loader-supplied module bytes, without changing their runtime contents.
 *
 * @param {string} path Actual resolved dist path.
 * @param {string} source Source returned by the loader.
 * @returns {string} Original source, byte for byte.
 */
function observe(path, source) {
  /** Runtime and disk digests remain distinct fields even when both match. */
  const actualSHA256 = createHash('sha256').update(source).digest('hex')
  loaded.push({
    path,
    loadedSHA256: actualSHA256,
    diskSHA256: createHash('sha256').update(readFileSync(path)).digest('hex'),
    pid: process.pid,
    threadId: deno ? null : threadId,
    isolateRole,
    diagnosticOverlay: false
  })
  return source
}

if (process.versions.bun) {
  Bun.plugin({
    name: 'ipc-bench-loaded-dist',
    setup(build) {
      build.onLoad({ filter: /\/dist\/.*\.js$/ }, (args) => ({
        contents: observe(args.path, readFileSync(args.path, 'utf8')),
        loader: 'js'
      }))
    }
  })
} else {
  /** Synchronous loader observations complete before a measured endpoint is constructed. */
  const { registerHooks } = await import('node:module')
  registerHooks({
    load(url, context, nextLoad) {
      /** Loader failures keep their original error rather than producing a partial SHA row. */
      const result = nextLoad(url, context)
      if (url.startsWith('file:') && url.includes('/dist/') && result.source != null)
        return {
          ...result,
          source: observe(
            new URL(url).pathname,
            typeof result.source === 'string'
              ? result.source
              : Buffer.from(result.source).toString()
          )
        }
      return result
    }
  })
}

/**
 * Capture the current isolate at a boundary outside timing; GC remains explicitly uncollected.
 *
 * @returns {object} Actual process/thread CPU, ELU, heap and loaded module provenance.
 */
export function snapshot() {
  return {
    pid: process.pid,
    threadId: deno ? null : threadId,
    isolateRole,
    threadCpu: typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : null,
    threadCpuSemantics: process.versions.bun ? 'UNVERIFIED_BUN_API' : 'native threadCpuUsage',
    elu: deno ? null : performance.eventLoopUtilization(),
    eluStatus: deno ? 'UNAVAILABLE_DENO_NODE_COMPATIBILITY' : 'native eventLoopUtilization',
    memory: process.memoryUsage(),
    loaded: [...loaded],
    classification: globalThis.__IPC_BENCH_CLASSIFICATION ?? null,
    epochMs: performance.timeOrigin + performance.now(),
    gc: [],
    gcStatus: 'NOT_COLLECTED_FORMAL_TIMING'
  }
}

if (parentPort && !deno) {
  workerData?.benchPort?.on('message', () => workerData.benchPort.postMessage(snapshot()))
  if (workerData?.data?.observation)
    observationReady = new Promise((resolve) => {
      /** Consume before the runtime factory starts its bounded receive handoff. */
      const receive = (message) => {
        if (message?.kind !== IpcBenchControl.observation) return
        parentPort.off('message', receive)
        /** Only the already-transferred separate port receives out-of-band snapshot requests. */
        const port = message.port
        port.on('message', () => port.postMessage(snapshot()))
        port.postMessage(IpcBenchControl.ready)
        resolve()
      }
      parentPort.on('message', receive)
    })
} else if (process.argv.includes('--child')) {
  process.on('SIGUSR2', () => {
    /** Publish only a complete boundary snapshot; existence is the parent's ready signal. */
    const path = stem + '.snapshot-' + sequence++ + '.json'
    writeFileSync(path + '.tmp', JSON.stringify(snapshot()))
    renameSync(path + '.tmp', path)
  })
}
