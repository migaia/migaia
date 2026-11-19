import { existsSync } from 'node:fs'
import type { Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CLI, LandingProject } from './landing-support.ts'
import { launchBrowser, PreviewProcess } from './preview-support.ts'
import { BUN } from './run.ts'

/** Extracted component as written to the report. */
type IEntry = {
  readonly component: string
  readonly partId: string
  readonly field?: Record<string, string>
  readonly events: Record<string, string>
  readonly mapping: { readonly events?: Record<string, string> }
  readonly substitute?: string
  readonly uncertain: readonly string[]
}

/** Project shared by the cases. */
let project: LandingProject
/** Headless browser. */
let browser: Browser
/** Summary and verification output of the extraction. */
let printed: string[] = []

/** Component files of the form and table extraction. */
const FILES = ['input', 'checkbox', 'select', 'form', 'data-table', 'table'].map(
  (name) => `components/ui/${name}.tsx`
)

/** Report entries by component name. */
function entries(): Map<string, IEntry> {
  /** Report document. */
  const report = JSON.parse(project.read('src/parts/report.json')) as { components: IEntry[] }
  return new Map(report.components.map((entry) => [entry.component, entry]))
}

beforeAll(async () => {
  project = new LandingProject('landing-extract-')
  /** Extraction of the drafts. */
  const run = project.partom(['extract', ...FILES, '--out', 'src/parts'])
  expect(run.stderr).toBe('')
  expect(run.code).toBe(0)
  /** Round-trip check of the written drafts. */
  const verified = project.partom([
    'extract',
    ...FILES,
    '--out',
    'src/parts',
    '--verify',
    '--config',
    'probe.config.ts'
  ])
  expect(verified.code).toBe(0)
  printed = [run.stdout.trim(), verified.stdout.trim()]
  browser = await launchBrowser()
})

afterAll(async () => {
  await browser.close()
  project.remove()
})

describe('partom extract on shadcn form controls and tables', () => {
  it('infers field protocols, replaces form.tsx and generates the resource-bound DataTable', () => {
    /** Entries by component. */
    const byName = entries()
    expect(byName.get('Input')).toMatchObject({
      field: { value: 'value', change: 'change', read: 'target-value' },
      mapping: { events: { change: 'onChange' } }
    })
    expect(byName.get('Checkbox')).toMatchObject({
      field: { value: 'checked', change: 'checkedChange', read: 'detail' },
      mapping: { events: { checkedChange: 'onCheckedChange' } }
    })
    expect(byName.get('Select')).toMatchObject({
      field: { value: 'value', change: 'valueChange', read: 'detail' },
      mapping: { events: { valueChange: 'onValueChange' } }
    })
    /** Form-file entries. */
    const form = [...byName.values()].filter((entry) => entry.substitute === 'form')
    expect(
      form
        .map((entry) => entry.partId)
        .filter(Boolean)
        .sort()
    ).toEqual([
      'form-control@1',
      'form-description@1',
      'form-item@1',
      'form-label@1',
      'form-message@1'
    ])
    expect(existsSync(project.path('src/parts/form.part.tsx'))).toBe(true)

    project.write(
      'table-check.ts',
      [
        "import { dataTablePart } from './src/parts/data-table.part.tsx'",
        'console.log(JSON.stringify(dataTablePart.descriptor))'
      ].join('\n')
    )
    /** Descriptor of the generated DataTable part. */
    const descriptor = JSON.parse(project.bun('table-check.ts').stdout) as Record<string, unknown>
    expect(descriptor).toMatchObject({
      id: 'data-table@1',
      behavior: {
        resource: { prop: 'source', slots: { loading: 'loading', empty: 'empty', error: 'error' } }
      }
    })
    expect(Object.keys(descriptor.slots as object).sort()).toEqual([
      'empty',
      'error',
      'header',
      'loading'
    ])
    expect('template' in descriptor).toBe(false)

    /** Summary of the extraction. */
    const summary = (JSON.parse(printed[0] as string) as { summary: Record<string, unknown> })
      .summary
    /** Report entries that are parts (Form and FormField wrappers get none). */
    const parts = [...byName.values()].filter((entry) => entry.partId !== '')
    /** Clean components counted from the report. */
    const clean = parts.filter((entry) => entry.uncertain.length === 0).length
    expect(summary).toMatchObject({
      components: parts.length,
      componentsClean: clean,
      patternChecked: null,
      patternPassed: null
    })
    expect([byName.size, parts.length]).toEqual([21, 19])
    expect(JSON.parse(printed[1] as string)).toEqual({ differences: [] })
  })

  it('links label, control and message ids when the substitutes render through the part renderer', async () => {
    project.write(
      'form-check.blueprint.json',
      JSON.stringify({
        id: 'form-check',
        version: 1,
        root: {
          tag: 'form-item@1',
          id: 'item',
          children: [
            { tag: 'form-label@1', id: 'label', facets: { props: { children: 'Customer' } } },
            {
              tag: 'form-control@1',
              id: 'control',
              facets: { props: { invalid: true } },
              children: [
                {
                  tag: 'input@1',
                  id: 'input',
                  facets: { props: { value: { $state: 'page.customer' } } }
                }
              ]
            },
            { tag: 'form-message@1', id: 'message', facets: { props: { message: 'Required' } } }
          ]
        }
      })
    )
    project.write(
      'form-check.config.ts',
      [
        "import { definePartPlugin } from '@migaia/part-host'",
        "import formPlugin from './src/parts/form.part.tsx'",
        "import { inputBinding, inputPart } from './src/parts/input.part.ts'",
        "export default { plugins: [formPlugin, definePartPlugin({ name: 'ui', parts: [inputPart], implementations: [inputBinding] })], blueprints: ['form-check.blueprint.json'] }"
      ].join('\n')
    )
    /** Preview of the check blueprint. */
    const preview = new PreviewProcess(
      project.dir,
      ['form-check', '--config', 'form-check.config.ts'],
      [BUN, CLI]
    )
    try {
      expect(await preview.ready()).toBeUndefined()
      /** Page of the blueprint. */
      const page = await browser.newPage()
      await page.goto(`${preview.base}b/form-check`)
      await page.waitForFunction(
        () => document.querySelector('input')?.getAttribute('aria-invalid') === 'true'
      )
      /** Linked attributes. */
      const linked = await page.evaluate(() => {
        /** Rendered input. */
        const input = document.querySelector('input') as HTMLInputElement
        return {
          labelFor: document.querySelector('label')?.htmlFor,
          inputId: input.id,
          describedBy: input.getAttribute('aria-describedby')?.split(' ') ?? [],
          messageId: [...document.querySelectorAll('p')].find((p) => p.textContent === 'Required')
            ?.id
        }
      })
      expect(linked.inputId).not.toBe('')
      expect(linked.labelFor).toBe(linked.inputId)
      expect(linked.describedBy).toContain(linked.messageId)
      await page.close()
    } finally {
      await preview.stop()
    }
  })
})
