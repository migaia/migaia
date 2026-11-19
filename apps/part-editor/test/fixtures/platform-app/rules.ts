// Project rule of the platform fixture: every input needs an accessible label. The editor bundle does
// not contain this rule; its issues reach the editor only through the preview page.
import { defineRule } from '@migaia/part-contract'
import { definePartPlugin } from '@migaia/part-host'

/** `test.require-label`: an input without `aria.label` is an error; the fix adds one. */
const requireLabel = defineRule({
  id: 'test.require-label',
  targets: ['input'],
  scope: 'part',
  phase: 'authored',
  severity: 'error',
  check: (context) => {
    const node = context.node as { facets?: { aria?: { label?: unknown } } }
    if (node.facets?.aria?.label !== undefined) return
    const pointer = context.index.get(context.address as string)?.pointer as string
    context.report({
      address: context.address as string,
      facet: 'aria',
      path: 'aria.label',
      messageKey: 'test.require-label',
      fix:
        node.facets === undefined
          ? [{ op: 'add', path: `${pointer}/facets`, value: { aria: { label: 'Field' } } }]
          : node.facets.aria === undefined
            ? [{ op: 'add', path: `${pointer}/facets/aria`, value: { label: 'Field' } }]
            : [{ op: 'add', path: `${pointer}/facets/aria/label`, value: 'Field' }]
    })
  }
})

/** Plugin carrying the project rules. */
export const projectRulesPlugin = definePartPlugin({ name: 'project-rules', rules: [requireLabel] })
