import type { IRpcCarrierWriteOptions } from '@migaia/rpc-contract/interfaces'
/** A complete supported byte port delivers the original bytes and owns its actual close callbacks. */
export function duplex() {
  /** Each side has one physical stream and an independent release counter. */
  const states = [0, 1].map(() => ({
    data: new Set<(bytes: Uint8Array) => void>(),
    close: new Set<(reason?: unknown) => void>(),
    queued: [] as Uint8Array[],
    closed: false,
    closes: 0
  }))
  /** Writes remain ordered and retain bytes until the opposite side installs its reader. */
  const ports = states.map((state, index) => ({
    kind: 'byte' as const,
    async write(bytes: Uint8Array, options?: IRpcCarrierWriteOptions) {
      options?.onWriteStart?.()
      const other = states[1 - index]!
      other.queued.push(bytes.slice())
      await Promise.resolve()
      if (other.data.size)
        for (const bytes of other.queued.splice(0))
          for (const listener of other.data) listener(bytes)
    },
    onData(listener: (bytes: Uint8Array) => void) {
      state.data.add(listener)
      queueMicrotask(() => {
        if (state.data.has(listener)) for (const bytes of state.queued.splice(0)) listener(bytes)
      })
      return () => {
        state.data.delete(listener)
      }
    },
    onClose(listener: (reason?: unknown) => void) {
      state.close.add(listener)
      return () => {
        state.close.delete(listener)
      }
    },
    async close() {
      if (state.closed) return
      state.closes++
      state.closed = true
      for (const listener of state.close) listener()
    }
  }))
  return {
    states,
    ports,
    close() {
      for (const port of ports) port.close()
    }
  }
}
/** Check the actual cause/errors graph without reading or printing its message or credentials. */
export function reaches(value: unknown, target: unknown, seen = new Set<unknown>()): boolean {
  if (value === target) return true
  if (!value || typeof value !== 'object' || seen.has(value)) return false
  seen.add(value)
  const error = value as { cause?: unknown; errors?: unknown[] }
  return (
    reaches(error.cause, target, seen) ||
    (Array.isArray(error.errors) && error.errors.some((child) => reaches(child, target, seen)))
  )
}
