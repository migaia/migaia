import type {
  INodeThreadHandle,
  IWebThreadHandle,
  IWebThreadLauncherOptions
} from '@migaia/rpc-threads'
// @ts-expect-error removes the redundant Bun subpath; use the root Web factories.
import type { createBunThreadLauncher } from '@migaia/rpc-threads/adapters/bun'
// @ts-expect-error removes the redundant Deno subpath; use the root Web factories.
import type { createDenoThreadLauncher } from '@migaia/rpc-threads/adapters/deno'
// @ts-expect-error removes the redundant browser subpath; use the root Web factories.
import type { createBrowserThreadLauncher } from '@migaia/rpc-threads/adapters/browser'
// @ts-expect-error removes the redundant renderer subpath; use the root Web factories.
import type { createElectronRendererThreadLauncher } from '@migaia/rpc-threads/adapters/electron-renderer'
// @ts-expect-error retains one public import location for this handle type at the root.
import type { INodeThreadHandle as IRetiredNodeHandle } from '@migaia/rpc-threads/adapters/node'
// @ts-expect-error retains one public import location for this handle type at the root.
import type { INodeThreadHandle as IRetiredElectronHandle } from '@migaia/rpc-threads/adapters/electron-main'

/** Canonical types remain available while every retired import is used by the compiler oracle. */
export type ICanonicalThreadTypes = INodeThreadHandle | IWebThreadHandle | IWebThreadLauncherOptions
/** Using rejected bindings prevents an unused-import diagnostic from masking export assertions. */
export type IRetiredThreadTypes =
  | typeof createBunThreadLauncher
  | typeof createDenoThreadLauncher
  | typeof createBrowserThreadLauncher
  | typeof createElectronRendererThreadLauncher
  | IRetiredNodeHandle
  | IRetiredElectronHandle
