import { expect, it, vi } from 'vitest'
import {
  createRuntimeByteConnection,
  createRuntimeMessageConnection
} from '../../dist/adapter/internal-advanced.js'
import { connectionOptions, diagnostics, duplex, reaches } from './audit-byte-fixture.js'
import { defineByteAdapter } from '../../dist/adapter.js'

it('refuses a pre-aborted peer signal before opening its byte source', async () => {
  /** A complete byte source remains available, but cancellation must prevent acquisition. */
  const physical = duplex()
  /** Opening is counted separately from handshake writes. */
  const open = vi.fn(() => physical.ports[0]!)
  /** This real public definition performs ordinary source admission. */
  const adapter = defineByteAdapter({ open })
  /** The original native cancellation reason remains the public rejection object. */
  const original = new Error('audit cancel before opening')
  /** Cancel before calling the factory to test its earliest supported admission boundary. */
  const controller = new AbortController()
  controller.abort(original)
  /** Observe immediately so both the fixed and broken constructions can be safely reclaimed. */
  const attempt = adapter
    .peer({
      connect: {},
      peerId: 'remote',
      self: { name: 'local', instanceId: 'local' },
      signal: controller.signal
    })
    .catch((error: unknown) => error)
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    physical.close()
    expect(await attempt).toBe(original)
    expect(open).not.toHaveBeenCalled()
  } finally {
    physical.close()
    await attempt
  }
})

it('aborts and physically releases an in-progress byte handshake', async () => {
  /** No responder is started: the actual outgoing hello remains pending for its peer reply. */
  const physical = duplex()
  /** Observe the genuine first write rather than waiting for an arbitrary timeout. */
  let written!: () => void
  /** This gate owns only the test observation of the real writer. */
  const firstWrite = new Promise<void>((resolve) => {
    written = resolve
  })
  /** Retain the supported writer's closure and preserve its physical byte delivery. */
  const write = physical.ports[0]!.write
  vi.spyOn(physical.ports[0]!, 'write').mockImplementation(async (bytes) => {
    written()
    await write(bytes)
  })
  /** The caller cancels only this construction's handshake. */
  const controller = new AbortController()
  /** The definition supplies actual held byte I/O without a fabricated agreement. */
  const adapter = defineByteAdapter({ open: () => physical.ports[0]! })
  /** Settlement is recorded before the finally block manually closes either physical side. */
  let settled = false
  /** Observe all outcomes so a broken implementation cannot leave an unhandled construction. */
  const attempt = adapter
    .peer({
      connect: {},
      peerId: 'remote',
      self: { name: 'local', instanceId: 'local' },
      signal: controller.signal
    })
    .then(
      (peer) => {
        settled = true
        return peer.close()
      },
      () => {
        settled = true
      }
    )
  try {
    await firstWrite
    controller.abort(new Error('audit cancel active handshake'))
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(true)
    expect(physical.states[0]!.closes).toBe(1)
  } finally {
    physical.close()
    await attempt
  }
})

it('releases remaining IPC resources and the physical stream after an owned close fails', async () => {
  /** Both sides complete the public control exchange before cleanup is admitted. */
  const physical = duplex()
  /** Preserve this actual failure while proving later releases still execute. */
  const original = new Error('audit owned close failed')
  /** The existing connection owner releases registered resources in acquisition order. */
  const released: string[] = []
  try {
    /** Actual negotiated connections own their independent physical streams. */
    const [left, right] = await Promise.all([
      createRuntimeByteConnection(
        physical.ports[0]!,
        { ...connectionOptions('left', 'right'), role: 'initiator' },
        diagnostics
      ),
      createRuntimeByteConnection(
        physical.ports[1]!,
        { ...connectionOptions('right', 'left'), role: 'responder', auth: { mode: 'none' } },
        diagnostics
      )
    ])
    left.ownClose({
      close() {
        released.push('first')
        throw original
      }
    })
    left.ownClose({
      close() {
        released.push('second')
      }
    })
    /** The first close Promise remains stable even when the cleanup transaction rejects. */
    const closing = left.close()
    expect(left.close()).toBe(closing)
    await expect(closing).rejects.toBe(original)
    expect(released).toEqual(['first', 'second'])
    expect(physical.states[0]!.closes).toBe(1)
    expect(physical.states[0]!.data.size).toBe(0)
    await right.close()
  } finally {
    physical.close()
  }
})

it('contains a transport error listener failure and still closes the message port once', async () => {
  /** These sets observe the actual structural port subscriptions. */
  const messages = new Set<(value: unknown) => void>()
  /** Physical terminal callbacks have a separate remover. */
  const closes = new Set<(reason?: unknown) => void>()
  /** Native release is independently counted, rather than inferred from logical closed state. */
  const close = vi.fn()
  /** Listener failures use the existing connection reporter, as on byte carriers. */
  const report = vi.fn()
  /** A supported whole-message port needs no handshake for the fixed capability subset. */
  const io = {
    kind: 'message' as const,
    send() {},
    onMessage(listener: (value: unknown) => void) {
      messages.add(listener)
      return () => {
        messages.delete(listener)
      }
    },
    onClose(listener: (reason?: unknown) => void) {
      closes.add(listener)
      return () => {
        closes.delete(listener)
      }
    },
    close
  }
  /** This public source owns the transport's actual close operation. */
  const connection = await createRuntimeMessageConnection(
    io,
    { ...connectionOptions('message', 'other', report), offer: ['batch@1'] },
    diagnostics
  )
  /** The exact callback failure must be reported without blocking physical teardown. */
  const original = new Error('audit transport listener failed')
  /** The synchronous callback reenters the same close owner before throwing. */
  let nested: Promise<void> | undefined
  /** Bound the fixture to one reentry even when running against the broken implementation. */
  let reentered = false
  connection.transport.onTransportError?.(() => {
    if (!reentered) {
      reentered = true
      nested = connection.close()
      void nested.catch(() => {})
    }
    throw original
  })
  /** The source wrapper awaits the one physical teardown even when a listener reenters it. */
  const closing = connection.close()
  await closing
  await nested
  expect(close).toHaveBeenCalledTimes(1)
  expect(messages.size).toBe(0)
  expect(closes.size).toBe(0)
  expect(report).toHaveBeenCalledWith(original)
})

it('keeps the verifier failure out of every report, cause and peer rejection', async () => {
  /** Real control bytes, not a forged agreement, connect the two supported public operations. */
  const physical = duplex()
  /** Stands in for a verifier exception that carries the offered token. */
  const original = new Error('AUDIT_ONLY_PRIVATE_VERIFIER_FAILURE')
  /** Reports must still arrive, but without the verifier exception (handshake redaction). */
  const reports: unknown[] = []
  /** Observe actual reject bytes while preserving the real ordered writer. */
  const writes = vi.spyOn(physical.ports[1]!, 'write')
  try {
    /** Both construction rejections settle and release their handshake timers. */
    const result = await Promise.allSettled([
      createRuntimeByteConnection(
        physical.ports[0]!,
        { ...connectionOptions('left', 'right'), role: 'initiator' },
        diagnostics
      ),
      createRuntimeByteConnection(
        physical.ports[1]!,
        {
          ...connectionOptions('right', 'left', (error) => {
            reports.push(error)
          }),
          role: 'responder',
          auth: {
            mode: 'required',
            verify() {
              throw original
            }
          }
        },
        diagnostics
      )
    ])
    expect(result.map((value) => value.status)).toEqual(['rejected', 'rejected'])
    expect(reports.length).toBeGreaterThan(0)
    expect(reports.some((error) => reaches(error, original))).toBe(false)
    expect(result[1]!.status === 'rejected' && reaches(result[1]!.reason, original)).toBe(false)
    expect(result[0]!.status === 'rejected' && reaches(result[0]!.reason, original)).toBe(false)
    expect(
      writes.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)).join('')
    ).not.toContain(original.message)
  } finally {
    writes.mockRestore()
    physical.close()
  }
})
