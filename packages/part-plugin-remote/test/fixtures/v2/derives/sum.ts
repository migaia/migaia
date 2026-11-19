// v2: total@1 moved here and now scales the sum by ten.
import { defineDerive } from '@migaia/part-host'

export default defineDerive({
  id: 'total@1',
  compute: (state) => (Number(state.read('page.a')) + Number(state.read('page.b'))) * 10
})
