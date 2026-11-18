/**
 * Single-executable entry for linux-arm64-gnu: embeds the oxc native addon (loader pointed at it)
 * and the doctor runner (registered for delegation).
 */
import doctorRunner from '../../dist/doctor-runner.js' with { type: 'file' }
import { setDoctorRunner } from '../delegate.ts'
import nativePath from '@oxc-parser/binding-linux-arm64-gnu/parser.linux-arm64-gnu.node' with { type: 'file' }

process.env.NAPI_RS_NATIVE_LIBRARY_PATH = nativePath
setDoctorRunner(doctorRunner)
/** CLI module, loaded after the native path is set. */
const { main } = await import('../cli.ts')
process.exit(await main(process.argv.slice(2)))
