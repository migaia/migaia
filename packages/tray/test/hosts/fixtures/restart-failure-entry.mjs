import { existsSync } from 'node:fs'
import { serveTrayHost } from '@migaia/tray'
import { nodePr, fixtureReport, childProbe } from './hosts.mjs'
import { FixtureText, fixtureError } from './fixture-text.mjs'

/** First init creates this file; later launches fail before a runtime handle can become ready. */
const marker = process.env.TRAY_LAUNCH_FAILURE
if (marker && existsSync(marker))
  throw fixtureError(FixtureText.initCode, FixtureText.launchMessage)
await serveTrayHost(nodePr, { report: fixtureReport, probe: childProbe })
