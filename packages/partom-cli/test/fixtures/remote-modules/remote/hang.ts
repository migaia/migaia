import { defineEffect } from '@migaia/part-host'

export default defineEffect({ id: 'hang@1', run: () => new Promise(() => undefined) })
