import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { freePort, Platform } from './support.ts'

/** Platform under test (no preview). */
const platform = new Platform()
/** Browser. */
let browser: Browser

beforeAll(async () => {
  await platform.start(await freePort())
  browser = await chromium.launch()
})

afterAll(async () => {
  await browser?.close()
  await platform.stop()
})

/** Workspace path of the orders page. */
const PAGE_FILE = 'src/blueprints/orders-page.blueprint.json'

/** Node of the orders page as the test edits it. */
type INode = { id?: string; facets?: { props?: Record<string, unknown> }; children?: INode[] }

/** Finds a node by id. */
function findNode(node: INode, id: string): INode | undefined {
  if (node.id === id) return node
  for (const child of node.children ?? []) {
    /** Match below the child. */
    const found = findNode(child, id)
    if (found !== undefined) return found
  }
  return undefined
}

/** Another client: sets a prop of a node in the workspace file and runs `partom push`. */
function pushProp(id: string, key: string, value: string): void {
  /** Workspace document. */
  const document = JSON.parse(platform.read(PAGE_FILE)) as { root: INode }
  /** Node to change. */
  const node = findNode(document.root, id) as INode
  node.facets = { ...node.facets, props: { ...node.facets?.props, [key]: value } }
  writeFileSync(join(platform.dir, PAGE_FILE), `${JSON.stringify(document, null, 2)}\n`)
  /** Push run. */
  const run = platform.partom(['push', '--service', platform.catalogUrl])
  expect(run.code, run.stdout + run.stderr).toBe(0)
}

/** Sets the button's `children` in the editor. */
async function editButton(page: Page, value: string): Promise<void> {
  /** Button address. */
  const button = (await page
    .locator('[data-node$="button-0"]')
    .first()
    .getAttribute('data-node')) as string
  await page.locator(`[data-node="${button}"]`).click()
  await page.locator(`[data-panel="${button}"] [data-field="children"]`).fill(value)
}

/** Draft orders page. */
async function draftPage(): Promise<INode> {
  /** Draft entry of the orders page; the fixture always has it. */
  const entry = (await platform.draft()).blueprints.find((item) => item.id === 'orders-page')
  if (entry === undefined) throw new Error('orders-page missing from the draft')
  return (entry.document as { root: INode }).root
}

describe('save conflicts', () => {
  it('merges a non-overlapping concurrent edit and lets the user resolve an overlapping one', async () => {
    /** Editor page. */
    const page = await browser.newPage()
    await page.goto(platform.editorUrl)
    await page.locator('[data-token]').fill(platform.token)
    await page.locator('[data-project]').fill('orders')
    await page.locator('[data-login] button').click()
    await page.locator('[data-blueprint="orders-page"]').click()

    pushProp('p-0', 'children', 'Pushed description')
    await editButton(page, 'Editor order')
    await page.locator('[data-save]').click()
    await expect
      .poll(() => page.locator('[data-result="orders-page"]').textContent())
      .toContain('conflict')
    await expect.poll(() => page.locator('[data-status]').textContent()).toContain('save again')
    expect(await page.locator('[data-conflict]').count()).toBe(0)
    await page.locator('[data-save]').click()
    await expect
      .poll(() => page.locator('[data-result="orders-page"]').textContent())
      .toContain('accepted')
    /** Draft after the merged save. */
    const merged = await draftPage()
    expect(findNode(merged, 'p-0')?.facets?.props?.children).toBe('Pushed description')
    expect(findNode(merged, 'button-0')?.facets?.props?.children).toBe('Editor order')

    pushProp('button-0', 'children', 'Pushed order')
    await editButton(page, 'Mine again')
    await page.locator('[data-save]').click()
    /** Conflict row of the button. */
    const conflict = page.locator('[data-conflict$="button-0"]')
    await expect.poll(() => conflict.count()).toBe(1)
    expect(await conflict.textContent()).toContain('props')
    await conflict.locator('[data-keep="ours"]').click()
    await page.locator('[data-save]').click()
    await expect
      .poll(() => page.locator('[data-result="orders-page"]').textContent())
      .toContain('accepted')
    expect(findNode(await draftPage(), 'button-0')?.facets?.props?.children).toBe('Mine again')
    await page.close()
  })
})
