// @migaia/storage-web 故意不在这里引入：web-only 包，Deno 没有 localStorage/
// document.cookie/IndexedDB 这套浏览器全局对象。见 SDD §12.6。
import { PluginHost } from '@migaia/plugin-host';

class DenoHost extends PluginHost<Record<string, never>> {}

const host = new DenoHost();
void host.dispose();
