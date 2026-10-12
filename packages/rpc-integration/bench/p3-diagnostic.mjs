import { Session } from 'node:inspector/promises'
import { promiseHooks } from 'node:v8'
import { performance } from 'node:perf_hooks'
import { IpcBenchDiagnostic } from './text.mjs'
import { IpcBenchErrorText } from './error-text.mjs'

/** Only explicitly requested OOB boundaries load this module; formal timing never imports it. */
let active

/**
 * Remove known fixture secrets from source names without retaining arbitrary heap strings.
 *
 * @param {unknown} value One diagnostic source name or error field.
 * @returns {string} Redacted printable metadata.
 */
function redact(value) {
  return String(value)
    .replaceAll('bench-local', '[REDACTED_AUTH]')
    .replace(/x{16,}/g, '[REDACTED_PAYLOAD]')
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '[REDACTED_AUTH]')
}

/**
 * Keep original failure classification across the existing port/file observation boundary.
 *
 * @param {unknown} error Original inspector or observation error.
 * @param {Set<object>} [seen] Causal objects already visited in this receipt.
 * @returns {object} Full redacted native classification with reachable cause/errors.
 */
export function classifyDiagnosticError(error, seen = new Set()) {
  if (error && typeof error === 'object') {
    if (seen.has(error)) return { repeatedCause: true }
    seen.add(error)
  }
  return {
    source: error?.source ?? null,
    code: error?.code ?? null,
    name: error?.name ?? typeof error,
    reason: error?.reason == null ? null : redact(error.reason),
    message: redact(error?.message ?? error),
    stack: error?.stack === undefined ? null : redact(error.stack),
    cause: error?.cause === undefined ? null : classifyDiagnosticError(error.cause, seen),
    errors: Array.isArray(error?.errors)
      ? error.errors.map((value) => classifyDiagnosticError(value, seen))
      : []
  }
}

/**
 * Classify the actual recorded source URL, preserving unknown frames rather than claiming zero.
 *
 * @param {string} url Inspector script URL or allocation trace script name.
 * @returns {string} Stable source ownership bucket.
 */
function ownership(url) {
  if (/\/packages\/rpc-[^/]+\/dist\//.test(url)) return IpcBenchDiagnostic.rpc
  if (/\/rpc-integration\/(?:bench|test)\//.test(url)) return IpcBenchDiagnostic.fixture
  if (/\/packages\/[^/]+\/dist\/|\/node_modules\//.test(url)) return IpcBenchDiagnostic.dependency
  if (url.startsWith('node:')) return IpcBenchDiagnostic.runtime
  return IpcBenchDiagnostic.unknown
}

/**
 * Extract only native allocation statistics and function metadata while the full graph is in RAM.
 *
 * @param {object} heap Parsed inspector snapshot, never written or returned as an artifact.
 * @returns {object} Recomputable non-sampling trace, exact event totals and direct-frame buckets.
 * @throws {Error} Missing native trace schema remains unavailable instead of a zero allocation.
 */
function allocationTrace(heap) {
  /**
   * Native schema controls the numeric function table; heap nodes and arbitrary strings are
   * omitted.
   */
  const meta = heap.snapshot?.meta
  /** Allocation snapshots expose cumulative count/size separately from retained heap node sizes. */
  const nodeFields = meta?.trace_node_fields
  /** Function names and script names are the only heap strings permitted in the saved receipt. */
  const functionFields = meta?.trace_function_info_fields
  if (
    !Array.isArray(nodeFields) ||
    !Array.isArray(functionFields) ||
    !nodeFields.includes('count') ||
    !nodeFields.includes('size') ||
    !Array.isArray(heap.trace_tree) ||
    heap.trace_tree.length === 0
  )
    throw new Error(IpcBenchErrorText.diagnosticTrace)
  /** Decoded rows retain their original index so every trace node can be joined without guessing. */
  const functionInfos = []
  for (let index = 0; index < heap.trace_function_infos.length; index += functionFields.length) {
    /** The original native field names and numeric values remain available for recomputation. */
    const info = Object.fromEntries(
      functionFields.map((field, offset) => [field, heap.trace_function_infos[index + offset]])
    )
    info.name = redact(heap.strings[info.name])
    info.script_name = redact(heap.strings[info.script_name])
    info.ownership = ownership(info.script_name)
    functionInfos.push(info)
  }
  /** Each node's count/size is self allocation; summing once avoids inclusive-stack double counting. */
  const ownershipTotals = Object.fromEntries(
    [
      IpcBenchDiagnostic.rpc,
      IpcBenchDiagnostic.dependency,
      IpcBenchDiagnostic.fixture,
      IpcBenchDiagnostic.runtime,
      IpcBenchDiagnostic.unknown
    ].map((key) => [key, { trackedEventCount: 0, trackedHeapBytes: 0 }])
  )
  /** One recursive walk reads native counters; it does not inspect or retain the object graph. */
  const visit = (nodes) => {
    for (let index = 0; index < nodes.length; index += nodeFields.length) {
      /** The trace's original function index selects a known bucket or explicit unknown owner. */
      const info = functionInfos[nodes[index + nodeFields.indexOf('function_info_index')]]
      /** Counters keep their native integer units, without inferred object sizes or samples. */
      const total = ownershipTotals[info?.ownership ?? IpcBenchDiagnostic.unknown]
      total.trackedEventCount += nodes[index + nodeFields.indexOf('count')]
      total.trackedHeapBytes += nodes[index + nodeFields.indexOf('size')]
      visit(nodes[index + nodeFields.indexOf('children')])
    }
  }
  visit(heap.trace_tree)
  return {
    status: IpcBenchDiagnostic.allocationStatus,
    scope: IpcBenchDiagnostic.allocationScope,
    ownershipScope: IpcBenchDiagnostic.ownershipScope,
    meta: { trace_node_fields: nodeFields, trace_function_info_fields: functionFields },
    functionInfos,
    traceTree: heap.trace_tree,
    trackedEventCount: Object.values(ownershipTotals).reduce(
      (sum, value) => sum + value.trackedEventCount,
      0
    ),
    trackedHeapBytes: Object.values(ownershipTotals).reduce(
      (sum, value) => sum + value.trackedHeapBytes,
      0
    ),
    ownershipTotals
  }
}

/**
 * Start or stop one isolate's separate CPU/guard capture through its existing OOB snapshot owner.
 *
 * @param {'start' | 'stop'} boundary Warmed interval boundary.
 * @param {'cpu' | 'guard'} mode Separate diagnostic lane, never formal timing.
 * @returns {Promise<object>} Start receipt or full CPU/guard raw data, with explicit scope.
 * @throws {Error} Original inspector failure remains observable; native session always disconnects.
 */
export async function captureDiagnostic(boundary, mode) {
  if (![IpcBenchDiagnostic.cpu, IpcBenchDiagnostic.guard].includes(mode))
    throw new TypeError(IpcBenchErrorText.diagnosticMode)
  if (boundary === IpcBenchDiagnostic.start) {
    if (active) throw new Error(IpcBenchErrorText.diagnosticState)
    /** This session belongs only to the requested isolate and diagnostic lane. */
    const session = new Session()
    session.connect()
    /** Scalar Promise state avoids stack capture or per-event allocation from the observer itself. */
    const capture = { session, mode, created: 0, startEpochMs: 0, stopPromiseHook: undefined }
    active = capture
    try {
      await session.post(IpcBenchDiagnostic.profilerEnable)
      if (mode === IpcBenchDiagnostic.cpu) await session.post(IpcBenchDiagnostic.profilerStart)
      else {
        /** Function-count mode keeps already-warmed functions from reoptimizing past the counter. */
        await session.post(IpcBenchDiagnostic.preciseStart, { callCount: true, detailed: false })
        await session.post(IpcBenchDiagnostic.heapEnable)
        await session.post(IpcBenchDiagnostic.heapStart, { trackAllocations: true })
        capture.stopPromiseHook = promiseHooks.onInit(() => {
          capture.created++
        })
      }
      capture.startEpochMs = performance.timeOrigin + performance.now()
      return { mode, status: IpcBenchDiagnostic.started, startEpochMs: capture.startEpochMs }
    } catch (error) {
      capture.stopPromiseHook?.()
      active = undefined
      session.disconnect()
      throw error
    }
  }
  if (boundary !== IpcBenchDiagnostic.stop || !active || active.mode !== mode)
    throw new Error(IpcBenchErrorText.diagnosticState)
  /** Stop the same native session once, even if collection or serialization fails. */
  const capture = active
  active = undefined
  capture.stopPromiseHook?.()
  /** Promise counts end before profiler serialization; allocation scope still includes its controls. */
  const stopEpochMs = performance.timeOrigin + performance.now()
  try {
    if (mode === IpcBenchDiagnostic.cpu) {
      /** Native CPU samples carry call frames and durations, rather than exact allocation claims. */
      const { profile } = await capture.session.post(IpcBenchDiagnostic.profilerStop)
      return {
        mode,
        status: IpcBenchDiagnostic.captured,
        startEpochMs: capture.startEpochMs,
        stopEpochMs,
        cpuProfile: {
          ...profile,
          nodes: profile.nodes.map((node) => ({
            ...node,
            callFrame: {
              ...node.callFrame,
              functionName: redact(node.callFrame.functionName),
              url: redact(node.callFrame.url)
            }
          }))
        }
      }
    }
    /** All script/function ranges are retained; owner selection can be recomputed from actual URLs. */
    const { result: coverage, timestamp } = await capture.session.post(
      IpcBenchDiagnostic.preciseTake
    )
    await capture.session.post(IpcBenchDiagnostic.preciseStop)
    /** Raw heap chunks exist only inside this stop operation and never reach disk/stdout/receipt. */
    const chunks = []
    /** The inspector emits the complete graph in memory; only the trace projection escapes. */
    const receive = (event) => chunks.push(event.params.chunk)
    capture.session.on(IpcBenchDiagnostic.heapChunk, receive)
    try {
      await capture.session.post(IpcBenchDiagnostic.heapStop)
    } finally {
      capture.session.off(IpcBenchDiagnostic.heapChunk, receive)
    }
    /**
     * Parsed nodes and arbitrary strings remain local, including the fixture's authentication
     * token.
     */
    const heap = JSON.parse(chunks.join(''))
    return {
      mode,
      status: IpcBenchDiagnostic.captured,
      startEpochMs: capture.startEpochMs,
      stopEpochMs,
      guard: {
        promises: {
          created: capture.created,
          status: IpcBenchDiagnostic.promiseStatus,
          scope: IpcBenchDiagnostic.promiseScope,
          startEpochMs: capture.startEpochMs,
          stopEpochMs
        },
        coverageTimestamp: timestamp,
        coverage: coverage.map((script) => ({
          ...script,
          url: redact(script.url),
          ownership: ownership(script.url),
          functions: script.functions.map((fn) => ({
            ...fn,
            functionName: redact(fn.functionName)
          }))
        })),
        allocationTrace: allocationTrace(heap)
      }
    }
  } finally {
    capture.session.disconnect()
  }
}
