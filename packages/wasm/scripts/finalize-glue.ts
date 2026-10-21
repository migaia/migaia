import { readFile, writeFile } from 'node:fs/promises'

/** Wasm-pack owns this generated module; apply the package's initialization rules after generation. */
const path = new URL('../src/wasm_provider.js', import.meta.url)
/** The public declarations receive the same initialization and ownership explanations as the glue. */
const declarationsPath = new URL('../src/wasm_provider.d.ts', import.meta.url)
/** The pinned wasm-bindgen finalizer is the single owner of the glue's published instance. */
const anchor = 'function __wbg_finalize_init(instance, module) {\n'
/** First completed initialization retains the memory already returned to callers and named exports. */
const publication = `${anchor}    // Keep the first published arena when another initialization finishes later.\n    if (wasm !== undefined) return wasm;\n`
/** The generated source is rewritten only when its one known finalization point is present. */
const source = await readFile(path, 'utf8')
/** Declarations remain generator-owned; the existing postprocessor only adds public API prose. */
const declarations = await readFile(declarationsPath, 'utf8')
/** Synchronous initialization accepts local bytes or a compiled module and never fetches a resource. */
const syncDocumentation = `/**
 * Initializes the package synchronously before using its named allocation or conversion functions.
 *
 * Pass an object with a required \`module\` field containing WASM bytes or a compiled
 * \`WebAssembly.Module\`. Passing that value directly is deprecated. This function
 * never fetches a URL. Once initialization succeeds, later calls return the
 * published exports without replacing their memory or reading the new input.
 *
 * @param module - Object containing local bytes or a compiled module; no default.
 * @returns Raw exports whose \`memory\` backs the named JavaScript wrappers.
 * @throws Native compilation, linking, or start errors without wrapping them.
 */`
/**
 * Asynchronous initialization explains the default fetch and the package's existing publication
 * rule.
 */
const asyncDocumentation = `/**
 * Initializes the package before using its named allocation or conversion functions.
 *
 * Pass \`{ module_or_path }\` with bytes, a compiled \`WebAssembly.Module\`, a response,
 * a fetchable request or URL, or a promise for one of those values. Direct inputs
 * are deprecated. Omitting the argument fetches the sibling WASM asset. Hosts
 * without file-URL fetch support must supply bytes or a compiled module.
 *
 * The first completed initialization publishes the exports used by all named
 * wrappers. Concurrent calls may still instantiate separately; they return the
 * same published exports, but do not promise the same Promise object.
 *
 * @param module_or_path - Optional input object; defaults to the sibling WASM asset URL.
 * @returns Raw exports whose \`memory\` backs the named JavaScript wrappers.
 * @throws Rejects with the original fetch, compilation, linking, or start error.
 */`
/** Releasing metadata never transfers or releases the separately owned arena allocation. */
const freeDocumentation = `/**
     * Releases the WASM metadata after reading this result, including failed results.
     * Call once; do not read properties or reuse this wrapper after disposal.
     * Input and output arena allocations remain live until \`dealloc_bytes(id)\`.
     */`
/** Explicit resource management uses exactly the same release operation as free(). */
const disposeDocumentation = `/**
     * Releases this result's metadata when leaving an explicit resource-management scope.
     * This is the same operation as \`free()\`; use one disposal path per result.
     * Input and output arena allocations require separate \`dealloc_bytes(id)\` calls.
     */`
if (source.indexOf(anchor) < 0 || source.indexOf(anchor) !== source.lastIndexOf(anchor)) {
  process.stderr.write(
    'wasm glue finalization point changed; update the build postprocessor before publishing\n'
  )
  process.exitCode = 1
} else {
  await writeFile(
    path,
    source
      .replace(anchor, publication)
      .replace(
        "    if (typeof module_or_path === 'string'",
        "    // Resolve promised inputs before choosing fetch or direct instantiation.\n    module_or_path = await module_or_path;\n\n    if (typeof module_or_path === 'string'"
      )
      .replace('    free() {', `    ${freeDocumentation}\n    free() {`)
      .replace(
        'function initSync(module) {',
        `${syncDocumentation
          .replace(
            '@param module',
            '@param {{ module: BufferSource | WebAssembly.Module } | BufferSource | WebAssembly.Module} module'
          )
          .replace(
            '@returns Raw',
            '@returns {import("./wasm_provider.js").InitOutput} Raw'
          )}\nfunction initSync(module) {`
      )
      .replace(
        'async function __wbg_init(module_or_path) {',
        `${asyncDocumentation
          .replace(
            '@param module_or_path',
            '@param {{ module_or_path: import("./wasm_provider.js").InitInput | Promise<import("./wasm_provider.js").InitInput> } | import("./wasm_provider.js").InitInput | Promise<import("./wasm_provider.js").InitInput>} [module_or_path]'
          )
          .replace(
            '@returns Raw',
            '@returns {Promise<import("./wasm_provider.js").InitOutput>} Raw'
          )}\nasync function __wbg_init(module_or_path) {`
      )
  )
  await writeFile(
    declarationsPath,
    declarations
      .replace('    free(): void;', `    ${freeDocumentation}\n    free(): void;`)
      .replace(
        '    [Symbol.dispose](): void;',
        `    ${disposeDocumentation}\n    [Symbol.dispose](): void;`
      )
      .replace(
        'export type InitInput =',
        '/** Accepted async initialization inputs: fetchable requests/URLs, responses, bytes, or a compiled module. */\nexport type InitInput ='
      )
      .replace(
        'export interface InitOutput {',
        '/** Raw WASM exports returned after initialization. Use imported conversion wrappers to receive ConversionResult objects; raw conversion functions return numeric metadata pointers. */\nexport interface InitOutput {'
      )
      .replace(
        '    readonly memory: WebAssembly.Memory;',
        '    /** Linear memory for arena views. Read its current buffer again after allocation or conversion can grow memory. */\n    readonly memory: WebAssembly.Memory;'
      )
      .replace(
        '    readonly __wbg_conversionresult_free:',
        '    /** Generated metadata destructor: a is a result pointer; b selects explicit disposal (0) or finalization (1). Use ConversionResult.free() instead of calling this directly. */\n    readonly __wbg_conversionresult_free:'
      )
      .replace(
        '    readonly alloc_bytes:',
        '    /** Raw allocation entry: a is the requested byte count. Returns a live arena id or 0 on allocation failure; prefer the named alloc_bytes wrapper. */\n    readonly alloc_bytes:'
      )
      .replace(
        '    readonly byte_len_of:',
        '    /** Raw capacity entry: a is an arena id. Returns its rounded byte capacity, or 0 for an unknown id or a live zero-byte block. */\n    readonly byte_len_of:'
      )
      .replace(
        '    readonly conversionresult_error:',
        '    /** Raw error getter: a is a live metadata pointer. Returns an allocated UTF-8 pointer/length pair; the ConversionResult.error getter decodes and releases that temporary storage. */\n    readonly conversionresult_error:'
      )
      .replace(
        '    readonly conversionresult_id:',
        '    /** Raw output-id getter: a is a live metadata pointer. Returns the output arena id, or 0 for a failed conversion; prefer ConversionResult.id. */\n    readonly conversionresult_id:'
      )
      .replace(
        '    readonly conversionresult_len:',
        '    /** Raw output-length getter: a is a live metadata pointer. Returns the exact output byte count, or 0 for failure; prefer ConversionResult.len. */\n    readonly conversionresult_len:'
      )
      .replace(
        '    readonly dealloc_bytes:',
        '    /** Raw arena release: a is an allocation id. Returns 1 when a live block was released, otherwise 0; the named wrapper exposes a boolean. */\n    readonly dealloc_bytes:'
      )
      .replace(
        '    readonly json_to_msgpack:',
        '    /** Raw JSON conversion: a is the input arena id and b its exact byte count. Returns a metadata pointer, not a ConversionResult object; use the named JavaScript wrapper. */\n    readonly json_to_msgpack:'
      )
      .replace(
        '    readonly msgpack_to_json:',
        '    /** Raw MessagePack conversion: a is the input arena id and b its exact byte count. Returns a metadata pointer, not a ConversionResult object; use the named JavaScript wrapper. */\n    readonly msgpack_to_json:'
      )
      .replace(
        '    readonly ptr_of:',
        '    /** Raw pointer entry: a is an arena id. Returns its eight-byte-aligned memory offset, or 0 for an unknown id. */\n    readonly ptr_of:'
      )
      .replace(
        '    readonly __wbindgen_externrefs:',
        '    /** Generated table holding JavaScript references required by wasm-bindgen. Owned and initialized by the glue; application arena data does not belong here. */\n    readonly __wbindgen_externrefs:'
      )
      .replace(
        '    readonly __wbindgen_free:',
        '    /** Generated temporary-storage release: a is a pointer, b its byte length, and c its alignment. Owned by the glue; arena ids must use dealloc_bytes instead. */\n    readonly __wbindgen_free:'
      )
      .replace(
        '    readonly __wbindgen_start:',
        '    /** Generated startup hook called by module initialization. Applications must initialize through init or initSync rather than invoking this hook again. */\n    readonly __wbindgen_start:'
      )
      .replace(
        'export type SyncInitInput =',
        '/** Local WASM bytes or a precompiled module for synchronous initialization; URLs and responses require the async initializer. */\nexport type SyncInitInput ='
      )
      .replace(
        /\/\*\*\n \* Instantiates the given `module`,[\s\S]*?\*\/\nexport function initSync/,
        `${syncDocumentation}\nexport function initSync`
      )
      .replace(
        /\/\*\*\n \* If `module_or_path` is[\s\S]*?\*\/\nexport default function __wbg_init/,
        `${asyncDocumentation}\nexport default function __wbg_init`
      )
  )
}
