/**
 * `@migaia/serialize/plugins`：内置 codec 插件。
 *
 * 零包依赖；Encoding 经 `encoder`/`decoder` 注入（可省略，省略时明确声明依赖宿主 Encoding API，见 R-4）。
 */
export { jsonParser, jsonPlugin, type IJsonPluginOptions } from './plugins/json.js';
