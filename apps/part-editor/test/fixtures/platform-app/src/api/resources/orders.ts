// @partom-generated sha256:17f80a7ac90e9014f8124fe34aa6ef408d308460b4632e25b2e6eb8b50624586
import { defineResource } from '@migaia/part-host'
import { z } from 'zod'
import { fillPath, httpFeature, pick } from '../http.ts'
import { orderSchema } from '../models/order.ts'

/** Resource generated from the OpenAPI document. */
export const listOrders = defineResource({
  id: 'list-orders@1',
  params: z.object({ status: z.enum(['open', 'closed', 'archived']).optional() }),
  paramsJsonSchema: {
    type: 'object',
    properties: { status: { type: 'string', enum: ['open', 'closed', 'archived'] } },
    required: []
  },
  resultJsonSchema: {
    type: 'array',
    items: {
      type: 'object',
      required: ['customer'],
      properties: {
        id: { type: 'string' },
        customer: { type: 'string', minLength: 1 },
        status: { type: 'string', enum: ['open', 'closed', 'archived'] }
      }
    }
  },
  deps: { http: httpFeature },
  tags: () => ['orders'],
  load: (params, { features, signal }) =>
    features.http.request({
      method: 'GET',
      path: fillPath('/orders', params, []),
      query: pick(params, ['status']),
      signal
    }),
  commands: {
    createOrder: {
      args: z.object({ body: z.lazy(() => orderSchema) }),
      argsJsonSchema: {
        type: 'object',
        properties: {
          body: {
            type: 'object',
            required: ['customer'],
            properties: {
              id: { type: 'string' },
              customer: { type: 'string', minLength: 1 },
              status: { type: 'string', enum: ['open', 'closed', 'archived'] }
            }
          }
        },
        required: ['body']
      },
      invalidates: () => ['orders'],
      run: (args, { features, signal }) =>
        features.http.request({
          method: 'POST',
          path: fillPath('/orders', args, []),
          query: pick(args, []),
          body: pick(args, ['body']).body,
          signal
        })
    }
  }
})
