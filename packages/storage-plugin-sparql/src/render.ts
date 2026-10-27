import { createSparqlTag } from '@migaia/storage-host/sdk'
import { type ISparqlFragment } from '@migaia/storage-contract'
import { invalidArgument } from './errors.js'
/**
 * Generated native graph operations borrow the original fragment compiler without a second
 * renderer.
 */
export async function renderFragment(fragment: ISparqlFragment): Promise<string> {
  let body: string | undefined
  const tag = createSparqlTag({
    select: async () => {
      throw invalidArgument()
    },
    ask: async () => {
      throw invalidArgument()
    },
    construct: async () => {
      throw invalidArgument()
    },
    update: async (prepare) => {
      body = prepare()
    }
  })
  await tag`${fragment}`.update()
  return body!
}
