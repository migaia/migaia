// @partom-generated sha256:ae498482f53da00f3cbb2e170f111bd5d6bff906d55fbb36d993f22707ddd9fe
import { defineModel } from '@migaia/part-contract'
import { z } from 'zod'

/** Schema of the model generated from the OpenAPI document. */
export const orderSchema = z.object({
  id: z.string().optional(),
  customer: z.string().min(1),
  status: z.enum(['open', 'closed', 'archived']).optional()
})

/** Model generated from the OpenAPI document. */
export default defineModel({
  id: 'order@1',
  schema: orderSchema,
  jsonSchema: {
    type: 'object',
    required: ['customer'],
    properties: {
      id: { type: 'string' },
      customer: { type: 'string', minLength: 1 },
      status: { type: 'string', enum: ['open', 'closed', 'archived'] }
    }
  },
  key: ['id'],
  display: { status: { format: 'enum' } }
})
