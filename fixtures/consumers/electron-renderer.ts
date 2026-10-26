import { PluginHost } from '@migaia/plugin-host'
import { createStorageHost } from '@migaia/storage-host'
import { localStorageBackendPlugin } from '@migaia/storage-web/local-storage'

class RendererHost extends PluginHost<Record<string, never>> {}

const host = new RendererHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
void host.dispose()

/** Electron renderer declarations install the browser backend through its owning Host. */
const storage = await createStorageHost({ plugins: [localStorageBackendPlugin()] })
try {
  await storage.backend('local').set('k', 'v')
} finally {
  await storage.dispose()
}
