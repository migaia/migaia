import { fileURLToPath } from 'node:url'
import { createIpcSession } from './ipc-session.mjs'
import { createMacPidObserver } from './bare-node.mjs'
import { measureBare } from './ipc.mjs'

/**
 * Run one already-frozen performance side in its own parent/peer process boundary.
 *
 * @param {object} unit Same payload, logical codec, carrier and concurrency for both sides.
 * @param {'bare' | 'rpc'} side Paired side; never changes the frozen unit.
 * @param {{ samples?: number; warmup?: number; check?: boolean }} options Check performs three
 *   echoes only.
 * @returns {Promise<object>} Full measurement or preparation receipt.
 * @throws {Error} Ready, observer, echo and cleanup failures retain their first cause.
 */
export async function runIpcSide(unit, side, options = {}) {
  /** The exact shared admission stops preparation before starting a peer or a measured window. */
  const { admitConformanceToolchains } =
    await import('../test/process/fixtures/conformance-toolchains.mjs')
  const admission = admitConformanceToolchains()
  if (!admission.accepted) throw new Error(JSON.stringify(admission))
  /** Portable business bytes are fixed by the selected unit, independent of the side. */
  const payload = 'x'.repeat(unit.payloadBytes)
  /** Session ownership is acquired before the separately prestarted observer. */
  const session = await createIpcSession({ ...unit, side, payload })
  /** Both cleanup actions run even if the observer or one cleanup fails. */
  let observer
  const failures = []
  let receipt
  try {
    await session.ready()
    observer = await createMacPidObserver([process.pid, session.peerPid])
    if (options.check) {
      const first = await observer.read()
      for (let index = 0; index < 3; index++) await session.exchange()
      const last = await observer.read()
      receipt = { type: 'ipc-preparation', echoes: 3, first, last }
    } else
      receipt = { type: 'ipc-side', ...(await measureBare({ ...session, observer, ...options })) }
    receipt = {
      ...receipt,
      unit,
      side,
      runtime: process.version,
      parentPid: process.pid,
      peerPid: session.peerPid,
      encodedBytes: Buffer.byteLength(JSON.stringify(payload)),
      concurrency: 1,
      toolchains: admission
    }
  } catch (error) {
    failures.push(error)
  }
  for (const result of await Promise.allSettled([
    ...(observer ? [observer.close()] : []),
    session.close()
  ]))
    if (result.status === 'rejected') failures.push(result.reason)
  if (failures.length > 1) throw new AggregateError(failures, 'IPC side and cleanup failed')
  if (failures.length) throw failures[0]
  return receipt
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  /** JSON argument contains configuration only; authentication never appears in this interface. */
  const input = JSON.parse(process.argv[2])
  runIpcSide(input.unit, input.side, input.options).then(
    (receipt) => console.log(JSON.stringify(receipt)),
    (error) => {
      console.error(error)
      process.exitCode = 1
    }
  )
}
