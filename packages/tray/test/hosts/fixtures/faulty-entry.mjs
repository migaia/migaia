import { serveTrayHost } from '@migaia/tray'
import { faulty, classification } from './hosts.mjs'
await serveTrayHost(faulty, {
  report: (error) => console.error(JSON.stringify(classification(error)))
})
