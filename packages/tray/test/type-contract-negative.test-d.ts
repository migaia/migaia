import type { ITrayHost } from '../src/host/typing.js'
import type { PluginHost } from '@migaia/plugin-host'

declare const host: ITrayHost<PluginHost<Record<string, never>, string>, readonly []>

// @ts-expect-error TS2339: the managed Host surface must reject unknown root members.
void host.__tpd_missing_host_property
