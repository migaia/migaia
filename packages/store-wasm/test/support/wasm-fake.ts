// Dependency-free stand-in for the `@migaia/wasm` package's public surface, backed by a REAL
// WebAssembly.Memory. This package (store-wasm) only owns the TS wrapper layer — the Rust/WASM
// build lives in the separate packages/wasm package and is out of scope here. What we DO own is
// arena.ts's init/allocator caching and field.ts/number.ts/etc.'s byte packing — both are best
// verified against a real WebAssembly.Memory (real DataView/Float64Array/endianness), so only the
// allocator handshake (alloc_bytes/dealloc_bytes/ptr_of, async init) is faked; everything that
// touches memory bytes runs for real.
export type IWasmFakeControl = {
  /** Clear allocations and init-call bookkeeping between tests; keeps the same Memory instance. */
  reset(): void
  /** Make the _next_ alloc_bytes call return a ptr that is 1 byte off 8-byte alignment. */
  misalignNext(): void
  /** Queue a one-shot replacement for the next initWasm() call (e.g. a rejection). */
  queueInit(result: () => Promise<{ memory: WebAssembly.Memory }>): void
  readonly initCallCount: number
  readonly memory: WebAssembly.Memory
}

export function createWasmModuleMock(): {
  default: () => Promise<{ memory: WebAssembly.Memory }>
  alloc_bytes: (byteLen: number) => number
  dealloc_bytes: (id: number) => boolean
  ptr_of: (id: number) => number
  __control: IWasmFakeControl
} {
  const memory = new WebAssembly.Memory({ initial: 1 })
  let bump = 8 // keep 0 unused so ptr=0 stays an unambiguous "no allocation" sentinel
  let nextId = 1
  const table = new Map<number, number>() // id -> ptr
  let ptrOffsetOverride = 0
  const initQueue: Array<() => Promise<{ memory: WebAssembly.Memory }>> = []
  let initCalls = 0

  function ensureCapacity(byteEnd: number) {
    const pageSize = 65536
    const havePages = memory.buffer.byteLength / pageSize
    const needPages = Math.ceil(byteEnd / pageSize)
    if (needPages > havePages) memory.grow(needPages - havePages)
  }

  function alloc_bytes(byteLen: number): number {
    const base = bump
    const ptr = base + ptrOffsetOverride
    ptrOffsetOverride = 0
    const aligned = (byteLen + 7) & ~7
    // Advance from `base`, not `ptr`: a deliberate misalignment (test-only) must not drag every
    // later allocation off-grid, mirroring the real allocator's "always 8-byte aligned" contract.
    bump = base + Math.max(aligned, 8)
    ensureCapacity(Math.max(bump, ptr + byteLen))
    const id = nextId++
    table.set(id, ptr)
    return id
  }
  function dealloc_bytes(id: number): boolean {
    return table.delete(id)
  }
  function ptr_of(id: number): number {
    return table.get(id) ?? 0
  }
  async function initWasm(): Promise<{ memory: WebAssembly.Memory }> {
    initCalls++
    const next = initQueue.shift()
    if (next) return next()
    return { memory }
  }

  const control: IWasmFakeControl = {
    reset() {
      bump = 8
      nextId = 1
      table.clear()
      ptrOffsetOverride = 0
      initQueue.length = 0
      initCalls = 0
    },
    misalignNext() {
      ptrOffsetOverride = 1
    },
    queueInit(result) {
      initQueue.push(result)
    },
    get initCallCount() {
      return initCalls
    },
    get memory() {
      return memory
    }
  }

  return { default: initWasm, alloc_bytes, dealloc_bytes, ptr_of, __control: control }
}
