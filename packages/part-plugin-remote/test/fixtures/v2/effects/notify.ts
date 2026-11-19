// v2 notify: runs the granted command with the v2 marker.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'notify@1',
  run: async (_event, ctx) => {
    await ctx.resources.run('orders@1' as never, 'create' as never, 'v2' as never)
  }
})
