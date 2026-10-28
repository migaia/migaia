import { expect, it, vi } from 'vitest'
import { createRpcHost } from '@migaia/rpc-host'
import {
  createRpcByteCarrier,
  createRpcMessageCarrier,
  defineTransportPlugin
} from '@migaia/rpc-host/sdk'
import { authFeature } from '@migaia/rpc-host/plugins/auth'
import { duplex, reaches } from './audit-byte-fixture.ts'

it('refuses a pre-aborted peer signal before opening its byte source', async () => {
  /** Physical acquisition is separate from cold native plugin definition. */
  const physical = duplex()
  /** Actual acquisition remains uncalled when the public caller is already cancelled. */
  const open = vi.fn(async () => ({ dispose: () => undefined }))
  /** The original native reason must remain the public cancellation cause. */
  const original = new Error('audit cancel before opening')
  /** This controller is already terminal before the Host may install native resources. */
  const controller = new AbortController()
  controller.abort(original)
  /** Observe the real construction failure without introducing another cancellation owner. */
  const attempt = Promise.resolve()
    .then(() =>
      createRpcHost({
        self: { name: 'local', instanceId: 'local' },
        signal: controller.signal,
        plugins: [defineTransportPlugin({ name: 'audit', namespace: 'byte', open })]
      })
    )
    .catch((error: unknown) => error)
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    physical.close()
    expect(await attempt).toMatchObject({ code: 'CANCELLED', cause: original })
    expect(open).not.toHaveBeenCalled()
  } finally {
    physical.close()
    await attempt
  }
})

it('aborts and physically releases an in-progress byte handshake', async () => {
  /** The original raw stream stays silent; only the real local hello can be written. */
  const physical = duplex()
  /** The first actual byte handoff starts cancellation, independently from any timer. */
  let written!: () => void
  /** This barrier observes physical work without manufacturing accepted Session readiness. */
  const firstWrite = new Promise<void>((resolve) => {
    written = resolve
  })
  /** Preserve the native writer, including its original frame delivery. */
  const write = physical.ports[0]!.write
  vi.spyOn(physical.ports[0]!, 'write').mockImplementation(async (bytes, options) => {
    written()
    await write(bytes, options)
  })
  /** One original caller controller owns construction cancellation. */
  const controller = new AbortController()
  /** Original caller cancellation remains reachable after the real native rollback. */
  const original = new Error('audit cancel active handshake')
  /** The native caller signal owns this actual abort subscription remover. */
  const remove = vi.spyOn(controller.signal, 'removeEventListener')
  /** Observe the actual public failure separately from physical close counts. */
  let failure: unknown
  /** Public settlement must precede manual fixture cleanup. */
  let settled = false
  /** The SDK attaches one real acquired carrier and waits for its actual handshake only. */
  const attempt = Promise.resolve()
    .then(() =>
      createRpcHost({
        self: { name: 'local', instanceId: 'local' },
        signal: controller.signal,
        plugins: [
          defineTransportPlugin({
            name: 'audit',
            namespace: 'byte',
            async open(context) {
              const carrier = createRpcByteCarrier({
                id: 'local-byte',
                io: physical.ports[0]!,
                report: context.report
              })
              await context.attach(carrier, { expectedPeerId: 'remote' }).ready
              return { dispose: () => undefined }
            }
          })
        ]
      })
    )
    .then(
      (host) => {
        settled = true
        return host.close()
      },
      (error: unknown) => {
        failure = error
        settled = true
      }
    )
  try {
    await firstWrite
    controller.abort(original)
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(settled).toBe(true)
    expect(physical.states[0]!.closes).toBe(1)
    expect(reaches(failure, original)).toBe(true)
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(physical.states[0]!.data.size).toBe(0)
  } finally {
    physical.close()
    await attempt
    remove.mockRestore()
  }
})

it('releases remaining IPC resources and the physical stream after an owned close fails', async () => {
  /** SDK carrier cleanup owns the actual acquired native subscription removers. */
  const physical = duplex()
  /** This original cleanup failure must remain the single public rejection instance. */
  const original = new Error('audit owned close failed')
  /** Actual release order remains observable at the native resource boundary. */
  const released: string[] = []
  /** Original listener removal is retained while observing failure and later cleanup. */
  const onData = physical.ports[0]!.onData
  /** Native LIFO removes close/error subscriptions before the original byte reader. */
  const onClose = physical.ports[0]!.onClose
  vi.spyOn(physical.ports[0]!, 'onData').mockImplementation((listener) => {
    const remove = onData(listener)
    return () => {
      remove()
      released.push('second')
    }
  })
  vi.spyOn(physical.ports[0]!, 'onClose').mockImplementation((listener) => {
    const remove = onClose(listener)
    return () => {
      remove()
      released.push('first')
      throw original
    }
  })
  /** This actual factory acquires both listeners before its one close transaction can begin. */
  const left = createRpcByteCarrier({
    id: 'cleanup-byte',
    io: physical.ports[0]!,
    report: () => undefined
  })
  try {
    const closing = left.close()
    expect(left.close()).toBe(closing)
    await expect(closing).rejects.toBe(original)
    expect(released).toEqual(['first', 'second'])
    expect(physical.states[0]!.closes).toBe(1)
    expect(physical.states[0]!.data.size).toBe(0)
  } finally {
    physical.close()
  }
})

it('contains a transport error listener failure and still closes the message port once', async () => {
  /** Original native listener sets expose actual SDK remover behavior. */
  const messages = new Set<(value: unknown) => void>()
  /** Terminal listeners have an independent original disposer. */
  const closes = new Set<(reason?: unknown) => void>()
  /** Physical release is counted separately from logical closure. */
  const close = vi.fn()
  /** The actual carrier reporter must retain the failing listener by exact identity. */
  const report = vi.fn()
  /** This remains a raw physical source; Session and request behavior are not fabricated. */
  const connection = createRpcMessageCarrier({
    id: 'message',
    report,
    io: {
      send() {},
      onMessage(listener) {
        messages.add(listener)
        return () => {
          messages.delete(listener)
        }
      },
      onClose(listener) {
        closes.add(listener)
        return () => {
          closes.delete(listener)
        }
      },
      close
    }
  })
  /** Public observer failure cannot prevent native resource release. */
  const original = new Error('audit transport listener failed')
  /** Reentrant close borrows the same native carrier completion. */
  let nested: Promise<void> | undefined
  /** The fixture reenters once without creating another close lifecycle. */
  let reentered = false
  connection.subscribe({
    frame() {},
    error() {},
    close() {
      if (!reentered) {
        reentered = true
        nested = connection.close()
        void nested.catch(() => undefined)
      }
      throw original
    }
  })
  const closing = connection.close()
  await closing
  await nested
  expect(close).toHaveBeenCalledTimes(1)
  expect(messages.size).toBe(0)
  expect(closes.size).toBe(0)
  expect(report).toHaveBeenCalledWith(original)
})

it('retains the verifier failure locally and keeps it out of the unauthenticated peer rejection', async () => {
  /** Real byte IO and bilateral Session handshakes carry the actual rejection. */
  const physical = duplex()
  /** The offered verifier failure deliberately contains a private diagnostic marker. */
  const original = new Error('AUDIT_ONLY_PRIVATE_VERIFIER_FAILURE')
  /** Local diagnostics retain the original verifier failure while handshake wire remains redacted. */
  const reports: unknown[] = []
  /** Observe real rejection bytes while leaving the original framing/write implementation intact. */
  const writes = vi.spyOn(physical.ports[1]!, 'write')
  try {
    const result = await Promise.allSettled(
      [0, 1].map((index) =>
        createRpcHost({
          self: {
            name: index === 0 ? 'left' : 'right',
            instanceId: index === 0 ? 'left' : 'right'
          },
          report: (error) => {
            reports.push(error)
          },
          plugins: [
            ...(index === 1
              ? [
                  authFeature({
                    verifyCredentials() {
                      throw original
                    }
                  })
                ]
              : []),
            defineTransportPlugin({
              name: 'audit',
              namespace: 'byte',
              async open(context) {
                const carrier = createRpcByteCarrier({
                  id: `byte-${index}`,
                  io: physical.ports[index]!,
                  report: context.report
                })
                await context.attach(carrier).ready
                return { dispose: () => undefined }
              }
            })
          ]
        })
      )
    )
    expect(result.map((value) => value.status)).toEqual(['rejected', 'rejected'])
    expect(reports.length).toBeGreaterThan(0)
    expect(reports.some((error) => reaches(error, original))).toBe(true)
    expect(result[1]!.status === 'rejected' && reaches(result[1]!.reason, original)).toBe(true)
    expect(result[0]!.status === 'rejected' && reaches(result[0]!.reason, original)).toBe(false)
    expect(
      writes.mock.calls.map(([bytes]) => new TextDecoder().decode(bytes)).join('')
    ).not.toContain(original.message)
  } finally {
    writes.mockRestore()
    physical.close()
  }
})
