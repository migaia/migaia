/**
 * Single-executable entry for win32-x64-msvc: embeds the oxc native addon and points the loader at
 * it.
 */
import nativePath from '@oxc-parser/binding-win32-x64-msvc/parser.win32-x64-msvc.node' with { type: 'file' }

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath
/** CLI module, loaded after the native path is set. */
const { main } = await import('../cli.ts')
process.exit(await main(process.argv.slice(2)))
