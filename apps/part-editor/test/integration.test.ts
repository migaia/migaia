/**
 * Whole-program acceptance: compiled `partom`, the catalog, the editor with its preview and the
 * fixture's client page in headless Chromium, through release, editing, pull, delivery, rejection,
 * rollback, offline start and devtools.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { BUN, freePort, Platform } from './support.ts'

/** CLI package directory. */
const CLI_DIR = join(import.meta.dirname, '..', '..', '..', 'packages', 'partom-cli')
/** Compiled executable. */
const PARTOM_EXE = join(CLI_DIR, 'dist', 'partom')

/** Platform under test. */
const platform = new Platform()
/** Browser. */
let browser: Browser
/** Client page URL with the catalog address. */
let clientUrl = ''

/** Remote Feature and reports the client page exposes. */
type IClientGlobal = {
  remote: { revalidate(): Promise<void>; current(): { tag: string; snapshot: string } | undefined }
  reports: {
    address?: string
    version?: string
    snapshot?: string
    code?: string
    message?: string
  }[]
}

beforeAll(async () => {
  /** Compiled executable build. */
  const build = spawnSync(BUN, ['run', 'build:exe'], { cwd: CLI_DIR, encoding: 'utf8' })
  if (build.status !== 0) throw new Error(`build:exe failed: ${build.stderr}`)
  platform.useCommand([PARTOM_EXE])
  /** Client page port. */
  const clientPort = await freePort()
  await platform.start(await freePort(), await freePort(), [`http://127.0.0.1:${clientPort}`], {
    publicDev: true
  })
  /** Manifest run (build and publish ran in `start`). */
  const manifest = platform.partom(['manifest'])
  if (manifest.code !== 0) throw new Error(`manifest failed: ${manifest.stdout}${manifest.stderr}`)
  clientUrl = `${await platform.startClient(clientPort)}?service=${encodeURIComponent(platform.catalogUrl)}`
  browser = await chromium.launch()
}, 900000)

afterAll(async () => {
  await browser?.close()
  await platform.stop()
})

/** Text of the element whose part address ends with `id`. */
function partText(page: Page, id: string): Promise<string | null> {
  return page.locator(`[data-part-address$="${id}"]`).first().textContent()
}

/** Clicks the "Create order" button and returns the notice once it shows `expected`. */
async function clickAndExpectNotice(page: Page, expected: string): Promise<void> {
  await expect
    .poll(
      async () => {
        await page.locator('[data-part-address$="button-0"]').first().click()
        return partText(page, 'notice')
      },
      { timeout: 30000 }
    )
    .toBe(expected)
}

/** Revalidates the client in the page. */
async function revalidate(page: Page): Promise<string | undefined> {
  return page.evaluate(() =>
    (globalThis as unknown as { __client: IClientGlobal }).__client.remote.revalidate().then(
      () => undefined,
      (error: { code?: string }) => error.code
    )
  )
}

/** Client reports. */
function reports(page: Page): Promise<IClientGlobal['reports']> {
  return page.evaluate(
    () => (globalThis as unknown as { __client: IClientGlobal }).__client.reports
  )
}

/** Signed-in editor page with the orders page selected. */
async function openEditor(context: BrowserContext): Promise<Page> {
  /** Editor page. */
  const page = await context.newPage()
  await page.goto(platform.editorUrl)
  await page.locator('[data-token]').fill(platform.token)
  await page.locator('[data-project]').fill('orders')
  await page.locator('[data-login] button').click()
  await page.locator('[data-blueprint="orders-page"]').click()
  return page
}

describe('whole platform program', () => {
  it('releases, edits, pulls, delivers, rejects, rolls back, starts offline and inspects', async () => {
    /** First client context. */
    const clientContext = await browser.newContext()
    /** Client page. */
    const client = await clientContext.newPage()
    /** Client console lines. */
    const clientConsole: string[] = []
    client.on('console', (message) => void clientConsole.push(message.text()))
    await client.goto(clientUrl)
    // (1) v1 is delivered across origins without a token.
    await expect.poll(() => partText(client, 'button-0'), { timeout: 60000 }).toBe('Create order')
    await clickAndExpectNotice(client, 'Order noted')
    /** V1 identity. */
    const v1 = await client.evaluate(() =>
      (globalThis as unknown as { __client: IClientGlobal }).__client.remote.current()
    )
    expect(v1?.tag).toBe('v1')
    await expect
      .poll(async () =>
        (await reports(client)).some((record) => record.address?.endsWith('boom') === true)
      )
      .toBe(true)
    /** Report of the throwing part. */
    const boom = (await reports(client)).find((record) => record.address?.endsWith('boom') === true)
    expect(boom).toMatchObject({ version: 'v1', snapshot: v1?.snapshot })

    // (2) The editor changes the button and the notify module and saves one changeset.
    /** Editor context. */
    const editorContext = await browser.newContext()
    /** Editor page. */
    const editor = await openEditor(editorContext)
    /** Button address. */
    const button = (await editor
      .locator('[data-node$="button-0"]')
      .first()
      .getAttribute('data-node')) as string
    await editor.locator(`[data-node="${button}"]`).click()
    await editor.locator(`[data-panel="${button}"] [data-field="children"]`).fill('New order')
    await editor.locator('[data-module="effects/notify.ts"]').click()
    /** Draft source of the notify module (from the v1 source record). */
    const source = await editor.locator('[data-module-source]').inputValue()
    expect(source).toContain("'Order noted'")
    await editor
      .locator('[data-module-source]')
      .fill(source.replace("'Order noted'", "'Order noted again'"))
    await editor.locator('[data-save]').click()
    await expect
      .poll(() => editor.locator('[data-result="orders-page"]').textContent(), { timeout: 60000 })
      .toContain('accepted')
    expect(await editor.locator('[data-result="effects/notify.ts"]').textContent()).toContain(
      'accepted'
    )
    expect(await revalidate(client)).toBeUndefined()
    expect(await partText(client, 'button-0')).toBe('Create order')

    // (3) pull, commit, tag v2, build, publish; the running client picks it up.
    expect(platform.partom(['pull', '--service', platform.catalogUrl]).code).toBe(0)
    platform.commit('v2')
    platform.git(['tag', 'v2'])
    /** V2 build. */
    const built = platform.partom(['build'])
    expect(built.code, built.stderr).toBe(0)
    /** V2 snapshot hash printed by the build. */
    const v2Snapshot = (
      JSON.parse(built.stdout.trim().split('\n').pop() as string) as { snapshot: string }
    ).snapshot
    expect(
      platform.partom(['publish', '--service', platform.catalogUrl, '--env', 'dev']).code
    ).toBe(0)
    expect(await revalidate(client)).toBeUndefined()
    expect(await partText(client, 'button-0')).toBe('New order')
    await clickAndExpectNotice(client, 'Order noted again')
    expect(
      await client.evaluate(
        () =>
          (globalThis as unknown as { __client: IClientGlobal }).__client.remote.current()?.snapshot
      )
    ).toBe(v2Snapshot)
    expect(clientConsole.join('\n')).not.toContain('CATALOG_CONFLICT')

    // (4) v3 needs an enhancer the client lacks and is rejected.
    /** V3 snapshot: v2 with an extra enhancer definition. */
    const v2 = JSON.parse(
      readFileSync(join(platform.dir, 'partom-build', 'snapshot.json'), 'utf8')
    ) as {
      lock: { tag: string; definitions: string[] }
      descriptors: unknown[]
    }
    v2.lock.tag = 'v3'
    v2.lock.definitions.push('missing.enhancer@1')
    v2.descriptors.push({ kind: 'enhancer', id: 'missing.enhancer@1', targets: ['button'] })
    /** V3 bytes. */
    const v3 = new TextEncoder().encode(JSON.stringify(v2))
    /** V3 hash. */
    const v3Hash = `sha256-${Buffer.from(await crypto.subtle.digest('SHA-256', v3)).toString('base64url')}`
    /** Authorization header. */
    const auth = { authorization: `Bearer ${platform.token}` }
    expect(
      (
        await fetch(`${platform.catalogUrl}/p/orders/snapshots/${v3Hash}`, {
          method: 'PUT',
          headers: auth,
          body: v3
        })
      ).ok
    ).toBe(true)
    expect(
      (
        await fetch(`${platform.catalogUrl}/p/orders/env/dev/publish`, {
          method: 'POST',
          headers: { ...auth, 'content-type': 'application/json' },
          body: JSON.stringify({ snapshot: v3Hash })
        })
      ).ok
    ).toBe(true)
    expect(await revalidate(client)).toBe('REMOTE_VERSION_REJECTED')
    expect(await partText(client, 'button-0')).toBe('New order')
    await expect
      .poll(async () =>
        (await reports(client)).some(
          (record) =>
            record.code === 'REMOTE_VERSION_REJECTED' &&
            record.message?.includes('v3') === true &&
            record.message.includes('missing.enhancer@1')
        )
      )
      .toBe(true)

    // (5) Rollback to v1.
    /** Rollback run. */
    const rollback = platform.partom([
      'rollback',
      '--service',
      platform.catalogUrl,
      '--env',
      'dev',
      '--to',
      'v1'
    ])
    expect(rollback.code, rollback.stdout + rollback.stderr).toBe(0)
    expect(await revalidate(client)).toBeUndefined()
    expect(await partText(client, 'button-0')).toBe('Create order')
    await clickAndExpectNotice(client, 'Order noted')
    /** IndexedDB state of the client origin. */
    const state = await clientContext.storageState({ indexedDB: true })

    // (6) Catalog stopped; a fresh context with the IndexedDB data starts offline.
    /** Audit before stopping the catalog. */
    const audit = (await (
      await fetch(`${platform.catalogUrl}/p/orders/audit`, { headers: auth })
    ).json()) as {
      actor: string
      at: string
      action: string
      targets: { address?: string; facet?: string }[]
    }[]
    await platform.stopCatalog()
    /** Offline context. */
    const offlineContext = await browser.newContext({ storageState: state })
    /** Offline client. */
    const offline = await offlineContext.newPage()
    await offline.goto(clientUrl)
    await expect.poll(() => partText(offline, 'button-0'), { timeout: 60000 }).toBe('Create order')
    await clickAndExpectNotice(offline, 'Order noted')

    // (7) Devtools in the editor's preview.
    /** Preview frame. */
    const frame = editor.frameLocator('[data-preview]')
    // Clicking the inert heading moves keyboard focus into the frame, so the shortcut reaches it.
    await frame.locator('[data-part-address$="h1-0"]').first().click()
    await frame.locator('body').press('Alt+Shift+KeyD')
    await frame.locator('[data-part="pick"]').click()
    await frame.locator('[data-part-address$="button-0"]').first().click()
    await expect
      .poll(() => frame.locator('[data-part="steps"]').textContent())
      .toContain('authored')

    // Audit of steps (2), (3) and (5).
    expect(audit.every((record) => record.actor === 'alice' && record.at !== '')).toBe(true)
    expect(
      audit.some(
        (record) =>
          record.action === 'changeset' &&
          record.targets.some(
            (target) => target.address?.endsWith('button-0') === true && target.facet === 'props'
          )
      )
    ).toBe(true)
    expect(audit.filter((record) => record.action === 'publish').length).toBeGreaterThanOrEqual(2)
    expect(audit.some((record) => record.action === 'rollback')).toBe(true)
  })
})
