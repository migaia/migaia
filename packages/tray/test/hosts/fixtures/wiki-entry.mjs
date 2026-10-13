import { serveTrayHost } from '@migaia/tray'
import { wiki, fixtureReport, childProbe } from './hosts.mjs'
await serveTrayHost(wiki, { report: fixtureReport, probe: childProbe })
