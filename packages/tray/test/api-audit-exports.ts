// @ts-expect-error Tray-C01 keeps inference helpers private to their declaration owner.
import type { IHostBaselinePlugins } from '../src/host/index.ts'
// @ts-expect-error Tray-C01 keeps inference helpers private to their declaration owner.
import type { IPluginWithSynchronousShared } from '../src/host/index.ts'
// @ts-expect-error Tray-C01 keeps inference helpers private to their declaration owner.
import type { ICanResolveReadyDefinitions } from '../src/host/index.ts'
// @ts-expect-error Tray-C01 keeps inference helpers private to their declaration owner.
import type { IResolveReadyTrayPlugins } from '../src/host/index.ts'
import type { IRuntimeShutdownOptions } from '../src/runtime/index.ts'
/** Runtime bounded shutdown has no independent wait budget; managed Host owns quiescence. */
const shutdown: IRuntimeShutdownOptions = {
  mode: 'bounded',
  // @ts-expect-error Tray-C03 removes the unused Runtime-only option.
  quiescenceMs: 100
}
void shutdown
void (undefined as unknown as IHostBaselinePlugins<never>)
void (undefined as unknown as IPluginWithSynchronousShared<never>)
void (undefined as unknown as ICanResolveReadyDefinitions<readonly []>)
void (undefined as unknown as IResolveReadyTrayPlugins<readonly []>)
