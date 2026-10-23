import {
  createAdapterWebThreadLauncher as createWebThreadLauncher,
  createAdapterWebThreadChannelFactory as createWebThreadChannelFactory
} from '../../../rpc-plugin-thread/dist/threads/web-launcher.js'
import { runWebBinaryQualification } from './web-binary.js'

/** Existing Playwright scenario loading runs the genuine browser Worker path with built owners. */
globalThis.runBrowserBinaryScenario = () =>
  runWebBinaryQualification(createWebThreadLauncher, createWebThreadChannelFactory)

declare global {
  var runBrowserBinaryScenario: () => ReturnType<typeof runWebBinaryQualification>
}
