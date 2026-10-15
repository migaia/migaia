/** One live DataView per native memory; replaced only after its backing buffer changes. */
const views = new WeakMap<WebAssembly.Memory, DataView>()

/** Reads the current native buffer without caching any field value or writable version. */
export function memoryView(memory: WebAssembly.Memory): DataView {
  /** Reuse the last buffer view while native memory identity remains stable. */
  const existing = views.get(memory)
  if (existing?.buffer === memory.buffer) return existing
  /** Growth invalidates the old view but leaves field offsets unchanged. */
  const current = new DataView(memory.buffer)
  views.set(memory, current)
  return current
}
