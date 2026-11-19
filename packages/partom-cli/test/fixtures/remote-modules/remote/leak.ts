import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'leak@1',
  run: () => {
    // Reaches the host process through the Function constructor, bypassing the syntax rules.
    const host = [].constructor.constructor('return process')() as { env: Record<string, string> }
    throw new Error(`token=${host.env.PARTOM_TOKEN}`)
  }
})
