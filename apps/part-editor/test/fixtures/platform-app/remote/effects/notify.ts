// Remote effect of the "Create order" button: shows a notice.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'notify@1',
  run: (_event, ctx) => {
    ctx.state.write('page.notice' as never, 'Order noted' as never)
  }
})
