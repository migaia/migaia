// v1 audit: writes its granted path, then a path outside its grants.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'audit@1',
  run: (_event, ctx) => {
    ctx.state.write('page.audit' as never, 'v1' as never)
    ctx.state.write('page.other' as never, 'v1' as never)
  }
})
