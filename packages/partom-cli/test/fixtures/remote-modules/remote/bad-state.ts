import { defineEffect } from '@migaia/part-host'

let counter = 0

export default defineEffect({ id: 'counter@1', run: () => void (counter += 1) })
