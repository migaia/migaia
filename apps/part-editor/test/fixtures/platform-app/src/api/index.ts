// @partom-generated sha256:0fe3a647fb262cfcc9208758d652d32cb206b137d7c93116b40bef0659fc1c20
import { definePartPlugin } from '@migaia/part-host'
import model0 from './models/order.ts'
import { listOrders } from './resources/orders.ts'

export { createHttpPlugin, httpFeature } from './http.ts'
export { listOrders }

/** Plugin registering every generated model and resource. */
export const apiPlugin = definePartPlugin({
  name: 'api',
  models: [model0],
  resources: [listOrders]
})
