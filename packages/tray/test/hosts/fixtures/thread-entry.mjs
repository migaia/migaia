import { serveTrayHost } from '@migaia/tray'
import { nodeTh, fixtureReport, childProbe } from './hosts.mjs'
import { startLiveness } from './fixture-text.mjs'

/** Native thread liveness proves Worker disposal without relying on Tray's registry state. */
startLiveness()
await serveTrayHost(nodeTh, { report: fixtureReport, probe: childProbe })
