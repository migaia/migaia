/** Text of the files `partom import` generates. */
import { dirname, relative } from 'node:path'
import type { ICommandPlan, IImportPlan, IModelPlan, IResourcePlan, ITagPlan } from './mapping.ts'
import { GeneratedText } from './text.ts'
import { zodSource, type IZodContext } from './zod-source.ts'

/** A file to write: path relative to the output directory and body text. */
export type IGeneratedFile = { readonly path: string; readonly body: string }

/** JSON literal of a value on one line. */
function literal(value: unknown): string {
  return JSON.stringify(value ?? {})
}

/** Relative import specifier from one generated file to another. */
function specifier(from: string, to: string): string {
  /** Relative path. */
  const path = relative(dirname(from), to)
  return path.startsWith('.') ? path : `./${path}`
}

/** Zod translation context of one file; records the models it references for imports. */
class FileContext {
  /** Import plan. */
  readonly #plan: IImportPlan
  /** Path of the file being generated. */
  readonly #file: string
  /** Models referenced by the file. */
  readonly used = new Set<IModelPlan>()

  /** Binds the context to a plan and a file. */
  constructor(plan: IImportPlan, file: string) {
    this.#plan = plan
    this.#file = file
  }

  /** Translation context for `zodSource`. */
  zod(): IZodContext {
    return {
      modelSchema: (ref) => this.#model(ref),
      resolver: this.#plan.resolver,
      uncertain: this.#plan.uncertain
    }
  }

  /** Import lines of the referenced models other than the file's own. */
  imports(): string[] {
    /** Lines in reference order. */
    const lines: string[] = []
    for (const model of this.used)
      if (model.file !== this.#file)
        lines.push(
          `import { ${model.constant} } from ${JSON.stringify(specifier(this.#file, model.file))}`
        )
    return lines
  }

  /** Constant of a referenced model, recorded as used. */
  #model(ref: string): string | undefined {
    /** Model of the reference. */
    const model = this.#plan.modelByRef.get(ref)
    if (model === undefined) return undefined
    this.used.add(model)
    return model.constant
  }
}

/** Body of one model file. */
function modelFile(plan: IImportPlan, model: IModelPlan): IGeneratedFile {
  /** Context of the file. */
  const context = new FileContext(plan, model.file)
  /** Schema source. */
  const schema = zodSource(model.schema, model.pointer.slice(1), context.zod())
  /** Display hints, omitted when empty. */
  const display =
    Object.keys(model.display).length === 0 ? '' : `\n  display: ${literal(model.display)},`
  return {
    path: model.file,
    body: [
      `import { defineModel } from '@migaia/part-contract'`,
      `import { z } from 'zod'`,
      ...context.imports(),
      '',
      `/** Schema of the model generated from the OpenAPI document. */`,
      `export const ${model.constant} = ${schema}`,
      '',
      `/** Model generated from the OpenAPI document. */`,
      `export default defineModel({`,
      `  id: ${JSON.stringify(model.id)},`,
      `  schema: ${model.constant},`,
      `  jsonSchema: ${literal(model.jsonSchema)},`,
      `  key: ${JSON.stringify(model.key)},${display}`,
      `})`,
      ''
    ].join('\n')
  }
}

/** Source of the request call shared by loads and commands. */
function requestSource(
  method: string,
  path: string,
  parameters: ICommandPlan['parameters'],
  source: string,
  body: boolean
): string {
  return [
    `features.http.request({`,
    `      method: ${JSON.stringify(method)},`,
    `      path: fillPath(${JSON.stringify(path)}, ${source}, ${JSON.stringify(parameters.path)}),`,
    `      query: pick(${source}, ${JSON.stringify(parameters.query)}),`,
    ...(body ? [`      body: pick(${source}, ["body"]).body,`] : []),
    `      signal`,
    `    })`
  ].join('\n')
}

/** Source of one command entry. */
function commandSource(
  plan: IImportPlan,
  context: FileContext,
  tag: string,
  command: ICommandPlan
): string {
  return [
    `    ${JSON.stringify(command.name)}: {`,
    `      args: ${zodSource(command.args, command.pointer.slice(1), context.zod())},`,
    `      argsJsonSchema: ${literal(plan.resolver.inline(command.args, command.pointer.slice(1)))},`,
    `      invalidates: () => [${JSON.stringify(tag)}],`,
    `      run: (args, { features, signal }) =>`,
    `        ${requestSource(command.method, command.path, command.parameters, 'args', command.hasBody).replaceAll('\n', '\n    ')}`,
    `    }`
  ].join('\n')
}

/** Source of one resource definition. */
function resourceSource(
  plan: IImportPlan,
  context: FileContext,
  tag: string,
  resource: IResourcePlan
): string {
  /** Result JSON Schema, when the operation declares one. */
  const result =
    resource.result === undefined
      ? ''
      : `\n  resultJsonSchema: ${literal(plan.resolver.inline(resource.result, resource.pointer.slice(1)))},`
  return [
    `/** Resource generated from the OpenAPI document. */`,
    `export const ${resource.constant} = defineResource({`,
    `  id: ${JSON.stringify(resource.id)},`,
    `  params: ${zodSource(resource.params, resource.pointer.slice(1), context.zod())},`,
    `  paramsJsonSchema: ${literal(plan.resolver.inline(resource.params, resource.pointer.slice(1)))},${result}`,
    `  deps: { http: httpFeature },`,
    `  tags: () => [${JSON.stringify(tag)}],`,
    `  load: (params, { features, signal }) =>`,
    `    ${requestSource('GET', resource.path, resource.parameters, 'params', false)},`,
    `  commands: {`,
    resource.commands.map((command) => commandSource(plan, context, tag, command)).join(',\n'),
    `  }`,
    `})`
  ].join('\n')
}

/** Body of one tag's resource file. */
function tagFile(plan: IImportPlan, tag: ITagPlan): IGeneratedFile {
  /** Context of the file. */
  const context = new FileContext(plan, tag.file)
  /** Resource sources. */
  const resources = tag.resources.map((resource) =>
    resourceSource(plan, context, tag.tag, resource)
  )
  return {
    path: tag.file,
    body: [
      `import { defineResource } from '@migaia/part-host'`,
      `import { z } from 'zod'`,
      `import { fillPath, httpFeature, pick } from ${JSON.stringify(specifier(tag.file, 'http.ts'))}`,
      ...context.imports(),
      '',
      resources.join('\n\n'),
      ''
    ].join('\n')
  }
}

/** Body of the HTTP Feature file. */
function httpFile(): IGeneratedFile {
  return {
    path: 'http.ts',
    body: `import { definePlugin } from '@migaia/plugin-host'
import { defineFeature } from '@migaia/plugin-host/features'

/** Message of the error thrown on a non-2xx response. */
const HTTP_FAILED = ${JSON.stringify(GeneratedText.httpFailed)}

/** Options of the HTTP Feature: the API base URL and an optional fetch (for auth or tests). */
export type IHttpOptions = { readonly baseUrl: string; readonly fetch?: typeof fetch }

/** One request of a generated resource. */
export type IHttpRequest = {
  readonly method: string
  readonly path: string
  readonly query?: Readonly<Record<string, unknown>>
  readonly body?: unknown
  readonly signal?: AbortSignal
}

/** HTTP client the generated resources call; JSON in, JSON out. */
export class HttpClient {
  /** Client options. */
  readonly #options: IHttpOptions

  /** Binds the client to its options. */
  constructor(options: IHttpOptions) {
    this.#options = options
  }

  /** Sends a request; a non-2xx status throws an error carrying \`status\` and the response text. */
  async request(request: IHttpRequest): Promise<unknown> {
    /** Absolute URL with the query string. */
    const url = new URL(request.path.replace(/^\\//, ''), this.#options.baseUrl.endsWith('/') ? this.#options.baseUrl : \`\${this.#options.baseUrl}/\`)
    for (const [key, value] of Object.entries(request.query ?? {}))
      if (value !== undefined) url.searchParams.set(key, String(value))
    /** Response of the request. */
    const response = await (this.#options.fetch ?? fetch)(url, {
      method: request.method,
      signal: request.signal,
      ...(request.body === undefined ? {} : { body: JSON.stringify(request.body), headers: { 'content-type': 'application/json' } })
    })
    /** Response text. */
    const text = await response.text()
    if (!response.ok) throw Object.assign(new Error(HTTP_FAILED), { status: response.status, body: text })
    return text === '' ? undefined : JSON.parse(text)
  }
}

/** Creates the plugin providing the HTTP Feature; install it next to the generated api plugin. */
export function createHttpPlugin(options: IHttpOptions) {
  return definePlugin({
    name: ${JSON.stringify(GeneratedText.httpPlugin)},
    features: { http: defineFeature(() => new HttpClient(options)) },
    install: () => ({})
  })
}

/** Reference to the HTTP Feature; it resolves to whichever ${JSON.stringify(GeneratedText.httpPlugin)} plugin is installed. */
export const httpFeature = createHttpPlugin({ baseUrl: 'http://localhost/' }).getFeature('http')

/** Path with \`{name}\` segments replaced by encoded parameter values. */
export function fillPath(path: string, values: unknown, names: readonly string[]): string {
  /** Parameter values. */
  const record = (values ?? {}) as Readonly<Record<string, unknown>>
  /** Filled path. */
  let filled = path
  for (const name of names) filled = filled.replace(\`{\${name}}\`, encodeURIComponent(String(record[name])))
  return filled
}

/** The named fields of a value. */
export function pick(values: unknown, names: readonly string[]): Record<string, unknown> {
  /** Parameter values. */
  const record = (values ?? {}) as Readonly<Record<string, unknown>>
  /** Picked fields. */
  const picked: Record<string, unknown> = {}
  for (const name of names) picked[name] = record[name]
  return picked
}
`
  }
}

/** Body of the index file. */
function indexFile(plan: IImportPlan): IGeneratedFile {
  /** Import lines of models and resource files. */
  const imports: string[] = []
  /** Model import names. */
  const models: string[] = []
  plan.models.forEach((model, index) => {
    models.push(`model${index}`)
    imports.push(`import model${index} from ${JSON.stringify(specifier('index.ts', model.file))}`)
  })
  /** Every resource constant. */
  const constants: string[] = []
  for (const tag of plan.tags) {
    /** Constants of the tag's file. */
    const names: string[] = []
    for (const resource of tag.resources) names.push(resource.constant)
    constants.push(...names)
    imports.push(
      `import { ${names.join(', ')} } from ${JSON.stringify(specifier('index.ts', tag.file))}`
    )
  }
  return {
    path: 'index.ts',
    body: [
      `import { definePartPlugin } from '@migaia/part-host'`,
      ...imports,
      '',
      `export { createHttpPlugin, httpFeature } from './http.ts'`,
      ...(constants.length === 0 ? [] : [`export { ${constants.join(', ')} }`]),
      '',
      `/** Plugin registering every generated model and resource. */`,
      `export const apiPlugin = definePartPlugin({`,
      `  name: ${JSON.stringify(GeneratedText.apiPlugin)},`,
      `  models: [${models.join(', ')}],`,
      `  resources: [${constants.join(', ')}]`,
      `})`,
      ''
    ].join('\n')
  }
}

/** Every file of an import plan, in a stable order. */
export function generatedFiles(plan: IImportPlan): IGeneratedFile[] {
  return [
    httpFile(),
    ...plan.models.map((model) => modelFile(plan, model)),
    ...plan.tags.map((tag) => tagFile(plan, tag)),
    indexFile(plan)
  ]
}
