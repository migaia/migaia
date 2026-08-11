import { PluginHost } from '@migaia/plugin-host'

class DenoHost extends PluginHost<Record<string, never>> {}

const host = new DenoHost()
void host.dispose()
