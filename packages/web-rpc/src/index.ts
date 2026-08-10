/**
 * Public surface of `@migai/web-rpc` (`packages/web-rpc`) — a standalone package with its own
 * `package.json`/`tsconfig.json`, deliberately store/DOM/Node-agnostic. `../store` never appears
 * here or transitively below it (enforced by `architecture.test.ts` in this package and in
 * `src/store`), and `request-registry`/`id-allocator` stay under `./internal/` and unexported, to
 * avoid an unintended semver contract on them.
 *
 * `npm run build:rpc` (root) / `npm run build` (this package) emits real ESM `.js` + `.d.ts` under
 * `dist/` via `tsconfig.build.json` — that's the artifact an external consumer would get. The app
 * itself doesn't consume `dist/`: it has no workspace install/link step (no `aube`/npm/pnpm
 * workspace resolution wired up yet — `pnpm-workspace.yaml` at the repo root declares the intent
 * but nothing has run `install` against it), so `tsconfig.app.json`'s `paths` and
 * `vite.config.ts`/`vitest.config.ts`'s `resolve.alias` all point the `@morning-watch/rpc`
 * specifier straight at `./src/index.ts` instead. Store integrates only through this file's exports
 * — see the `worker`/`serialize`/`managed-rpc-handler` entries in
 * `src/store/architecture.test.ts`'s `ALLOWED` table for the enforced one-directional dependency.
 * `tsconfig.core.json`/`tsconfig.node-adapter.json` (run via `npm run typecheck:rpc`) separately
 * verify the core and the Node adapter typecheck with zero DOM/Node ambient types.
 */
export { createEndpoint } from './factory';
export type * from './typing';
export {
  WebRpcErrorCode,
  WebRpcError,
  WebRpcSchemaValidationError,
  WebRpcConfigurationError,
  WebRpcLifecycleError,
  WebRpcSerializationError,
  WebRpcProtocolError,
  WebRpcContractError,
  WebRpcTransportError,
  WebRpcChunkError,
  WebRpcRemoteError,
  WebRpcAbortError,
  WebRpcTimeoutError,
  isWebRpcError
} from './errors';
export type { IWebRpcTransport, IWebRpcSendOptions } from './transport';
export type { IWebRpcEnvelope, IWebRpcRequest, IWebRpcResponse, IWebRpcVariation } from './wire';
export * from './middleware';
