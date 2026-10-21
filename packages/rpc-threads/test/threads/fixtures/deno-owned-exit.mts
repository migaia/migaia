import assert from 'node:assert/strict'
import { createThreadPeer, isThreadChild } from '@migaia/rpc-threads'

/** Preserve the complete diagnostic classification without serializing runtime error instances. */
function classify(value: unknown, depth = 0): Record<string, unknown> {
  /** Report fields belong to their original package; absent fields remain explicit in evidence. */
  const error = value as {
    source?: string
    code?: string
    name?: string
    detail?: unknown
    message?: string
    cause?: unknown
    errors?: unknown[]
  }
  return {
    source: error?.source ?? null,
    code: error?.code ?? null,
    name: error?.name ?? null,
    detail: error?.detail ?? null,
    message: String(error?.message ?? value),
    ...(depth >= 10 || error?.cause === undefined
      ? {}
      : { cause: classify(error.cause, depth + 1) }),
    ...(depth >= 10 || !Array.isArray(error?.errors)
      ? {}
      : { errors: error.errors.map((item) => classify(item, depth + 1)) })
  }
}

if (await isThreadChild()) {
  await createThreadPeer({ provide: { echo: (value: string) => value } })
} else {
  /** Deno's real Web Worker owns execution; no replacement launcher invents an exit receipt. */
  const runtime = Reflect.get(globalThis, 'Deno') as { version: { deno: string } }
  /** A two-second reap budget makes the old guaranteed wait distinguishable from prompt closure. */
  const reapTimeoutMs = 2000
  /** Admission and retirement remain separate diagnostic phases. */
  const diagnostics: unknown[] = []
  /** Public owned-spawn shorthand selects the real Deno launcher and default health negotiation. */
  const peer = await createThreadPeer<{ echo(value: string): string }>({
    report: (error) => diagnostics.push(error),
    spawn: {
      entry: new URL(import.meta.url),
      supervisor: { stop: { reapTimeoutMs } }
    }
  })
  /** Business output proves preparation and a genuine cross-realm request completed before close. */
  const value = await peer.request('echo', 'actual-deno-owned-worker')
  assert.equal(value, 'actual-deno-owned-worker')
  /** Snapshot first, then clear only the phase boundary; no admission notice is hidden. */
  const admissionDiagnostics = diagnostics.splice(0).map((error) => classify(error))
  /** Wall elapsed is bounded against the configured reap budget by the parent test. */
  const started = performance.now()
  await peer.close()
  /** Repeated close must not produce another abandoned report. */
  await peer.close()
  console.log(
    JSON.stringify({
      runtime: `deno ${runtime.version.deno}`,
      value,
      reapTimeoutMs,
      elapsedMs: performance.now() - started,
      admissionDiagnostics,
      closeDiagnostics: diagnostics.map((error) => classify(error))
    })
  )
}
