import assert from 'node:assert/strict'
import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { isThreadChild } from '@migaia/rpc-plugin-thread'
import { createTray, defineTrayHost, serveTrayHost } from '@migaia/tray'

/** Preserve diagnostic classification instead of reducing distinct cleanup branches to a code. */
function classify(value: unknown, depth = 0): Record<string, unknown> {
  /** These public error fields remain owned by the original reporting package. */
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

/** Both realms declare the same trusted host; only the actual child installs business providers. */
const definition = defineTrayHost({
  name: 'deno-owned-thread',
  runtime: 'thread',
  entry: new URL(import.meta.url),
  exposes: ['business.echo'],
  plugins: () => [
    definePlugin({
      name: 'business',
      features: { echo: defineFeature(() => ({ read: (value: string) => value })) },
      install: () => ({})
    })
  ]
})

if (await isThreadChild()) {
  await serveTrayHost(definition)
} else {
  /** Version comes from the runtime that creates the native Dedicated Worker. */
  const runtime = Reflect.get(globalThis, 'Deno') as { version: { deno: string } }
  /** Tray deliberately retains the existing RPC/supervision default instead of adding policy. */
  const reapTimeoutMs = 5000
  /** One original report sink observes admission and parent PluginHost cleanup. */
  const diagnostics: unknown[] = []
  /** The real parent registry creates its existing Thread plugin and native worker. */
  const tray = createTray({ hosts: [definition], report: (error) => diagnostics.push(error) })
  /** Business receipt proves genuine Tray init and RPC delegation before shutdown. */
  const remote = await tray.spawn(definition.name, { id: 'deno-owned' })
  /** The exposed Feature name and method exercise the ordinary public remote API. */
  const value = await remote.request('business.echo.read', 'actual-deno-tray-worker')
  assert.equal(value, 'actual-deno-tray-worker')
  /** CAPABILITY_UNSUPPORTED is retained as admission evidence, separate from cleanup diagnosis. */
  const admissionDiagnostics = diagnostics.splice(0).map((error) => classify(error))
  /** Parent disposal must no longer consume the five-second reap window or hit its step timeout. */
  const started = performance.now()
  await tray.dispose()
  await tray.dispose()
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
