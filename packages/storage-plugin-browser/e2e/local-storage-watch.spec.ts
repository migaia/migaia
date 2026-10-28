import { expect, test } from '@playwright/test'

test('native localStorage events isolate namespaces and organizations across pages', async ({
  context,
  page
}) => {
  const peer = await context.newPage()
  await page.goto('/')
  await peer.goto('/')
  const namespace = 'native-watch-' + crypto.randomUUID()
  const org = crypto.randomUUID()
  try {
    expect(
      await page.evaluate(({ namespace, org }) => window.prepareLocalStorageWatch(namespace, org), {
        namespace,
        org
      })
    ).toBe(true)
    await peer.evaluate(
      async ({ namespace, org }) => {
        await window.writeLocalStorageWatch(namespace + '-foreign', org, 'foreign namespace')
        await window.writeLocalStorageWatch(namespace, crypto.randomUUID(), 'foreign org')
        await window.writeLocalStorageWatch(namespace, org, 'committed peer value')
      },
      { namespace, org }
    )
    expect(await page.evaluate(() => window.readLocalStorageWatch())).toMatchObject({
      change: { orgId: org, channel: 'value', kind: 'put', keys: ['theme'] },
      value: 'committed peer value'
    })
  } finally {
    await page.evaluate(() => window.closeLocalStorageWatch())
    await peer.close()
  }
})
