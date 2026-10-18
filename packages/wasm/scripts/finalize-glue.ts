import { readFile, writeFile } from 'node:fs/promises'

/** Wasm-pack owns this generated module; apply the package's publication rule after generation. */
const path = new URL('../src/wasm_provider.js', import.meta.url)
/** The pinned wasm-bindgen finalizer is the single owner of the glue's published instance. */
const anchor = 'function __wbg_finalize_init(instance, module) {\n'
/** First completed initialization retains the memory already returned to callers and named exports. */
const publication = `${anchor}    // Keep the first published arena when another initialization finishes later.\n    if (wasm !== undefined) return wasm;\n`
/** The generated source is rewritten only when its one known finalization point is present. */
const source = await readFile(path, 'utf8')
if (source.indexOf(anchor) < 0 || source.indexOf(anchor) !== source.lastIndexOf(anchor)) {
  process.stderr.write(
    'wasm glue finalization point changed; update the build postprocessor before publishing\n'
  )
  process.exitCode = 1
} else {
  await writeFile(path, source.replace(anchor, publication))
}
