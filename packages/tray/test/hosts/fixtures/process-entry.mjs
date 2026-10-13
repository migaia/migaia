import { serveTrayHost } from '@migaia/tray'
import { nodePr, fixtureReport, childProbe } from './hosts.mjs'
await serveTrayHost(nodePr, { report: fixtureReport, probe: childProbe })
