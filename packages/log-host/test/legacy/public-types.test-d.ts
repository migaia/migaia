import { expectTypeOf } from 'vitest'
import { createLogHost, type LogLevel } from '../../src/index.ts'
import type { IPluginHostDisposalResult } from '@migaia/plugin-host'
// @ts-expect-error Host assembly core remains internal rather than a root public type.
import type { ILogDomainCore } from '../../src/index.ts'
// @ts-expect-error Retired plugin aliases cannot duplicate the canonical level type.
import type { ILogLevel } from '../../src/features/index.ts'

/** Terminal cleanup is exposed through the real host shutdown method and canonical peer result. */
const host = createLogHost()
expectTypeOf(host.shutdown('manual')).toEqualTypeOf<Promise<IPluginHostDisposalResult>>()
/** The canonical level constant/type pair replaces the retired separate alias. */
const level: LogLevel = 'info'
void level
// @ts-expect-error The removed dispose alias has no compatibility entry.
host.dispose()
// @ts-expect-error Generator mode registration is absent from the async-only public host.
host.useGeneratorPipeline()
// @ts-expect-error The old async registration name is replaced by the sole usePipeline entry.
host.useAsyncPipeline()
/** Keep forbidden-import checks live as types without runtime fixtures or substitute peer contracts. */
type IRemovedNames = [ILogDomainCore, ILogLevel]
/** No value of the removed types is constructed or asserted into another public contract. */
declare const removedNames: IRemovedNames
void removedNames
