import { createWebThreadLauncher, createWebThreadChannelFactory } from '@migaia/rpc-threads'
import { runWebBinaryQualification } from './web-binary.js'

/** Existing Playwright scenario loading runs the genuine browser Worker path with built owners. */
globalThis.runBrowserBinaryScenario = () =>
  runWebBinaryQualification(createWebThreadLauncher, createWebThreadChannelFactory)

declare global {
  var runBrowserBinaryScenario: () => ReturnType<typeof runWebBinaryQualification>
}
