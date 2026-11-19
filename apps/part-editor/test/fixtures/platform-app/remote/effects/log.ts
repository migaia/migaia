// Remote effect of the "Log" button: records a log line in page state.
import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'log@1',
  run: (_event, ctx) => {
    ctx.state.write('page.log' as never, 'logged' as never)
  }
})
