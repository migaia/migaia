import { PluginHost } from '@migai/plugin-host'

class MiniProgramHost extends PluginHost<Record<string, never>> {}

const host = new MiniProgramHost()
void host.dispose()
