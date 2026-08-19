// @migaia/storage-web 故意不在这里引入：web-only 包，小程序运行时没有
// localStorage/document.cookie/IndexedDB（有自己的 wx.setStorage 等 API，
// 不在 storage-web 覆盖范围内）。见 SDD §12.6。
import { PluginHost } from '@migaia/plugin-host';

class MiniProgramHost extends PluginHost<Record<string, never>> {}

const host = new MiniProgramHost();
void host.dispose();
