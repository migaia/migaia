import type { ICaseDoc, IText } from './contract.js'

/** Keeps task descriptions and runnable examples in both site languages. */
const t = (en: string, zh: string): IText => ({ en, zh })

/** Scenarios preserve the separate ownership of arena bytes and conversion metadata. */
export const wasmCases: Readonly<Record<string, readonly ICaseDoc[]>> = {
  __wbg_init: [
    {
      title: t(
        'Share one arena when two features start together',
        '两个功能同时启动时共享同一份内存'
      ),
      problem: t(
        'Two features start together and both initialize the module before either has received its exports. They need subsequent allocations to address the same memory.\n\nPublishing whichever instance finishes last can replace the instance already returned to one feature. That feature then holds memory different from the memory used by the named wrapper functions.\n\nThe initializer publishes the first completed exports and returns that published object from every completed call. Start both calls with the module bytes, then use either returned exports or the named functions to access the same arena.',
        '两个功能同时启动，在拿到导出之前都发起了初始化。它们随后分配的字节需要属于同一份内存。\n\n如果每次都发布最后完成的实例，后一次初始化就可能替换已经返回给某个功能的实例。这个功能持有的内存会与具名函数使用的内存分离。\n\n初始化器只发布第一份完成初始化的导出，所有完成的调用都返回该对象。将模块字节交给两个初始化调用，再通过返回的导出或具名函数访问同一个字节暂存区。'
      ),
      example: {
        en: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const bytes = await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm')))
const [first, second] = await Promise.all([
  init({ module_or_path: bytes }),
  init({ module_or_path: bytes })
])
const id = alloc_bytes(8)
if (id === 0) throw new Error('allocation failed')
try {
  console.log('same exports:', first === second)
  console.log('same allocation:', first.byte_len_of(id) === byte_len_of(id))
} finally {
  dealloc_bytes(id)
}`,
        zh: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const bytes = await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm')))
const [first, second] = await Promise.all([
  init({ module_or_path: bytes }),
  init({ module_or_path: bytes })
])
const id = alloc_bytes(8)
if (id === 0) throw new Error('分配失败')
try {
  console.log('同一导出:', first === second)
  console.log('同一分配:', first.byte_len_of(id) === byte_len_of(id))
} finally {
  dealloc_bytes(id)
}`
      },
      result: t(
        'Prints `same exports: true` and `same allocation: true`.\n\nBoth initialization results and the named allocator address the same published arena. This does not promise one compilation or identical Promises. The example passes bytes because Node cannot fetch the default sibling WASM file URL; omitting module_or_path requests that default resource URL.',
        '输出 `同一导出: true` 和 `同一分配: true`。\n\n两个初始化结果和具名分配函数使用同一个已发布的字节暂存区，但这不表示只编译一次，也不承诺返回同一个 Promise。本例传入字节，因为 Node 无法 fetch 默认的同目录 WASM 文件 URL；省略 module_or_path 则请求该默认资源 URL。'
      )
    }
  ],
  alloc_bytes: [
    {
      title: t('Store numeric readings without guessing alignment', '不用猜内存对齐就能存数值读数'),
      problem: t(
        'A numeric-data import creates a Float64Array over allocated bytes and gets a RangeError even though a Uint8Array worked at the same offset.\n\nA byte view accepts an arbitrary byte offset, but a Float64Array requires eight-byte alignment. A handwritten allocator must align the starting address and round capacity separately to fit whole values.\n\nalloc_bytes provides zero-filled storage with an eight-byte-aligned address and rounded capacity. Request nine bytes, obtain the offset with ptr_of, and use the reported capacity to hold two Float64 values.',
        '导入数值数据时，同一个偏移能创建 Uint8Array，换成 Float64Array 却抛出了 RangeError。\n\n字节视图接受任意字节偏移，Float64Array 则要求地址按八字节对齐。手写分配器必须分别处理起始地址对齐和容量取整，才能容纳完整的数值。\n\nalloc_bytes 提供清零、地址按八字节对齐且容量取整的空间。申请九字节后，用 ptr_of 取得偏移，并根据实际容量存放两个 Float64 数值。'
      ),
      example: {
        en: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const id = alloc_bytes(9)
if (id === 0) throw new Error('allocation failed')
try {
  const values = new Float64Array(wasm.memory.buffer, ptr_of(id), 2)
  values.set([21.5, 23])
  console.log('capacity:', byte_len_of(id))
  console.log('alignment remainder:', ptr_of(id) % 8)
  console.log('readings:', values[0], values[1])
} finally {
  dealloc_bytes(id)
}`,
        zh: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const id = alloc_bytes(9)
if (id === 0) throw new Error('分配失败')
try {
  const values = new Float64Array(wasm.memory.buffer, ptr_of(id), 2)
  values.set([21.5, 23])
  console.log('容量:', byte_len_of(id))
  console.log('对齐余数:', ptr_of(id) % 8)
  console.log('读数:', values[0], values[1])
} finally {
  dealloc_bytes(id)
}`
      },
      result: t(
        'Prints `capacity: 16`, `alignment remainder: 0` and `readings: 21.5 23`.\n\nThe rounded allocation fits two Float64 values and satisfies the native view’s alignment requirement. The requested size is not necessarily the returned capacity. Allocation failure returns ID 0; a successful ID remains caller-owned until dealloc_bytes releases it.',
        '输出 `容量: 16`、`对齐余数: 0` 和 `读数: 21.5 23`。\n\n取整后的分配可以容纳两个浮点数，指针符合原生数值视图的对齐要求。请求大小不一定等于实际容量；分配失败返回 id 0，成功分配则由调用方持有，直到调用 dealloc_bytes 释放。'
      )
    }
  ],
  ptr_of: [
    {
      title: t('Read the same allocation after memory grows', '内存增长后继续读取同一块分配'),
      problem: t(
        'A feature caches a numeric view, then finds its byte length is zero after another operation grows WebAssembly memory. The data is still allocated, but the cached view can no longer read it.\n\nKeeping the original pointer does not keep the original ArrayBuffer alive. Growth of non-shared WebAssembly memory detaches that buffer, so a view created from it becomes stale even when the live allocation stays at the same offset.\n\nKeep the allocation ID and query ptr_of when constructing a view from the current memory.buffer. The example grows memory explicitly, then rebuilds the view before reading the same allocation.',
        '某个功能缓存了数值视图，另一次操作增长 WebAssembly 内存后，却发现旧视图的字节长度变成了零。数据仍然分配着，旧视图却读不到它。\n\n保存原指针不能让原来的 ArrayBuffer 一直有效。非共享 WebAssembly 内存增长会让旧缓冲失效，因此即使活动分配仍在同一偏移，基于旧缓冲创建的视图也会过期。\n\n保留分配 id，在创建视图时查询 ptr_of，并使用当前 memory.buffer。本例显式增长内存，再重建视图，继续读取同一块分配。'
      ),
      example: {
        en: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const id = alloc_bytes(8)
if (id === 0) throw new Error('allocation failed')
try {
  const offset = ptr_of(id)
  const previous = new Float64Array(wasm.memory.buffer, offset, 1)
  previous[0] = 42
  wasm.memory.grow(1)
  const current = new Float64Array(wasm.memory.buffer, ptr_of(id), 1)
  console.log('same offset:', ptr_of(id) === offset)
  console.log('old view bytes:', previous.byteLength)
  console.log('current reading:', current[0])
} finally {
  dealloc_bytes(id)
}`,
        zh: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const id = alloc_bytes(8)
if (id === 0) throw new Error('分配失败')
try {
  const offset = ptr_of(id)
  const previous = new Float64Array(wasm.memory.buffer, offset, 1)
  previous[0] = 42
  wasm.memory.grow(1)
  const current = new Float64Array(wasm.memory.buffer, ptr_of(id), 1)
  console.log('偏移未变:', ptr_of(id) === offset)
  console.log('旧视图字节数:', previous.byteLength)
  console.log('当前读数:', current[0])
} finally {
  dealloc_bytes(id)
}`
      },
      result: t(
        'Prints `same offset: true`, `old view bytes: 0` and `current reading: 42`.\n\nThe live allocation retains its offset and data while growth detaches the old non-shared buffer. Rebuild views after operations that may grow memory. Pointer stability lasts only while the ID is live; after dealloc_bytes, that ID no longer provides readable storage.',
        '输出 `偏移未变: true`、`旧视图字节数: 0` 和 `当前读数: 42`。\n\n活动分配保留了偏移和数据，内存增长则使旧的非共享缓冲失效。可能增长内存的操作之后应重建视图；指针稳定只适用于仍然活动的 id，dealloc_bytes 释放后，该 id 不再提供可读取的空间。'
      )
    }
  ],
  dealloc_bytes: [
    {
      title: t(
        'Keep a JavaScript copy after releasing WASM bytes',
        '释放 WASM 字节后保留 JavaScript 副本'
      ),
      problem: t(
        'An upload queue keeps bytes after the task that produced them has finished and released its allocation. A later allocation can then change the queued payload.\n\nA Uint8Array view shares the arena buffer rather than owning a copy. Releasing its block while retaining the view leaves the queue pointing at storage that can be reused. Releasing only conversion metadata also leaves byte allocations behind.\n\nCopy the needed bytes with slice before calling dealloc_bytes, then hand the JavaScript-owned copy to the queue. Release byte IDs separately from conversion metadata; calling dealloc_bytes again for the released ID returns false.',
        '上传队列仍需读取字节，产生数据的任务却已经结束并释放了分配。后续分配可能改写队列中的待上传内容。\n\nUint8Array 视图与字节暂存区共享缓冲，并没有自己的副本。释放字节块后继续持有视图，就仍指向可被复用的空间；只释放转码元数据则又会遗漏字节分配。\n\n先用 slice 复制需要的字节，再调用 dealloc_bytes，把 JavaScript 自有的副本交给队列。字节 id 与转码元数据分别释放，对已经释放的 id 再次调用 dealloc_bytes 会返回 false。'
      ),
      example: {
        en: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const id = alloc_bytes(3)
if (id === 0) throw new Error('allocation failed')
try {
  const view = new Uint8Array(wasm.memory.buffer, ptr_of(id), 3)
  view.set([1, 2, 3])
  const ownedCopy = view.slice()
  console.log('release:', dealloc_bytes(id), dealloc_bytes(id))
  console.log('copy:', ownedCopy.join(','))
  console.log('released queries:', ptr_of(id), byte_len_of(id))
} finally {
  dealloc_bytes(id)
}`,
        zh: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, byte_len_of, dealloc_bytes } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const id = alloc_bytes(3)
if (id === 0) throw new Error('分配失败')
try {
  const view = new Uint8Array(wasm.memory.buffer, ptr_of(id), 3)
  view.set([1, 2, 3])
  const ownedCopy = view.slice()
  console.log('释放:', dealloc_bytes(id), dealloc_bytes(id))
  console.log('副本:', ownedCopy.join(','))
  console.log('已释放的查询:', ptr_of(id), byte_len_of(id))
} finally {
  dealloc_bytes(id)
}`
      },
      result: t(
        'Prints `release: true false`, `copy: 1,2,3` and `released queries: 0 0`.\n\nThe independent JavaScript copy survives release, and the released ID returns zero from ptr_of and byte_len_of. A second release returns false without releasing another live block. dealloc_bytes owns only byte cleanup; ConversionResult.free releases metadata and does not replace it.',
        '输出 `释放: true false`、`副本: 1,2,3` 和 `已释放的查询: 0 0`。\n\n独立的 JavaScript 副本在释放后仍可读取，已释放 id 的 ptr_of 和 byte_len_of 都返回零。第二次释放返回 false，不会释放另一块活动分配。dealloc_bytes 只清理字节；ConversionResult.free 清理元数据，不能代替字节释放。'
      )
    }
  ],
  json_to_msgpack: [
    {
      title: t(
        'Retain two conversions without a shared last-result slot',
        '保留两次转码结果而不互相覆盖'
      ),
      problem: t(
        'A batch exporter starts its second conversion before reading metadata from the first. It still needs each archive’s output ID and length.\n\nA global last-result slot is overwritten by the next call. Reading it after the second conversion can associate the second archive’s bytes with the first archive’s work.\n\nEach json_to_msgpack call returns a separate ConversionResult containing its output ID, exact length and error. Keep both result objects, inspect each one independently, then release each output and metadata object.',
        '批量导出尚未读取第一次转码的元数据，就开始了第二次转码。两份存档仍分别需要自己的输出 id 和长度。\n\n全局“上一次结果”会被后续调用覆盖。第二次转码后再读取它，就可能把第二份存档的字节归给第一次任务。\n\n每次 json_to_msgpack 都返回独立的 ConversionResult，其中包含输出 id、精确长度和错误。保留两个结果对象，分别检查，再分别释放各自的输出与元数据。'
      ),
      example: {
        en: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes, json_to_msgpack, type ConversionResult } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const inputs: number[] = []
const results: ConversionResult[] = []
try {
  for (const json of ['{"first":true}', '{"second":true}']) {
    const bytes = new TextEncoder().encode(json)
    const id = alloc_bytes(bytes.length)
    if (id === 0) throw new Error('allocation failed')
    inputs.push(id)
    new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
    results.push(json_to_msgpack(id, bytes.length))
  }
  console.log('both succeeded:', results.every((result) => result.id !== 0 && result.error === ''))
  console.log('separate outputs:', results[0].id !== results[1].id)
  console.log('first result retained:', results[0].len > 0)
} finally {
  for (const result of results) {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
  for (const id of inputs) dealloc_bytes(id)
}`,
        zh: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes, json_to_msgpack, type ConversionResult } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const inputs: number[] = []
const results: ConversionResult[] = []
try {
  for (const json of ['{"first":true}', '{"second":true}']) {
    const bytes = new TextEncoder().encode(json)
    const id = alloc_bytes(bytes.length)
    if (id === 0) throw new Error('分配失败')
    inputs.push(id)
    new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
    results.push(json_to_msgpack(id, bytes.length))
  }
  console.log('都成功:', results.every((result) => result.id !== 0 && result.error === ''))
  console.log('输出各自独立:', results[0].id !== results[1].id)
  console.log('第一个结果仍有效:', results[0].len > 0)
} finally {
  for (const result of results) {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
  for (const id of inputs) dealloc_bytes(id)
}`
      },
      result: t(
        'Prints `both succeeded: true`, `separate outputs: true` and `first result retained: true`.\n\nThe second call does not overwrite the first result, and live successful outputs have separate IDs. Input ownership stays with the caller. The finally block releases successful output IDs, input IDs and metadata independently; result.len is the document length, not rounded capacity.',
        '输出 `都成功: true`、`输出各自独立: true` 和 `第一个结果仍有效: true`。\n\n第二次调用没有覆盖第一个结果，仍活动的成功输出具有独立 id。输入仍归调用方所有；finally 分别释放成功输出、输入和元数据。result.len 表示文档精确长度，不是取整后的容量。'
      )
    },
    {
      title: t(
        'Reject a second document instead of silently dropping it',
        '拒绝尾随第二个文档，避免静默丢数据'
      ),
      problem: t(
        'An export concatenation bug places two JSON documents in one input buffer. Treating that buffer as one archive risks losing the second document.\n\nA parser that accepts only the first valid prefix can report success while leaving another document unread. The caller then cannot tell that some input was silently discarded.\n\njson_to_msgpack requires exactly one complete JSON document. Pass the full input length; trailing non-whitespace bytes produce a failed ConversionResult, which the caller inspects and frees without surrendering ownership of the input.',
        '导出拼接出错，把两个 JSON 文档放进了同一个输入缓冲。将它当成一份存档处理，就可能丢掉第二个文档。\n\n只接受首个有效前缀的解析方式会报告成功，却没有消费后面的文档。调用方因此无法知道部分输入已被静默丢弃。\n\njson_to_msgpack 要求恰好一个完整 JSON 文档。传入完整输入长度，尾随非空白字节就会得到失败的 ConversionResult；检查并释放该结果时，输入分配仍由调用方持有。'
      ),
      example: {
        en: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes, json_to_msgpack } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const bytes = new TextEncoder().encode('{}{}')
const id = alloc_bytes(bytes.length)
if (id === 0) throw new Error('allocation failed')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
  const result = json_to_msgpack(id, bytes.length)
  try {
    console.log('output allocation:', result.id, 'bytes:', result.len)
    console.log('second document rejected:', result.error.startsWith('json to msgpack failed:'))
    console.log('input still owned:', ptr_of(id) !== 0)
    if (result.id !== 0) dealloc_bytes(result.id)
  } finally {
    result.free()
  }
} finally {
  dealloc_bytes(id)
}`,
        zh: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, ptr_of, dealloc_bytes, json_to_msgpack } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const bytes = new TextEncoder().encode('{}{}')
const id = alloc_bytes(bytes.length)
if (id === 0) throw new Error('分配失败')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), bytes.length).set(bytes)
  const result = json_to_msgpack(id, bytes.length)
  try {
    console.log('输出分配:', result.id, '字节数:', result.len)
    console.log('拒绝第二个文档:', result.error.startsWith('json to msgpack failed:'))
    console.log('输入仍归调用方:', ptr_of(id) !== 0)
    if (result.id !== 0) dealloc_bytes(result.id)
  } finally {
    result.free()
  }
} finally {
  dealloc_bytes(id)
}`
      },
      result: t(
        'Prints `output allocation: 0 bytes: 0`, `second document rejected: true` and `input still owned: true`.\n\nThe complete-input check rejects the second document and leaves no output allocation. Whitespace after a single JSON document is allowed; another document is not. The caller still releases the input and the failed result’s metadata.',
        '输出 `输出分配: 0 字节数: 0`、`拒绝第二个文档: true` 和 `输入仍归调用方: true`。\n\n完整输入检查拒绝了第二个文档，没有留下输出分配。单个 JSON 文档之后允许空白，不允许另一个文档；调用方仍须释放输入与失败结果的元数据。'
      )
    }
  ],
  msgpack_to_json: [
    {
      title: t('Decode only the received MessagePack bytes', '只解码收到的 MessagePack 字节'),
      problem: t(
        'A received five-byte MessagePack document fails to decode even though its bytes are valid. Its arena allocation reports a capacity of eight bytes.\n\nAllocation capacity includes alignment padding. Passing that capacity as the document length feeds padding to a decoder that requires one complete document, creating a trailing-bytes failure.\n\nPass the actual received byte length to msgpack_to_json. Build the JSON output view using result.len rather than byte_len_of, then copy the bytes before releasing the output allocation.',
        '收到的五字节 MessagePack 文档内容有效，却无法解码。它占用的暂存区报告了八字节容量。\n\n分配容量包含对齐填充。把容量当成文档长度，会让要求单个完整文档的解码器继续读取填充字节，产生尾随字节错误。\n\n将实际收到的字节数传给 msgpack_to_json。读取 JSON 输出时使用 result.len，而不是 byte_len_of，并在释放输出分配前复制字节。'
      ),
      example: {
        en: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, ptr_of, dealloc_bytes, msgpack_to_json } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const packed = new Uint8Array([0x81, 0xa2, 0x6f, 0x6b, 0xc3])
const id = alloc_bytes(packed.length)
if (id === 0) throw new Error('allocation failed')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), packed.length).set(packed)
  const result = msgpack_to_json(id, packed.length)
  try {
    if (result.id === 0) throw new Error(result.error)
    const json = new Uint8Array(wasm.memory.buffer, ptr_of(result.id), result.len).slice()
    console.log('document:', new TextDecoder().decode(json))
    console.log('input bytes:', packed.length, 'capacity:', byte_len_of(id))
  } finally {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
} finally {
  dealloc_bytes(id)
}`,
        zh: `import { readFile } from 'node:fs/promises'
import init, { alloc_bytes, byte_len_of, ptr_of, dealloc_bytes, msgpack_to_json } from '@migaia/wasm'

const wasm = await init({ module_or_path: await readFile(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm'))) })
const packed = new Uint8Array([0x81, 0xa2, 0x6f, 0x6b, 0xc3])
const id = alloc_bytes(packed.length)
if (id === 0) throw new Error('分配失败')
try {
  new Uint8Array(wasm.memory.buffer, ptr_of(id), packed.length).set(packed)
  const result = msgpack_to_json(id, packed.length)
  try {
    if (result.id === 0) throw new Error(result.error)
    const json = new Uint8Array(wasm.memory.buffer, ptr_of(result.id), result.len).slice()
    console.log('文档:', new TextDecoder().decode(json))
    console.log('输入字节:', packed.length, '容量:', byte_len_of(id))
  } finally {
    if (result.id !== 0) dealloc_bytes(result.id)
    result.free()
  }
} finally {
  dealloc_bytes(id)
}`
      },
      result: t(
        'Prints `document: {"ok":true}` and `input bytes: 5 capacity: 8`.\n\nThe decoder consumes the five supplied document bytes rather than the eight-byte allocation capacity. A buffer containing another MessagePack value or padding must not be passed as one document. Release the successful output bytes, result metadata and input bytes separately.',
        '输出 `文档: {"ok":true}` 和 `输入字节: 5 容量: 8`。\n\n解码器只消费传入的五个文档字节，没有把八字节分配容量当成文档长度。包含另一个 MessagePack 值或填充的缓冲不能整体当作一个文档传入；成功输出字节、结果元数据和输入字节分别释放。'
      )
    }
  ]
}
