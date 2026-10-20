import { IpcBenchErrorText } from './error-text.mjs'
import { fileURLToPath } from 'node:url'
import { writeFileSync } from 'node:fs'
import { createIpcSession } from '../test/bench/ipc-session.mjs'
import { createMacPidObserver } from './bare-node.mjs'
import { measureBare } from './ipc.mjs'
import { snapshot, captureSnapshot } from './observe.mjs'
import { IpcBenchDiagnostic } from './text.mjs'

/**
 * Run one already-frozen performance side in its own parent/peer process boundary.
 *
 * @param {object} unit Same payload, logical codec, carrier and concurrency for both sides.
 * @param {'bare' | 'rpc'} side Paired side; never changes the frozen unit.
 * @param {{
 *   samples?: number
 *   warmup?: number
 *   check?: boolean
 *   diagnostic?: 'cpu' | 'guard' | 'sampling'
 * }} options
 *   Check performs three echoes only.
 * @returns {Promise<object>} Full measurement or preparation receipt.
 * @throws {Error} Ready, observer, echo and cleanup failures retain their first cause.
 */
export async function runIpcSide(unit, side, options = {}) {
  /**
   * A diagnostic is deliberately limited to the two Node physical carriers requested by the
   * diagnostic lane.
   */
  const diagnosticMode = options.diagnostic
  if (
    diagnosticMode &&
    (![IpcBenchDiagnostic.cpu, IpcBenchDiagnostic.guard, IpcBenchDiagnostic.sampling].includes(
      diagnosticMode
    ) ||
      typeof Deno !== 'undefined' ||
      process.versions.bun ||
      !['stdio-framed', 'worker'].includes(unit.carrier) ||
      unit.wire === 'jsonrpc' ||
      (unit.peerRuntime && unit.peerRuntime !== 'node') ||
      unit.topology ||
      unit.direction === 'reverse' ||
      options.check)
  )
    throw new TypeError(IpcBenchErrorText.diagnosticMode)
  if (unit.carrier === 'browser-worker') {
    /** Chromium owns its actual endpoint processes; this Node parent is only the driver. */
    const { runBrowserSide } = await import('./browser-side.mjs')
    return runBrowserSide(unit, side, options)
  }
  /** The exact shared admission stops preparation before starting a peer or a measured window. */
  const { admitConformanceToolchains } =
    await import('../../rpc-process/test/process/fixtures/conformance-toolchains.mjs')
  const admission = admitConformanceToolchains()
  if (!admission.accepted) throw new Error(JSON.stringify(admission))
  /** Portable business bytes are fixed by the selected unit, independent of the side. */
  const payload = 'x'.repeat(unit.payloadBytes)
  /** Session ownership is acquired before the separately prestarted observer. */
  /** Only the explicitly selected lane propagates ordinary mode configuration to its native peer. */
  const previousDiagnostic = process.env[IpcBenchDiagnostic.environment]
  if (diagnosticMode) process.env[IpcBenchDiagnostic.environment] = diagnosticMode
  /** Failed acquisition must restore fixture configuration before propagating its original error. */
  let session
  try {
    session = await createIpcSession({ ...unit, side, payload })
  } catch (error) {
    if (diagnosticMode) {
      if (previousDiagnostic === undefined) delete process.env[IpcBenchDiagnostic.environment]
      else process.env[IpcBenchDiagnostic.environment] = previousDiagnostic
    }
    throw error
  }
  /** Both cleanup actions run even if the observer or one cleanup fails. */
  let observer
  const failures = []
  let receipt
  /** Each started native profiler is stopped even when an actual exchange fails. */
  let parentCapturing = false
  /** Peer capture uses the same separate observation channel, without adding any RPC method. */
  let peerCapturing = false
  /** The local observer serializes failures identically to the OOB peer response. */
  const readDiagnostic = (value) => {
    if (value?.diagnostic?.status === IpcBenchDiagnostic.failed)
      throw new Error(IpcBenchErrorText.diagnosticCapture, { cause: value.diagnostic.error })
    return value
  }
  try {
    await session.ready()
    if (session.runInInitiator && !options.check) {
      /** Reverse raw samples and clock come from the actual Worker, not a parent-trigger latency. */
      receipt = await session.runInInitiator(unit, options)
    } else {
      observer = await createMacPidObserver([process.pid, session.peerPid])
      if (options.check) {
        const first = await observer.read()
        for (let index = 0; index < 3; index++) await session.exchange()
        const last = await observer.read()
        receipt = {
          type: 'ipc-preparation',
          echoes: 3,
          first,
          last,
          parentSnapshot: snapshot(),
          peerSnapshot: process.env.IPC_BENCH_STEM ? await session.peerSnapshot() : null
        }
      } else {
        /** Warmup and control snapshots remain outside the formal measurement window. */
        for (let index = 0; index < (options.warmup ?? 100); index++) await session.exchange()
        if (diagnosticMode) {
          /** Capture starts only after warmup, with its control work explicitly included in scope. */
          const peerBefore = await session.peerSnapshot({
            diagnostic: IpcBenchDiagnostic.start,
            mode: diagnosticMode
          })
          peerCapturing = true
          /** The parent's actual isolate is separate from a Worker despite their shared PID. */
          const parentBefore = readDiagnostic(
            await captureSnapshot({ diagnostic: IpcBenchDiagnostic.start, mode: diagnosticMode })
          )
          parentCapturing = true
          /** The original bounded sampling loop remains unchanged; diagnostic latency is not credit. */
          const measured = await measureBare({
            ...session,
            observer,
            ...options,
            concurrency: unit.concurrency,
            warmup: 0
          })
          parentCapturing = false
          /** Stopping always disconnects the owned inspector, including collection failure. */
          const parentAfter = readDiagnostic(
            await captureSnapshot({ diagnostic: IpcBenchDiagnostic.stop, mode: diagnosticMode })
          )
          peerCapturing = false
          /** A complete second-isolate receipt is required rather than a parent-only count. */
          const peerAfter = await session.peerSnapshot({
            diagnostic: IpcBenchDiagnostic.stop,
            mode: diagnosticMode
          })
          receipt = {
            type: 'ipc-side',
            ...measured,
            parentBefore,
            peerBefore,
            parentAfter,
            peerAfter,
            classification: session.classification(),
            samplingMaxReplayEntriesPerPeer: 1200,
            providerConcurrency:
              'NOT_INSTRUMENTED_FORMAL; separate provider concurrency diagnostics',
            gcStatus: 'NOT_COLLECTED_FORMAL_TIMING',
            timingStatus: IpcBenchDiagnostic.timingStatus,
            diagnosticMode
          }
        } else {
          /** Relay CPU capture overhead is observed separately, without business or formal samples. */
          const relayControlPairs = []
          if (unit.topology === 'one-hop')
            for (let index = 0; index < 3; index++)
              relayControlPairs.push([await session.peerSnapshot(), await session.peerSnapshot()])
          /** Each native JS isolate retains its own heap and actual loaded bytes. */
          const peerBefore = await session.peerSnapshot()
          /** Parent snapshot excludes the warmup but does not instrument request execution. */
          const parentBefore = snapshot()
          receipt = {
            type: 'ipc-side',
            ...(await measureBare({
              ...session,
              observer,
              ...options,
              concurrency: unit.concurrency,
              warmup: 0
            })),
            parentBefore,
            peerBefore,
            parentAfter: snapshot(),
            peerAfter: await session.peerSnapshot(),
            classification: session.classification(),
            samplingMaxReplayEntriesPerPeer: 1200,
            providerConcurrency:
              'NOT_INSTRUMENTED_FORMAL; separate provider concurrency diagnostics',
            gcStatus: 'NOT_COLLECTED_FORMAL_TIMING',
            ...(relayControlPairs.length
              ? {
                  relayCpuDiagnostic: {
                    controlPairs: relayControlPairs,
                    scope:
                      'relay own native thread CPU between peerBefore/peerAfter; includes boundary snapshot RPC and leaf snapshot work; empty-control pairs retained separately, not a clean formal business-only CPU claim'
                  }
                }
              : {})
          }
        }
      }
    }
    receipt = {
      ...receipt,
      unit,
      side,
      runtime: process.version,
      parentPid: process.pid,
      peerPid: session.peerPid,
      encodedBytes: Buffer.byteLength(JSON.stringify(payload)),
      concurrency: unit.concurrency,
      warmup: options.warmup ?? 100,
      toolchains: admission,
      foreignExecutable: session.foreignExecutable ?? null
    }
  } catch (error) {
    failures.push(error)
  }
  if (parentCapturing) {
    try {
      readDiagnostic(
        await captureSnapshot({ diagnostic: IpcBenchDiagnostic.stop, mode: diagnosticMode })
      )
    } catch (error) {
      failures.push(error)
    }
  }
  if (peerCapturing) {
    try {
      await session.peerSnapshot({ diagnostic: IpcBenchDiagnostic.stop, mode: diagnosticMode })
    } catch (error) {
      failures.push(error)
    }
  }
  for (const result of await Promise.allSettled([
    ...(observer ? [observer.close()] : []),
    session.close()
  ]))
    if (result.status === 'rejected') failures.push(result.reason)
  if (diagnosticMode) {
    if (previousDiagnostic === undefined) delete process.env[IpcBenchDiagnostic.environment]
    else process.env[IpcBenchDiagnostic.environment] = previousDiagnostic
  }
  if (failures.length > 1) throw new AggregateError(failures, IpcBenchErrorText.sideCleanup)
  if (failures.length) throw failures[0]
  return receipt
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  /** JSON argument contains configuration only; authentication never appears in this interface. */
  const input = JSON.parse(process.argv[2])
  runIpcSide(input.unit, input.side, input.options).then(
    (receipt) => console.log(JSON.stringify(receipt)),
    (error) => {
      /** Actual causal classifications survive failed sides; missing provider reasons stay null. */
      const seen = new Set()
      /** Authentication UUIDs and fixture payloads are excluded from retained diagnostics. */
      const classify = (value) => {
        if (seen.has(value)) return { repeatedCause: true }
        seen.add(value)
        return {
          source: value?.source ?? null,
          code: value?.code ?? null,
          name: value?.name ?? typeof value,
          reason: value?.reason ?? null,
          message: String(value?.message ?? value)
            .replace(/x{16,}/g, '[REDACTED_PAYLOAD]')
            .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[REDACTED_AUTH]'),
          cause: value?.cause === undefined ? null : classify(value.cause),
          errors: value?.errors ? Array.from(value.errors, classify) : []
        }
      }
      /** Error receipts are written before exit, retaining loaded provenance and all report events. */
      const failure = {
        type: 'ipc-side-error',
        input,
        error: classify(error),
        snapshot: snapshot()
      }
      if (process.env.IPC_BENCH_STEM)
        writeFileSync(process.env.IPC_BENCH_STEM + '.error.json', JSON.stringify(failure))
      console.error(JSON.stringify(failure))
      process.exitCode = 1
    }
  )
}
