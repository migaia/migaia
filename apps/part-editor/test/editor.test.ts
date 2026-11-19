import { createAddressIndex, parseBlueprint } from '@migaia/part-contract'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freePort, Platform } from './support.ts'

/** Platform under test. */
const platform = new Platform()
/** Browser. */
let browser: Browser

beforeAll(async () => {
  await platform.start(await freePort(), await freePort())
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await platform.stop()
})

/** Opens the editor and signs in with `token`. */
async function open(token: string): Promise<Page> {
  /** Page. */
  const page = await browser.newPage()
  await page.goto(platform.editorUrl)
  await page.locator('[data-token]').fill(token)
  await page.locator('[data-project]').fill('orders')
  await page.locator('[data-login] button').click()
  return page
}

describe('editor session, tree and property panel', () => {
  it('refuses a wrong token and shows the draft tree and a generated panel', async () => {
    /** Page with a wrong token. */
    const rejected = await open('wrong-token')
    await expect.poll(() => rejected.locator('[data-status]').textContent()).toContain('401')
    expect(await rejected.locator('[data-login]').count()).toBe(1)
    await rejected.close()

    /** Signed-in page. */
    const page = await open(platform.token)
    await expect
      .poll(() => page.locator('[data-draft-state]').textContent())
      .toContain('草稿 · 基于 v1')
    await page.locator('[data-blueprint="orders-page"]').click()
    /** Expected addresses from the draft document. */
    const draft = (await platform.draft()).blueprints.find((item) => item.id === 'orders-page')
    /** Addresses of the draft document. */
    const addresses = [...createAddressIndex(parseBlueprint(draft?.document)).entries()].map(
      (entry) => entry.address
    )
    expect(
      await page
        .locator('[data-node]')
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node')))
    ).toEqual(addresses)
    /** Address of the "Create order" button. */
    const button = addresses.find((address) => address.endsWith('button-0')) as string
    await page.locator(`[data-node="${button}"]`).click()
    /** Panel of the button. */
    const panel = page.locator(`[data-panel="${button}"]`)
    expect(await panel.locator('[data-field="type"]').count()).toBe(1)
    expect(await panel.locator('[data-field="children"]').inputValue()).toBe('Create order')
    expect(await panel.locator('select[data-field="variant"] option').allTextContents()).toContain(
      'destructive'
    )
    await page.close()
  })
})

/** Node of a blueprint document as the assertions read it. */
type IDocNode = {
  id?: string
  facets?: { props?: Record<string, unknown>; aria?: Record<string, unknown> }
  children?: IDocNode[]
}

/** Finds a node by id in a document tree. */
function findNode(node: IDocNode, id: string): IDocNode | undefined {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    /** Match below the child. */
    const found = findNode(child, id)
    if (found !== undefined) return found
  }
  return undefined
}

describe('editing, preview issues, fixes, moves and save', () => {
  it('edits props, fixes a project-rule issue from the preview, moves a node and saves', async () => {
    /** Signed-in page. */
    const page = await open(platform.token)
    await page.locator('[data-blueprint="orders-page"]').click()
    /** Addresses by node id. */
    const address = async (id: string): Promise<string> =>
      (await page.locator(`[data-node$="${id}"]`).first().getAttribute('data-node')) as string
    /** Button address. */
    const button = await address('button-0')
    await page.locator(`[data-node="${button}"]`).click()
    await page.locator(`[data-panel="${button}"] [data-field="children"]`).fill('New order')
    await expect.poll(() => page.locator('[data-node-issue]').count()).toBe(0)

    /** Input address. */
    const input = await address('input-0')
    await page.locator(`[data-node="${input}"]`).click()
    await page.locator(`[data-panel="${input}"] [data-field="label"]`).fill('')
    /** Project rule issue reported by the preview. */
    const issue = page.locator(`[data-panel="${input}"] [data-issue="test.require-label"]`)
    await expect.poll(() => issue.count(), { timeout: 30000 }).toBe(1)
    expect(
      await page.locator(`[data-panel="${input}"] [data-field-issue="test.require-label"]`).count()
    ).toBe(1)
    expect(await page.locator(`[data-node="${input}"] [data-node-issue]`).count()).toBe(1)
    await page.locator(`[data-fix="test.require-label"]`).click()
    await expect.poll(() => issue.count(), { timeout: 30000 }).toBe(0)

    /** Node count before the move. */
    const before = await page.locator('[data-node]').count()
    /** Log button address. */
    const log = await address('log-button')
    await page.locator(`[data-node="${log}"]`).click()
    await page.locator('[data-move-up]').click()
    /** Tree order after the move. */
    const order = await page
      .locator('[data-node]')
      .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-node')))
    expect(order).toHaveLength(before)
    expect(order.findIndex((item) => item?.endsWith('log-button'))).toBeLessThan(
      order.findIndex((item) => item?.endsWith('form-0'))
    )

    await page.locator('[data-save]').click()
    await expect
      .poll(() => page.locator('[data-result="orders-page"]').textContent())
      .toContain('accepted')
    /** Saved draft document. */
    const saved = (await platform.draft()).blueprints.find((item) => item.id === 'orders-page')
      ?.document as { root: IDocNode }
    expect(findNode(saved.root, 'button-0')?.facets?.props?.children).toBe('New order')
    expect(findNode(saved.root, 'input-0')?.facets?.aria?.label).toBeDefined()
    /** Root child ids. */
    const ids = (saved.root.children ?? []).map((child) => child.id)
    expect(ids.indexOf('log-button')).toBe(ids.indexOf('form-0') - 1)
    await page.close()
  })
})
