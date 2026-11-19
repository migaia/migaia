// v2 audit: writes the v2 marker to its granted path.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'audit@1',
  run: (_event, ctx) => {
    ctx.state.write('page.audit' as never, 'v2' as never)
  }
})
