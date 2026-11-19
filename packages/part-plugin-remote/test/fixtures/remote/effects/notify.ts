// v1 notify: tries a command the application did not grant, then a granted one.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'notify@1',
  tier: 'page',
  meta: { 'part.grants': { resources: ['orders@1:delete'] } },
  run: async (_event, ctx) => {
    await ctx.resources
      .run('orders@1' as never, 'delete' as never, 'v1' as never)
      .catch(() => undefined)
    await ctx.resources.run('orders@1' as never, 'create' as never, 'v1' as never)
  }
})
