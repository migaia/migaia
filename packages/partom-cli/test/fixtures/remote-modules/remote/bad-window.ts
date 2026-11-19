import { defineEffect } from '@migaia/part-host'

export default defineEffect({
  id: 'where@1',
  run: () => {
    void window.location
  }
})
