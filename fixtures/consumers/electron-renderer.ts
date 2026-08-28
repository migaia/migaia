import { PluginHost } from '@migaia/plugin-host'
import { localStorage } from '@migaia/storage-web/local-storage'

class RendererHost extends PluginHost<Record<string, never>> {}

const host = new RendererHost({
  execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false }
})
void host.dispose()

// Electron renderer 进程有完整的 DOM/BOM，storage-web 的浏览器后端可直接使用。
void localStorage().set('k', 'v')
