// Remote effect: runs a granted resource command and records a notice.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'notify@1',
  run: async (_event, ctx) => {
    await ctx.resources.run('orders@1' as never, 'create' as never, undefined as never)
    ctx.state.write('page.notice' as never, 'created' as never)
  }
})
