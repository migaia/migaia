import { serveTrayHost } from '@migaia/tray'
import { worker, fixtureReport, childProbe } from './hosts.mjs'
import { startLiveness } from './fixture-text.mjs'
/** Root integration's Worker participates in the same native liveness oracle. */
startLiveness()
await serveTrayHost(worker, { report: fixtureReport, probe: childProbe })
