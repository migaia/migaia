// v1 total: sum of two state values.
import { defineDerive } from '@migaia/part-host'

export default defineDerive({
  id: 'total@1',
  compute: (state) => Number(state.read('page.a')) + Number(state.read('page.b'))
})
