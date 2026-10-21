/**
 * Reference checked against rust/src/lib.rs and generated wasm_provider.{js,d.ts} on 2026-10-18.
 * Source corrections to README/USEGUIDE examples: ConversionResult is a wasm-bindgen allocation
 * separate from the arena output; free its metadata with free()/Symbol.dispose as well as freeing
 * input/output IDs with dealloc_bytes. InitOutput conversion functions return raw pointers, not
 * ConversionResult objects. Underscore-prefixed ABI internals remain owned by generated glue.
 */
import type { ILibraryReference, IMemberDoc, IText } from './contract.js'
import { wasmCases } from './wasm-cases.js'

/** Keeps documentation text in both supported locales. */
const t = (en: string, zh: string): IText => ({ en, zh })
/** Each property explains ownership independently of its declaration. */
const p = (en: string, zh: string): IMemberDoc => ({ summary: t(en, zh) })
/** Arena identifier source shared by the byte operations. */
const id = t(
  'Live allocation identifier returned by `alloc_bytes` or a successful `ConversionResult.id`, in this initialized module.',
  '同一已初始化模块中，来自 `alloc_bytes` 或成功 `ConversionResult.id` 的活动分配标识。'
)
/** Conversion lengths are exact payload lengths, not rounded arena capacity. */
const len = t(
  'Exact number of input bytes written by the application, no greater than `byte_len_of(id)`; rounded capacity is not a document length.',
  '应用实际写入的精确输入字节数，不得超过 `byte_len_of(id)`；取整容量不是文档长度。'
)
/** Complete conversion examples initialize from bytes in Node and release both ownership kinds. */
const conversionExample = wasmCases.json_to_msgpack[0].example
/** MessagePack decoding uses the received byte count rather than rounded arena capacity. */
const roundtripExample = wasmCases.msgpack_to_json[0].example
/** Initialization used by these examples is explained on every page where it appears. */
const initializationNote = t(
  'The example reads the bundled WASM resource beside the resolved package entry. In `init({ module_or_path: bytes })`, `module_or_path` is that file’s bytes; it also accepts a request string, `Request`, `URL`, `Response`, `BufferSource`, precompiled `WebAssembly.Module`, or a Promise of any of these. Omitting the argument fetches the bundled `wasm_provider_bg.wasm` URL. Node hosts should pass bytes or a module because fetching a local file URL is unsupported.',
  '示例通过解析后的包入口读取相邻的 WASM 资源。`init({ module_or_path: bytes })` 的 `module_or_path` 是该文件的字节；它还接受请求字符串、`Request`、`URL`、`Response`、`BufferSource`、预编译 `WebAssembly.Module` 或这些来源的 Promise。省略参数时获取包内 `wasm_provider_bg.wasm` 网址。Node 不支持获取本地文件网址，应传入字节或模块。'
)
/** Native input choices belong to the host WebAssembly API. */
const initInput = t(
  'Optional initialization argument. Use `{ module_or_path: source }`, where source is `RequestInfo`, `URL`, `Response`, `BufferSource`, a precompiled `WebAssembly.Module`, or `Promise<InitInput>`. Omitting the argument selects the bundled `wasm_provider_bg.wasm` URL; Node should supply bytes or a module instead of fetching a local file URL. Positional input is deprecated.',
  '可选的初始化参数。使用 `{ module_or_path: source }`；来源为 `RequestInfo`、`URL`、`Response`、`BufferSource`、预编译 `WebAssembly.Module` 或 `Promise<InitInput>`。省略参数时默认获取包内 `wasm_provider_bg.wasm` 网址；Node 应提供字节或模块，避免获取本地文件网址。位置参数形式已弃用。'
)
/** Raw result pointers belong to generated glue, unlike stable arena IDs. */
const rawResult = t(
  'Raw result-struct pointer returned by the corresponding `InitOutput` conversion function; never pass an arena allocation identifier here.',
  '对应 `InitOutput` 转码函数返回的原始结果结构指针；此处不能传入字节区分配标识。'
)
/** Byte allocation operation on the raw instance has the same ownership boundary. */
const allocate = {
  ...p(
    'Raw byte allocator taking requested byte count; returns an arena ID, zero on exhaustion. Memory growth requires fresh typed-array views.',
    '原始字节分配函数接收请求字节数；返回字节区标识，耗尽时为零；内存增长后须重新创建视图。'
  ),
  params: {
    a: t('Application-requested unsigned 32-bit byte count.', '应用请求的无符号三十二位字节数量。')
  },
  returns: t(
    'Owned arena ID, or zero on allocation failure.',
    '返回所属字节区标识，分配失败时为零。'
  ),
  example: 'const allocationId = wasm.alloc_bytes(8); wasm.dealloc_bytes(allocationId)'
}
/** Native memory and raw ABI exports are the initialization result, not JS wrapper methods. */
const rawMembers: Record<string, IMemberDoc> = {
  memory: {
    ...p(
      'Native `WebAssembly.Memory` shared with the arena; reread memory.buffer after any call that can allocate or grow memory.',
      '与字节区共享的原生 `WebAssembly.Memory`；任何可能分配或增长内存的调用后，都要重新读取 `memory.buffer`。'
    ),
    example: 'const view = new Uint8Array(wasm.memory.buffer)'
  },
  alloc_bytes: allocate,
  byte_len_of: {
    ...p(
      'Raw capacity query accepting an arena identifier and returning its eight-byte-rounded capacity, or zero for an unknown ID.',
      '原始容量查询接收字节区标识，返回按八字节取整的容量；未知标识返回零。'
    ),
    params: { a: id },
    returns: t(
      'Allocated capacity in bytes, not the encoded document length.',
      '返回已分配容量字节数，不是编码文档长度。'
    ),
    example:
      'const id = wasm.alloc_bytes(9); console.log(wasm.byte_len_of(id)); wasm.dealloc_bytes(id)'
  },
  ptr_of: {
    ...p(
      'Raw arena pointer query returns a stable eight-byte-aligned byte offset until deallocation, or zero for an unknown ID.',
      '原始字节区指针查询返回释放前稳定且八字节对齐的字节偏移；未知标识返回零。'
    ),
    params: { a: id },
    returns: t(
      'Byte offset into current memory, not an arena ID.',
      '返回当前线性内存字节偏移，不是字节区标识。'
    ),
    example: 'const id = wasm.alloc_bytes(8); console.log(wasm.ptr_of(id)); wasm.dealloc_bytes(id)'
  },
  dealloc_bytes: {
    ...p(
      'Raw arena release returns numeric one for a removed live allocation and zero for an absent ID; the named JS wrapper returns boolean.',
      '原始字节区释放在移除活动分配时返回数字一，不存在时返回零；具名脚本包装函数返回布尔值。'
    ),
    params: { a: id },
    returns: t(
      'Numeric native boolean; subsequent release of the same ID returns zero.',
      '返回原生数字布尔值；重复释放相同标识返回零。'
    ),
    example: 'const id = wasm.alloc_bytes(8); console.log(wasm.dealloc_bytes(id))'
  },
  json_to_msgpack: {
    ...p(
      'Raw JSON converter returns a result-struct pointer, unlike the named JS wrapper json_to_msgpack which returns ConversionResult. Prefer the wrapper for owned metadata.',
      '原始文本转码返回结果结构指针，与返回 `ConversionResult` 的具名 `json_to_msgpack` 包装函数不同；所属元数据应优先通过包装函数管理。'
    ),
    params: { a: id, b: len },
    returns: t(
      'Raw metadata pointer managed by generated glue; use the named wrapper for safe metadata access and free().',
      '返回生成胶水管理的原始元数据指针；安全访问及释放应使用具名包装函数。'
    ),
    example: conversionExample
  },
  msgpack_to_json: {
    ...p(
      'Raw MessagePack converter returns a result-struct pointer, unlike the named JS wrapper msgpack_to_json which returns ConversionResult. Prefer the wrapper for metadata ownership.',
      '原始紧凑格式转码返回结果结构指针，与返回 `ConversionResult` 的具名 `msgpack_to_json` 包装函数不同；所属元数据应优先通过包装函数管理。'
    ),
    params: { a: id, b: len },
    returns: t(
      'Raw metadata pointer; the named wrapper constructs and owns its ConversionResult.',
      '返回原始元数据指针；具名包装函数创建并拥有其 `ConversionResult`。'
    ),
    example: roundtripExample
  },
  conversionresult_id: {
    ...p(
      'Raw metadata getter receives a result-struct pointer and returns its output arena ID; use ConversionResult.id instead of handling raw pointers.',
      '原始元数据读取函数接收结果结构指针，返回输出字节区标识；应使用 `ConversionResult.id` 避免直接管理指针。'
    ),
    params: { a: rawResult },
    returns: t(
      'Output arena ID, zero on conversion failure.',
      '返回输出字节区标识，转码失败时为零。'
    ),
    example:
      'const result = json_to_msgpack(inputId, inputLength); try { console.log(result.id) } finally { result.free() }'
  },
  conversionresult_len: {
    ...p(
      'Raw metadata getter receives a result-struct pointer and returns exact output byte length; use ConversionResult.len for normal consumers.',
      '原始元数据读取函数接收结果结构指针，返回精确输出字节数；普通调用方使用 `ConversionResult.len`。'
    ),
    params: { a: rawResult },
    returns: t(
      'Exact output bytes, zero on conversion failure.',
      '返回精确输出字节数，转码失败时为零。'
    ),
    example:
      'const result = json_to_msgpack(inputId, inputLength); try { console.log(result.len) } finally { result.free() }'
  },
  conversionresult_error: {
    ...p(
      'Raw metadata getter copies UTF-8 error text into a temporary allocation and returns pointer/length. Generated glue decodes and frees that temporary; use ConversionResult.error.',
      '原始元数据读取函数把错误文本复制到临时字节区并返回指针和长度；生成胶水负责解码及释放，调用方使用 `ConversionResult.error`。'
    ),
    params: { a: rawResult },
    returns: t(
      'A [bytePointer, byteLength] tuple for generated glue, not a JavaScript string.',
      '返回生成胶水使用的字节指针与长度元组，不是脚本字符串。'
    ),
    example:
      'const result = json_to_msgpack(inputId, inputLength); try { console.log(result.error) } finally { result.free() }'
  }
}

/** Complete public entry documentation, with separate arena and metadata lifetimes. */
export const reference: ILibraryReference = {
  modules: {
    index: {
      summary: t(
        'Initialize the Rust module through its default init import, then allocate aligned bytes or transcode JSON and MessagePack with named JS wrappers. Explicitly release both arena IDs and conversion metadata. Native CompileError/LinkError/RuntimeError pass unchanged without source/code; store-wasm also rethrows them and codes only follow-on INSTANCE_POISONED with the trap on cause.',
        '先通过默认导入初始化编译模块，再用具名包装函数分配对齐字节或转码两种格式；字节区标识与转码元数据都必须显式释放。原生 `CompileError/LinkError/RuntimeError` 原样透传且不附 `source/code`；`store-wasm` 同样重抛原错，仅把后续失败编码为 `INSTANCE_POISONED` 并以原因保留陷阱。'
      ),
      example: conversionExample
    }
  },
  symbols: {
    __wbg_init: {
      role: 'factory',
      purpose: t(
        'Default async initializer imported as init; fetches the bundled wasm asset when omitted, or instantiates application-provided bytes/module. Call before any allocation or conversion. The first completed initialization publishes the exports; concurrent calls return that same memory/arena as named wrappers. Concurrent instantiation may still occur: Promise identity and single compilation are not promised.',
        '默认异步初始化器，以默认导入使用；省略输入时获取包内编译资源，也可实例化应用字节或模块。任何分配及转码前必须完成初始化；首个完成初始化的结果发布导出，并发调用与具名包装函数返回同一内存及字节区；仍可能并发实例化，不承诺同一个 Promise 或只编译一次。'
      ),
      params: { module_or_path: initInput },
      returns: t(
        'Promise of `InitOutput`. Native WebAssembly.CompileError, WebAssembly.LinkError and WebAssembly.RuntimeError cross unchanged without source/code under the registered native pass-through exception. Loading failures reject; the package defines no custom error codes.',
        '返回 `InitOutput` 的 Promise；已登记的原生透传例外使 `WebAssembly.CompileError`、`WebAssembly.LinkError`、`WebAssembly.RuntimeError` 原样越界，不附 `source/code`。加载失败会拒绝，本包未定义自有错误码。'
      ),
      exampleIntro: initializationNote,
      cases: wasmCases.__wbg_init,
      example: wasmCases.__wbg_init[0].example
    },
    initSync: {
      role: 'factory',
      purpose: t(
        'Synchronously initializes from bytes or a precompiled native module without fetching. Use the object input form; already initialized modules return their existing exports.',
        '从字节或预编译原生模块同步初始化，不发起网络获取；使用对象参数形式，已初始化时返回既有导出对象。'
      ),
      params: {
        module: t(
          'Required application `SyncInitInput`, wrapped as `{ module: bytesOrModule }`: bytes or a precompiled `WebAssembly.Module`, with no default and no fetch. Positional bytes/module remain accepted but emit a deprecation warning.',
          '应用提供的必填 `SyncInitInput`，包装为 `{ module: bytesOrModule }`：字节或预编译 `WebAssembly.Module`，没有默认值，不发起获取。位置字节或模块仍可使用，但会输出弃用警告。'
        )
      },
      returns: t(
        'An `InitOutput`; native WebAssembly.CompileError, WebAssembly.LinkError and WebAssembly.RuntimeError retain their type, identity and stack without source/code, as the registered pass-through exception.',
        '返回 `InitOutput`；已登记透传的 `WebAssembly.CompileError`、`WebAssembly.LinkError`、`WebAssembly.RuntimeError` 保持类型、身份与堆栈，不附 `source/code`。'
      ),
      example:
        "import { readFileSync } from 'node:fs'\nimport { initSync } from '@migaia/wasm'\nconst bytes = readFileSync(new URL('./wasm_provider_bg.wasm', import.meta.resolve('@migaia/wasm')))\nconst wasm = initSync({ module: bytes })\nconsole.log(wasm.memory.buffer.byteLength > 0)"
    },
    alloc_bytes: {
      role: 'operation',
      purpose: t(
        'Allocates a zeroed arena buffer, aligned and rounded up to eight bytes. Pair with dealloc_bytes for deterministic ownership; memory growth invalidates old ArrayBuffer views.',
        '分配清零且按八字节对齐、取整的字节区缓冲。搭配 `dealloc_bytes` 确定性管理所有权；内存增长会使旧缓冲视图失效。'
      ),
      params: {
        byte_len: t(
          'Application-requested unsigned 32-bit byte count; actual capacity rounds upward to a multiple of eight.',
          '应用请求的无符号三十二位字节数量；实际容量向上取整为八的倍数。'
        )
      },
      returns: t(
        'A stable nonzero arena ID or zero when memory/identifier space is exhausted. Call dealloc_bytes for every successful allocation, including zero-length allocations.',
        '返回稳定非零字节区标识；内存或标识空间耗尽时返回零。每次成功分配都须释放，包括零长度分配。'
      ),
      exampleIntro: initializationNote,
      cases: wasmCases.alloc_bytes,
      example: wasmCases.alloc_bytes[0].example
    },
    ptr_of: {
      role: 'operation',
      purpose: t(
        'Looks up the byte offset for one live arena ID. Pair with alloc_bytes and initialized memory to construct a fresh typed-array view; offset stability does not preserve an old memory.buffer after growth.',
        '查询活动字节区标识对应的字节偏移。搭配 `alloc_bytes` 和已初始化内存创建新视图；偏移稳定不代表内存增长后旧缓冲仍然可用。'
      ),
      params: { id },
      returns: t(
        'Eight-byte-aligned offset valid until this allocation is released; unknown or dead IDs return zero.',
        '返回释放前有效且八字节对齐的偏移；未知或已释放标识返回零。'
      ),
      exampleIntro: initializationNote,
      cases: wasmCases.ptr_of,
      example: wasmCases.ptr_of[0].example
    },
    byte_len_of: {
      exampleIntro: initializationNote,
      role: 'operation',
      purpose: t(
        'Returns actual rounded arena capacity for a live allocation. Pair with alloc_bytes when sizing numeric views; use ConversionResult.len instead for the exact converted document length.',
        '返回活动分配的实际取整容量。搭配 `alloc_bytes` 计算数值视图大小；精确转码文档长度应读取 `ConversionResult.len`。'
      ),
      params: { id },
      returns: t(
        'Capacity in bytes rounded upward to eight; unknown or dead IDs return zero.',
        '返回向上取整为八倍数的容量字节数；未知或已释放标识返回零。'
      ),
      example: wasmCases.alloc_bytes[0].example
    },
    dealloc_bytes: {
      role: 'operation',
      purpose: t(
        'Releases exactly one arena allocation created by allocation or successful conversion. Pair with alloc_bytes or the conversion result ID; copied JS bytes survive, but views into the released allocation must no longer be used.',
        '释放分配或成功转码创建的一个字节区。搭配 `alloc_bytes` 或转码结果标识使用；复制到脚本的字节仍可保留，但不得继续使用已释放分配的视图。'
      ),
      params: { id },
      returns: t(
        'True if a live allocation was removed, false for zero, unknown or already released IDs; repeated release is harmless.',
        '移除活动分配时返回真；零、未知或已释放标识返回假，重复释放无害。'
      ),
      exampleIntro: initializationNote,
      cases: wasmCases.dealloc_bytes,
      example: wasmCases.dealloc_bytes[0].example
    },
    json_to_msgpack: {
      role: 'operation',
      purpose: t(
        'Synchronously transcodes exactly one UTF-8 JSON document to MessagePack within the arena; trailing JSON whitespace is accepted. Pair with alloc_bytes and dealloc_bytes to own input and output separately. Preservation is limited to JSON data and representable numbers.',
        '在字节区内同步把一个完整 JSON 文档转为 MessagePack，允许尾随空白。搭配 `alloc_bytes` 和 `dealloc_bytes` 分别管理输入与输出；保真范围限于 JSON 数据模型及可表示数值。'
      ),
      params: { id, len },
      returns: t(
        'An owned `ConversionResult`: success has nonzero id, exact len and empty error; invalid ID/length, parsing/trailing-document or allocation failure has id/len zero and error text. Input stays owned by the caller.',
        '返回所属 `ConversionResult`：成功含非零标识、精确长度和空错误；标识或长度非法、解析、多文档及分配失败含零标识、零长度和错误文本。输入仍归调用方。'
      ),
      exampleIntro: initializationNote,
      cases: wasmCases.json_to_msgpack,
      example: wasmCases.json_to_msgpack[0].example
    },
    msgpack_to_json: {
      role: 'operation',
      purpose: t(
        'Synchronously transcodes exactly one MessagePack document to UTF-8 JSON, rejecting any trailing bytes. Pair with dealloc_bytes to release the new output allocation; bin/ext, non-string map keys and out-of-range integers are not promised reversible JSON forms.',
        '同步把一个完整 MessagePack 文档转为 JSON，并拒绝任何尾随字节。搭配 `dealloc_bytes` 释放新输出分配；二进制扩展、非字符串映射键和超范围整数不保证往返可逆。'
      ),
      params: { id, len },
      returns: t(
        'An independently owned `ConversionResult`; zero id/len and error text report failure without throwing a package error. Each successful output and every input remain separately releasable.',
        '返回独立所属 `ConversionResult`；零标识、零长度和错误文本报告失败，不抛包错误。每次成功输出和所有输入分别负责释放。'
      ),
      exampleIntro: initializationNote,
      cases: wasmCases.msgpack_to_json,
      example: wasmCases.msgpack_to_json[0].example
    },
    ConversionResult: {
      exampleIntro: initializationNote,
      role: 'constant',
      purpose: t(
        'Generated metadata class returned by both conversion functions; its constructor is private. It owns the Rust result struct, while its output id names a separate arena allocation that free() does not release.',
        '两个转码函数返回的生成元数据类，构造器不公开；它拥有原生结果结构，而输出标识指向独立字节区，释放元数据不会释放该字节区。'
      ),
      returns: t(
        'An operation-created `ConversionResult` holding this conversion’s id, exact length and error; callers do not construct it directly. Read its fields before `free()` or `[Symbol.dispose]()`, then separately release successful output and input arena IDs with `dealloc_bytes`.',
        '转码操作创建并持有本次标识、精确长度及错误的 `ConversionResult`，调用方不能直接构造。先读取字段，再用 `free()` 或 `[Symbol.dispose]()` 释放元数据；成功输出及输入字节区标识另用 `dealloc_bytes` 释放。'
      ),
      example: conversionExample
    }
  },
  types: {
    ConversionResult: {
      summary: t(
        'One operation-owned metadata object, independent from later conversion results and arena output ownership.',
        '单次操作所属的元数据对象，与后续转码结果及输出字节区所有权相互独立。'
      ),
      scenarios: [
        t(
          'Retain results from interleaved conversions without a shared last-result register.',
          '交错转码时保留各自结果，不依赖共享的上次结果寄存器。'
        )
      ],
      example: conversionExample,
      members: {
        free: {
          summary: t(
            'Releases this Rust metadata struct; first read required fields and separately release arena IDs. Do not read or free the metadata again afterwards.',
            '释放当前原生元数据结构；先读取所需字段并另行释放字节区标识，之后不要再次读取或释放该元数据。'
          ),
          returns: t(
            'The metadata struct is released; input and output arena allocations remain unchanged.',
            '元数据结构已释放；输入和输出字节区分配保持不变。'
          ),
          example: conversionExample
        },
        '[Symbol.dispose]': {
          summary: t(
            'Explicit resource-management alias of free when Symbol.dispose is available; it releases metadata only.',
            '原生释放符号可用时作为 `free` 的显式资源管理别名；只释放元数据。'
          ),
          returns: t(
            'The metadata struct is released; release its successful output ID separately.',
            '元数据结构已释放；成功输出标识须另行释放。'
          ),
          example:
            'const result = json_to_msgpack(inputId, inputLength)\nconst outputId = result.id\nresult[Symbol.dispose]()\nif (outputId !== 0) dealloc_bytes(outputId)'
        },
        id: p(
          'Nonzero output arena ID on success, zero on failure; copy it before metadata free and later release with dealloc_bytes.',
          '成功时为非零输出字节区标识，失败时为零；释放元数据前复制，并稍后用 `dealloc_bytes` 释放。'
        ),
        len: p(
          'Exact output payload bytes on success, zero on failure; never substitute rounded arena capacity.',
          '成功时为精确输出载荷字节数，失败时为零；不能以取整字节区容量替代。'
        ),
        error: p(
          'Empty string on success. Failure is unknown allocation id or length past capacity, arena exhausted, or text prefixed json to msgpack failed:/msgpack to json failed: with parsing details.',
          '成功时为空串；失败表示标识或容量非法、字节区耗尽，或带解析细节的 `json to msgpack failed:`、`msgpack to json failed:` 文本。'
        )
      }
    },
    InitInput: {
      summary: t(
        'Native source accepted by async initialization: request/string, URL, response, bytes or a precompiled module. Request-like sources fetch; other sources instantiate directly.',
        '异步初始化接受的原生来源，包括请求字符串、网址、响应、字节或预编译模块；请求类来源进行获取，其余直接实例化。'
      ),
      members: {}
    },
    SyncInitInput: {
      summary: t(
        'Native bytes or a precompiled WebAssembly.Module supplied by the application to initSync; no fetch-capable sources are accepted.',
        '应用提供给 `initSync` 的原生字节或预编译 `WebAssembly.Module`；不接受需要网络获取的来源。'
      ),
      members: {}
    },
    InitOutput: {
      summary: t(
        'Initialized native exports: memory plus raw numeric ABI functions. Named JS imports wrap metadata pointers and boolean results; prefer those wrappers for normal conversion.',
        '初始化后的原生导出：内存及原始数字接口函数；具名脚本导入包装元数据指针及布尔结果，普通转码优先使用这些包装函数。'
      ),
      scenarios: [
        t(
          'Use the returned native memory to build fresh numeric or byte views around owned arena IDs.',
          '使用返回的原生内存，为所属字节区标识创建新的数值或字节视图。'
        )
      ],
      example: conversionExample,
      members: rawMembers
    }
  },
  enums: {},
  enhancers: {}
}
