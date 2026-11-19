import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'lazy@1',
  run: async () => {
    await import('./helper.ts')
  }
})
