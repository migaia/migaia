import {
  createBrowserThreadLauncher,
  createBrowserThreadChannelFactory
} from '@migaia/rpc-threads/adapters/browser'
import { runWebBinaryQualification } from './web-binary.js'

/** Existing Playwright scenario loading runs the genuine browser Worker path with built owners. */
globalThis.runBrowserBinaryScenario = () =>
  runWebBinaryQualification(createBrowserThreadLauncher, createBrowserThreadChannelFactory)

declare global {
  var runBrowserBinaryScenario: () => ReturnType<typeof runWebBinaryQualification>
}
