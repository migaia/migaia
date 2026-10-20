import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { BroadcastChannel } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { expect } from 'vitest'

/** These cases use the genuine built boundary also consumed by Node child entry fixtures. */
export async function fixture() {
  /** Dynamic file URLs avoid a TypeScript declaration dependency on the plain-JS fixtures. */
  const hostsUrl = new URL('./fixtures/hosts.mjs', import.meta.url).href
  /** Built root owns the same host brand as the imported child fixture declarations. */
  const apiUrl = new URL('../../dist/index.js', import.meta.url).href
  return { ...(await import(hostsUrl)), ...(await import(apiUrl)) }
}

/** Canonical parent assembly exposes its existing internal PluginHost for outlet observation. */
export async function assembled(options: any) {
  /** Internal owner is read directly; no public instrumentation method is introduced. */
  const ownerUrl = new URL('../../dist/hosts/parent/tray.js', import.meta.url).href
  return (await import(ownerUrl)).createTrayRuntime(options)
}

/** Bounded reads wait only for real lifecycle or target cancellation transitions. */
export async function until<T>(
  read: () => T | Promise<T>,
  matches: (value: T) => boolean,
  timeoutMs = 10000
): Promise<T> {
  /** Wall deadline prevents a missing business transition from hanging the serial test project. */
  const deadline = Date.now() + timeoutMs
  /** Last observed value makes a failure report concrete. */
  let value = await read()
  while (!matches(value) && Date.now() < deadline) {
    await delay(10)
    value = await read()
  }
  expect(matches(value), JSON.stringify(value)).toBe(true)
  return value
}

/** Marker files stay inside the worktree and retain independent physical cleanup evidence. */
export function marker(name: string): string {
  /** Ignored fixture output belongs to this worktree, not shared docs or the primary checkout. */
  const directory = fileURLToPath(
    new URL('../../node_modules/.tray-host-evidence/', import.meta.url)
  )
  mkdirSync(directory, { recursive: true })
  return `${directory}/${name}-${randomUUID()}.log`
}

/** Empty marker state is a valid observation before a child has written its first event. */
export function lines(path: string): string[] {
  return existsSync(path) ? readFileSync(path, 'utf8').trim().split('\n').filter(Boolean) : []
}

/** Full failure classification supports evidence without relying on a code-only counter. */
export function classify(value: unknown, depth = 0): any {
  /** Only diagnostic fields and the bounded original cause chain are exposed. */
  const error = value as any
  return {
    name: error?.name ?? typeof value,
    source: error?.source ?? null,
    code: error?.code ?? null,
    reason: error?.reason ?? null,
    message: String(error?.message ?? value).slice(0, 200),
    ...(depth >= 10 || error?.cause === undefined
      ? {}
      : { cause: classify(error.cause, depth + 1) }),
    ...(depth >= 10 || !Array.isArray(error?.errors)
      ? {}
      : { errors: error.errors.map((item: unknown) => classify(item, depth + 1)) })
  }
}

/** A semantic code may appear on the canonical cause chain rather than at the Tray wrapper. */
export function chainHas(value: unknown, code: string): boolean {
  /** Bounded identity set protects only this assertion's traversal of native cause chains. */
  const seen = new Set<unknown>()
  /** Traversal retains the original cause before ordered AggregateError children. */
  const pending: any[] = [value]
  while (pending.length && seen.size < 50) {
    /** Each genuine error is inspected once; identity detects native cause cycles. */
    const current = pending.shift()
    if (!current || seen.has(current)) continue
    if (current.code === code) return true
    seen.add(current)
    if (current.cause !== undefined) pending.push(current.cause)
    if (Array.isArray(current.errors)) pending.push(...current.errors)
  }
  return false
}

/** BroadcastChannel replies count genuinely live fixture Workers independently from Tray list(). */
export async function liveThreads(): Promise<number[]> {
  /** One bounded native probe reaches every currently running Worker fixture. */
  const textUrl = new URL('./fixtures/fixture-text.mjs', import.meta.url).href
  /** Shared fixture text owns the native liveness channel name. */
  const { FixtureText } = await import(textUrl)
  /** Channel lifetime is bounded by this one native liveness observation. */
  const channel = new BroadcastChannel(FixtureText.livenessChannel)
  /** Unique request prevents late replies from another liveness observation being counted. */
  const ping = randomUUID()
  /** Distinct native thread ids prove one connection never recursively spawned another Worker. */
  const threads = new Set<number>()
  channel.onmessage = (event) => {
    if (event.data?.pong === ping) threads.add(event.data.threadId)
  }
  try {
    channel.postMessage({ ping })
    await delay(100)
    return [...threads].sort((left, right) => left - right)
  } finally {
    channel.close()
  }
}

/** The native process table proves physical termination rather than only registry removal. */
export function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false
    throw error
  }
}

/** Native MessagePort ownership provides an independent coroutine task cleanup observation. */
export function livePorts(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === 'MessagePort').length
}
