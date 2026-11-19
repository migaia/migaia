import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'env@1',
  run: () => {
    void process.env
  }
})
