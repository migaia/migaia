/**
 * Built-in codec plugins exported by `@migaia/serialize/plugins`.
 *
 * Optional `encoder` and `decoder` injection supplies encoding capabilities. Omitting them
 * explicitly relies on the host Encoding API.
 */
export { jsonParser, jsonPlugin, type IJsonPluginOptions } from './plugins/json.ts'
