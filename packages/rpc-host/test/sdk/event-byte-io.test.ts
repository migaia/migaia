import { PassThrough, Writable } from 'node:stream'
import { deferred } from '@migaia/utils/promise'
import { expect, it, vi } from 'vitest'
import { RpcBytePump, RpcEventByteIO } from '@migaia/rpc-host/sdk'

it('does not report an explicit byte-pump cleanup rejection again from its cancelled native read', async () => {
  /** Native cancellation resolves the actual pending read while the same close joins writer cleanup. */
  const reader = new ReadableStream<Uint8Array>().getReader()
  /** The original native sink supplies one real cleanup failure. */
  const failure = new Error('native writer abort failed')
  const writer = new WritableStream<Uint8Array>({
    abort() {
      throw failure
    }
  }).getWriter()
  const reports: unknown[] = []
  const io = new RpcBytePump(reader, writer, () => undefined, {
    closedError: () => new Error('byte pump closed'),
    cleanupFailed: (errors) => new AggregateError(errors, 'byte-pump cleanup failed'),
    report: (error) => reports.push(error)
  }).value
  io.onData(() => undefined)
  await Promise.resolve()
  await expect(io.close()).rejects.toMatchObject({ errors: [failure] })
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(reports).toEqual([])
})

it('notifies later close listeners after an earlier listener throws', async () => {
  /** Real paused native streams remain owned by the original IO. */
  const input = new PassThrough({ autoDestroy: false })
  const output = new PassThrough({ autoDestroy: false })
  /** A listener failure must not replace the native terminal delivered to its siblings. */
  const terminal = new Error('terminal before listener failure')
  const failure = new Error('first close listener failed')
  /** Later listeners retain their actual notification order and terminal object. */
  const notified: unknown[] = []
  const io = new RpcEventByteIO(
    input,
    output,
    () => {
      input.pause()
      output.end()
    },
    { closedError: () => terminal, report: () => undefined }
  ).value
  io.onClose(() => {
    throw failure
  })
  io.onClose((reason) => notified.push(reason))
  try {
    await expect(io.close()).rejects.toBe(failure)
    expect(notified).toEqual([terminal])
  } finally {
    input.destroy()
    output.destroy()
  }
})

it('does not resume or retain a data subscription after close', async () => {
  /** Process-style close pauses rather than destroys its acquired input. */
  const input = new PassThrough({ autoDestroy: false })
  const output = new PassThrough({ autoDestroy: false })
  const io = new RpcEventByteIO(
    input,
    output,
    () => {
      input.pause()
      output.end()
    },
    { closedError: () => new Error('closed before subscribe'), report: () => undefined }
  ).value
  await io.close()
  /** The original reader is observed without replacing pause/resume or event delivery. */
  const resume = vi.spyOn(input, 'resume')
  try {
    const remove = io.onData(() => expect.unreachable())
    expect(resume).not.toHaveBeenCalled()
    expect(input.isPaused()).toBe(true)
    remove()
  } finally {
    resume.mockRestore()
    input.destroy()
    output.destroy()
  }
})

it('keeps a diagnostic write observer failure separate from native write completion', async () => {
  const input = new PassThrough()
  /** A real Writable retains its original callback until the native operation completes. */
  let complete!: () => void
  const output = new Writable({
    write(_chunk, _encoding, callback) {
      complete = callback
    }
  })
  /** The exact diagnostic failure belongs to reporting rather than the write Promise. */
  const failure = new Error('write observer failed')
  const reports: unknown[] = []
  const io = new RpcEventByteIO(
    input,
    output,
    () => {
      input.destroy()
      output.destroy()
    },
    {
      closedError: () => new Error('observer fixture closed'),
      report: (error) => reports.push(error)
    }
  ).value
  io.onWrite(() => {
    throw failure
  })
  /** Observe rejection immediately, while letting the genuine native callback settle its write. */
  const sending = io.write(Uint8Array.of(1)).then(
    () => ({ ok: true }),
    (error: unknown) => ({ error })
  )
  try {
    complete()
    expect(await sending).toEqual({ ok: true })
    expect(reports).toEqual([failure])
  } finally {
    await io.close()
  }
})

it('preserves paused delivery, original terminal replay and physical-close-before-listeners ordering', async () => {
  /** Native readable state, rather than a second byte queue, owns paused chunks. */
  const input = new PassThrough()
  /** The native writer is acquired separately from the held reader. */
  const output = new PassThrough()
  /** The caller supplies its exact package-owned EOF error. */
  const closed = new Error('fixture closed')
  /** Original operations independently prove cleanup order and single physical retirement. */
  const order: string[] = []
  /** Background cleanup reports are separate from original close notification. */
  const reports: unknown[] = []
  /** The single SDK owner borrows only the two successfully acquired native ports. */
  const io = new RpcEventByteIO(
    input,
    output,
    () => {
      order.push('physical')
      input.destroy()
      output.destroy()
    },
    { closedError: () => closed, report: (error) => reports.push(error) }
  ).value
  expect(input.isPaused()).toBe(true)
  /** Original deliveries retain the native chunk identity. */
  const delivered: Uint8Array[] = []
  /** Removing the last subscriber restores native pause. */
  const remove = io.onData((chunk) => delivered.push(chunk))
  expect(input.isPaused()).toBe(false)
  /** Direct native emission isolates delivery identity from Node's optional Buffer conversion. */
  const chunk = Uint8Array.of(1, 2)
  input.emit('data', chunk)
  expect(delivered).toEqual([chunk])
  expect(delivered[0]).toBe(chunk)
  remove()
  expect(input.isPaused()).toBe(true)
  /** The exact shared close Promise is observable even from a synchronous close callback. */
  let reentrant: Promise<void> | undefined
  io.onClose((reason) => {
    expect(reason).toBe(closed)
    order.push('listener')
    reentrant = io.close()
  })
  input.emit('end')
  /** Native EOF and explicit close join the same original physical retirement. */
  const closing = io.close()
  expect(reentrant).toBe(closing)
  expect(io.close()).toBe(closing)
  await closing
  expect(order).toEqual(['physical', 'listener'])
  io.onClose((reason) => expect(reason).toBe(closed))
  await expect(io.write(chunk)).rejects.toBe(closed)
  expect(reports).toEqual([])
})

it('keeps native callback settlement separate from an actual false-write drain', async () => {
  /** A genuine one-byte high-water mark exercises Node's own false/drain behavior. */
  const input = new PassThrough()
  /** The physical callback remains pending until this original native operation is released. */
  const entered = deferred<void>()
  /** Node's original write completion callback is held without changing its identity or result. */
  let complete: (() => void) | undefined
  /** The same original buffer reaches the actual native writer. */
  const written: Uint8Array[] = []
  /** Native backpressure is produced by the real Writable implementation. */
  const output = new Writable({
    highWaterMark: 1,
    write(chunk, _encoding, callback) {
      written.push(chunk)
      complete = callback
      entered.resolve()
    }
  })
  /** No synthetic carrier/probe event substitutes for native write observation. */
  const io = new RpcEventByteIO(
    input,
    output,
    () => {
      input.destroy()
      output.destroy()
    },
    { closedError: () => new Error('fixture closed'), report: () => undefined }
  ).value
  /** The original false-write drain is recorded once after actual callback settlement. */
  const drains: number[] = []
  /** Reusing the same observer function must still produce a distinct installation identity. */
  const observe = (_chunk: Uint8Array, drainMs: number): void => {
    drains.push(drainMs)
  }
  /** A stale remover may not retire the current observation installation. */
  const stale = io.onWrite(observe)
  /** This is the actual active observer until explicit release. */
  const release = io.onWrite(observe)
  stale()
  /** Promise completion is independently observed before the native callback is released. */
  let settled = false
  /** At least one native byte makes Node's high-water mark return false. */
  const sending = io.write(Uint8Array.of(3)).then(() => {
    settled = true
  })
  await entered.promise
  expect(output.writableNeedDrain).toBe(true)
  expect(written).toEqual([Buffer.from([3])])
  expect(settled).toBe(false)
  expect(drains).toEqual([])
  complete!()
  await sending
  expect(settled).toBe(true)
  expect(drains).toHaveLength(1)
  expect(drains[0]).toBeGreaterThan(0)
  release()
  release()
  await io.close()
})

it('retires obsolete drain listeners without changing original native errors or close identity', async () => {
  /** Native streams own the original error and drain events. */
  const input = new PassThrough()
  /** The original pending callback can outlive observer retirement. */
  let complete: ((error?: Error | null) => void) | undefined
  /** Native callback failure must remain the same instance through write rejection. */
  const failure = new Error('native write failed')
  /** A real Writable supplies false-write and native error delivery. */
  const output = new Writable({
    highWaterMark: 1,
    write(_chunk, _encoding, callback) {
      complete = callback
    }
  })
  /** Explicit close still joins physical retirement after a native failure. */
  const physical = vi.fn()
  /** The original terminal event remains visible through the byte port. */
  const terminal: unknown[] = []
  /** Native cleanup remains caller-owned and is not replaced by a generic error wrapper. */
  const io = new RpcEventByteIO(input, output, physical, {
    closedError: () => new Error('fixture closed'),
    report: () => undefined
  }).value
  io.onClose((reason) => terminal.push(reason))
  /** Retiring the exact observer releases the real native drain callback. */
  const remove = io.onWrite(() => expect.unreachable())
  /** Catch before native completion so its error identity is observed without a detached loser. */
  const sending = io.write(Uint8Array.of(4)).catch((error: unknown) => error)
  expect(output.listenerCount('drain')).toBe(1)
  remove()
  expect(output.listenerCount('drain')).toBe(0)
  complete!(failure)
  expect(await sending).toBe(failure)
  await new Promise<void>((resolve) => setImmediate(resolve))
  expect(terminal).toEqual([failure])
  expect(terminal[0]).toBe(failure)
  expect(io.close()).toBe(io.close())
  await io.close()
  expect(physical).toHaveBeenCalledTimes(1)
})

it.each([false, true])(
  'releases retained stdio listeners after native end settles its pending write (failure=%s)',
  async (failed) => {
    /** Process stdin remains a live native resource after the IO owner pauses it. */
    const input = new PassThrough({ autoDestroy: false })
    /** An unrelated native subscriber must survive removal of only the IO owner's callbacks. */
    const external = vi.fn()
    input.on('data', external)
    /** Native stdout keeps its original queued write until its actual callback completes. */
    let complete: ((error?: Error | null) => void) | undefined
    /** Auto-destroy false preserves the same end/finish grace used by retained process stdio. */
    const output = new Writable({
      autoDestroy: false,
      highWaterMark: 1,
      write(_chunk, _encoding, callback) {
        complete = callback
      }
    })
    /** Explicit close and the later native write failure retain their separate original identities. */
    const closed = new Error('retained stdio closed')
    /** Native callback failure is also the original later Writable error event. */
    const failure = new RangeError('retained stdio write failed')
    /** This is the actual Process stdio cleanup shape: pause stdin and end stdout without destroy. */
    const physical = vi.fn(() => {
      input.pause()
      output.end()
    })
    /** One SDK owner borrows the real Node streams without another IO adapter or listener registry. */
    const io = new RpcEventByteIO(input, output, physical, {
      closedError: () => closed,
      report: () => undefined
    }).value
    /** A genuine false write also proves that close removes its obsolete diagnostic drain receipt. */
    io.onWrite(() => undefined)
    /** The caller observes the original native callback even when it completes after close. */
    const sending = io.write(Uint8Array.of(5)).catch((error: unknown) => error)
    try {
      expect(output.listenerCount('drain')).toBe(1)
      /** Repeated closes keep their original completion identity while native end is still flushing. */
      const closing = io.close()
      expect(io.close()).toBe(closing)
      await closing
      expect(physical).toHaveBeenCalledTimes(1)
      expect(input.destroyed).toBe(false)
      expect(input.isPaused()).toBe(true)
      expect(input.listeners('data')).toEqual([external])
      expect(input.listenerCount('end')).toBe(0)
      expect(input.listenerCount('error')).toBe(0)
      expect(output.listenerCount('drain')).toBe(0)
      /** Error handling remains installed only through this real pending native flush. */
      expect(output.listenerCount('error')).toBe(1)
      expect(output.listenerCount('close')).toBe(1)
      expect(output.listenerCount('finish')).toBe(1)
      /** The original native callback determines success/failure without replacing its error. */
      const settle = complete!
      complete = undefined
      settle(failed ? failure : undefined)
      expect(await sending).toBe(failed ? failure : closed)
      /** Node emits error or finish after the write callback; neither is a fabricated close receipt. */
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(output.listenerCount('error')).toBe(0)
      expect(output.listenerCount('close')).toBe(0)
      expect(output.listenerCount('finish')).toBe(0)
      expect(io.close()).toBe(closing)
      expect(physical).toHaveBeenCalledTimes(1)
    } finally {
      complete?.()
      await sending
      await io.close()
      input.off('data', external)
      input.destroy()
      output.destroy()
    }
  }
)
