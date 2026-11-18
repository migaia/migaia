/**
 * Single-executable entry for darwin-x64: embeds the oxc native addon (loader pointed at it) and
 * the doctor runner (registered for it.
 */
import doctorRunner from '../../dist/doctor-runner.js' with { type: 'file' }
import { setDoctorRunner } from '../delegate.ts'
import { setPreviewRuntime } from '../preview/page-entry.ts'
import previewRuntime from '../../dist/preview-runtime.js' with { type: 'file' }
import nativePath from '@oxc-parser/binding-darwin-x64/parser.darwin-x64.node' with { type: 'file' }

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath
setDoctorRunner(doctorRunner)
setPreviewRuntime(previewRuntime)
/** CLI module, loaded after the native path is set. */
const { main } = await import('../cli.ts')
process.exit(await main(process.argv.slice(2)))
