import { PluginHost } from '@migaia/plugin-host'

class MainHost extends PluginHost<Record<string, never>> {}

const host = new MainHost()
await host.dispose()
