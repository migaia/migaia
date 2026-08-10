import { PluginHost } from '@migai/plugin-host'

class RendererHost extends PluginHost<Record<string, never>> {}

const host = new RendererHost()
void host.dispose()
