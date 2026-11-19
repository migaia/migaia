// Reviewed effects of the orders page: replaces the generated drafts, keeping their plugin name.
import { defineEffect, definePartPlugin } from '@migaia/part-host'

/** Creates an order from the form after validating it against the order model. */
export const onSubmitEffect = defineEffect({
  id: 'orders-page.onSubmit@1',
  run: async (_event, ctx) => {
    /** Customer name typed into the form. */
    const customer = String(ctx.state.read('page.form.customer') ?? '')
    /** Validation of the new order. */
    const validation = await ctx.models.validate('order@1', { customer })
    if (!validation.ok) {
      ctx.state.write('page.form-errors.customer', validation.issues[0]?.message ?? '')
      return
    }
    ctx.state.write('page.form-errors.customer', '')
    await ctx.resources.run('list-orders@1', 'createOrder', { body: { customer } })
  }
})

/** Plugin registering the reviewed effects of the page. */
export default definePartPlugin({ name: 'orders-page-effects', effects: [onSubmitEffect] })
