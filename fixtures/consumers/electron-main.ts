// @migaia/storage-web 故意不在这里引入：web-only 包，Electron 主进程是
// Node 环境，没有 localStorage/document.cookie/IndexedDB。渲染进程见
// electron-renderer.ts。见 SDD §12.6。
import { PluginHost } from '@migaia/plugin-host';

class MainHost extends PluginHost<Record<string, never>> {}

const host = new MainHost();
await host.dispose();
