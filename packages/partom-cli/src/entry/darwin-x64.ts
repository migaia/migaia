/** Single-executable entry for darwin-x64: embeds the oxc native addon and points the loader at it. */
import nativePath from '@oxc-parser/binding-darwin-x64/parser.darwin-x64.node' with { type: 'file' }

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath
/** CLI module, loaded after the native path is set. */
const { main } = await import('../cli.ts')
process.exit(await main(process.argv.slice(2)))
