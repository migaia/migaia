import { spawnSync } from 'node:child_process'
import { once } from 'node:events'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { join } from 'node:path'
import type { Browser, Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LandingProject, lastJson, type IUsageReport } from './landing-support.ts'
import { launchBrowser, PreviewProcess } from './preview-support.ts'
import { BUN } from './run.ts'

/** Package root. */
const ROOT = join(import.meta.dirname, '..')

/** One order kept by the test backend. */
type IOrder = { readonly id: string; readonly customer: string; readonly status: string }

/**
 * Orders backend of the fixture. `GET /orders?status=open` answers after a delay (so the loading
 * slot is visible), `closed` answers an empty list, `archived` answers 500; `POST /orders`
 * appends.
 */
class OrdersBackend {
  /** Orders by status `open`. */
  readonly orders: IOrder[] = [
    { id: '1', customer: 'Acme', status: 'open' },
    { id: '2', customer: 'Globex', status: 'open' }
  ]
  /** Bodies of the received POST requests. */
  readonly posts: unknown[] = []
  /** HTTP server. */
  readonly server: Server = createServer(
    (request, response) => void this.#handle(request, response)
  )

  /** Base URL once listening. */
  get url(): string {
    return `http://127.0.0.1:${(this.server.address() as AddressInfo).port}/`
  }

  /** Answers one request; every answer allows the preview origin. */
  async #handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('access-control-allow-origin', '*')
    response.setHeader('access-control-allow-headers', 'content-type')
    response.setHeader('access-control-allow-methods', 'GET, POST')
    /** Request URL. */
    const url = new URL(request.url ?? '/', 'http://backend.test')
    if (request.method === 'OPTIONS') return void response.writeHead(204).end()
    if (request.method === 'POST' && url.pathname === '/orders') {
      /** Body chunks. */
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(chunk as Buffer)
      /** New order fields. */
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { customer: string }
      this.posts.push(body)
      /** Stored order. */
      const order = { id: String(this.orders.length + 1), customer: body.customer, status: 'open' }
      this.orders.push(order)
      return void response
        .writeHead(201, { 'content-type': 'application/json' })
        .end(JSON.stringify(order))
    }
    /** Requested status. */
    const status = url.searchParams.get('status')
    if (status === 'archived') return void response.writeHead(500).end('failed')
    if (status === 'open') await new Promise((resolve) => setTimeout(resolve, 400))
    response
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(status === 'open' ? this.orders : []))
  }
}

/** Fixture copy run by the compiled executable. */
let project: LandingProject
/** Test backend. */
let backend: OrdersBackend
/** Headless browser. */
let browser: Browser
/** Environment of every `partom` run. */
let env: Record<string, string> = {}

beforeAll(async () => {
  /** Build of the doctor runner, page runtime and executable. */
  const build = spawnSync(BUN, ['run', 'build:exe'], { cwd: ROOT, encoding: 'utf8' })
  expect(build.status).toBe(0)
  project = new LandingProject('landing-run-', [join(ROOT, 'dist', 'partom')])
  backend = new OrdersBackend()
  backend.server.listen(0, '127.0.0.1')
  await once(backend.server, 'listening')
  env = { PARTOM_PUBLIC_ORDERS_API_URL: backend.url }
  browser = await launchBrowser()
})

afterAll(async () => {
  await browser.close()
  backend.server.close()
  project.remove()
})

/** Addresses of the rendered table rows. */
function rowAddresses(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-part-address*="@row:"]')]
      .map((element) => element.getAttribute('data-part-address') as string)
      .filter((address) => /\/row@row:[^/]+$/.test(address))
  )
}

/** Picks a status in the Radix select of the page. */
async function pickStatus(page: Page, label: string): Promise<void> {
  await page.locator('[data-slot="select-trigger"]').click()
  await page.getByRole('option', { name: label }).click()
}

describe('orders admin end to end with the compiled executable', () => {
  it('imports, extracts, converts, types, checks and runs the orders page', async () => {
    /** Import of the API. */
    const imported = project.partom(['import', 'openapi.json', '--out', 'src/api'], env)
    expect(imported.code).toBe(0)

    /** Component extraction with the pattern probe and round-trip check. */
    const extracted = project.partom(
      [
        'extract',
        ...project.componentFiles(),
        '--out',
        'src/parts',
        '--probe',
        '--verify',
        '--config',
        'probe.config.ts'
      ],
      env
    )
    expect(extracted.code).toBe(0)
    /** Printed lines: summary, then differences. */
    const lines = extracted.stdout.trim().split('\n')
    /** Extraction summary. */
    const summary = (JSON.parse(lines[0] as string) as { summary: Record<string, number | null> })
      .summary
    for (const key of ['components', 'componentsClean', 'patternChecked', 'patternPassed'])
      expect(summary[key]).not.toBeNull()
    expect(JSON.parse(lines[1] as string)).toEqual({ differences: [] })

    /** Usage conversion. */
    const usage = project.partom(
      [
        'extract',
        '--usage',
        'pages/orders-page.tsx',
        '--parts',
        'src/parts',
        '--out',
        'src/blueprints'
      ],
      env
    )
    expect(usage.code).toBe(0)
    /** Usage summary. */
    const counts = lastJson<IUsageReport>(usage).summary
    expect(counts.usageNodes).toBeGreaterThan(0)
    expect(counts.usageConverted).not.toBeNull()

    expect(project.applyReview().code).toBe(0)
    expect(project.partom(['types'], env).code).toBe(0)
    /** Type check of the project. */
    const checked = project.tsc()
    expect(checked.stdout).toBe('')
    expect(checked.code).toBe(0)
    /** Rendered doctor. */
    const doctor = project.partom(['doctor', '--rendered', '--json'], env)
    expect(doctor.code).toBe(0)
    expect(
      lastJson<{ issues: { severity: string }[] }>(doctor).issues.filter(
        (issue) => issue.severity === 'error'
      )
    ).toEqual([])

    /** Preview of the converted page. */
    const preview = new PreviewProcess(
      project.dir,
      ['orders-page'],
      [join(ROOT, 'dist', 'partom')],
      env
    )
    try {
      expect(await preview.ready()).toBeUndefined()
      /** Browser page. */
      const page = await browser.newPage()
      await page.goto(`${preview.base}b/orders-page`)
      await page.getByText('Loading orders').waitFor()
      await page.getByRole('cell', { name: 'Globex' }).waitFor()
      expect((await rowAddresses(page)).map((address) => address.split('@row:')[1])).toEqual([
        '1',
        '2'
      ])

      await pickStatus(page, 'Closed')
      await page.getByText('No orders').waitFor()
      await pickStatus(page, 'Archived')
      await page.getByText('Orders failed to load').waitFor()
      await pickStatus(page, 'Open')
      await page.getByRole('cell', { name: 'Globex' }).waitFor()

      await page.getByRole('button', { name: 'Create order' }).click()
      await page.waitForFunction(
        () => (document.querySelector('p[id$="-message"]')?.textContent ?? '') !== ''
      )
      expect(backend.posts).toEqual([])

      await page.getByPlaceholder('Customer name').fill('Initech')
      await page.getByRole('button', { name: 'Create order' }).click()
      await page.getByRole('cell', { name: 'Initech' }).waitFor()
      expect(backend.posts).toEqual([{ customer: 'Initech' }])
      expect(await page.locator('p[id$="-message"]').count()).toBe(0)
      await page.close()
    } finally {
      await preview.stop()
    }

    /** Generated resource file. */
    const resource = 'src/api/resources/orders.ts'
    /** Edited text. */
    const edited = project.read(resource).replace('export const', '// reviewed\nexport const')
    project.write(resource, edited)
    /** Second import. */
    const again = project.partom(['import', 'openapi.json', '--out', 'src/api'], env)
    expect(again.code).toBe(0)
    expect(lastJson<{ takenOver: string[] }>(again).takenOver).toEqual(['resources/orders.ts'])
    expect(project.read(resource)).toBe(edited)
  })
})
