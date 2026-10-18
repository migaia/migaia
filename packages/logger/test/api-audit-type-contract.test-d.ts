import { Logger, type ILoggerColorMode, type ILoggerLevel } from '../src/index.js'
// @ts-expect-error Host assembly shape belongs to the internal typing module.
import type { ILoggerDomainCore } from '../src/index.js'
// @ts-expect-error Color options use the root canonical ILoggerColorMode.
import type { IColorMode } from '../src/plugins/index.js'
// @ts-expect-error Level options use the root canonical ILoggerLevel.
import type { ILogLevel } from '../src/plugins/index.js'

/** Instance cleanup is part of the actual public constructor return type. */
const log = new Logger({ execution: { mutationTimeoutMs: false, pipelineDrainTimeoutMs: false } })
/** Runtime dispose aliases shutdown('manual') and preserves the host disposal receipt type. */
const completion = log.dispose()
/** Canonical root unions remain usable after plugin aliases are removed. */
const color: ILoggerColorMode = 'never'
const level: ILoggerLevel = 'info'
void completion
void color
void level

/** Keep the three forbidden import checks live without exporting compatibility types. */
type IRemovedNames = [ILoggerDomainCore, IColorMode, ILogLevel]
/** Type-only fixture; no resource or runtime work is evaluated. */
const removedNames = undefined as unknown as IRemovedNames
void removedNames
