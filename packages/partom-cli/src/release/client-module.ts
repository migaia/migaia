/**
 * Text of the generated client module (`partom manifest`). It exports `manifest`, `shared`,
 * `chunks`, `lazyPartsPlugin` and `inlined` for `remotePlugin` and the application's host.
 */
import type { IDescriptor } from '@migaia/part-contract'

/** One chunk of the client module: the import specifier of a part module and its part ids. */
export type IClientChunk = { readonly specifier: string; readonly parts: readonly IDescriptor[] }

/** Input of the generated module. */
export type IClientModuleInput = {
  readonly manifest: unknown
  readonly chunks: readonly IClientChunk[]
  /** Snapshot text of the inlined blueprints, or undefined without `--inline`. */
  readonly inlined: string | undefined
}

/** Fixed head of the module: shared runtime namespaces and the lazy binding helpers. */
const HEAD = `import * as partContract from '@migaia/part-contract'
import * as partHost from '@migaia/part-host'
import { definePartPlugin, type IPartDefinition, type IPartImplementation } from '@migaia/part-host'
import { bindReactComponent } from '@migaia/part-plugin-react'
import * as react from 'react'
import * as reactJsxRuntime from 'react/jsx-runtime'
import { createElement, useEffect, useState, type ComponentType, type ReactNode } from 'react'

/** Shared runtime handed to remotePlugin({ shared }); remote modules use these same copies. */
export const shared = {
  '@migaia/part-host': partHost,
  '@migaia/part-contract': partContract,
  react,
  'react/jsx-runtime': reactJsxRuntime
}

/** React bindings of loaded part modules by part id. */
const loaded = new Map<string, { readonly component: ComponentType<Record<string, unknown>> }>()

/** Records the React bindings a loaded part module exports. */
function record(module: Record<string, unknown>): void {
  for (const value of Object.values(module)) {
    const binding = value as Partial<IPartImplementation> | null
    if (binding?.renderer === 'react' && typeof binding.partId === 'string')
      loaded.set(binding.partId, binding.value as { readonly component: ComponentType<Record<string, unknown>> })
  }
}

/** Component standing in for a lazy part: empty until its module is loaded, then the real one. */
function lazyComponent(id: string): ComponentType<Record<string, unknown>> {
  return function LazyPart(props: Record<string, unknown>): ReactNode {
    const binding = loaded.get(id)
    const [, refresh] = useState(0)
    useEffect(() => {
      if (binding === undefined) void chunks[id]?.().then(() => refresh((count) => count + 1))
    }, [binding])
    return binding === undefined ? null : createElement(binding.component, props)
  }
}
`

/** Source line of one chunk loader entry. */
function chunkEntry(id: string, specifier: string): string {
  return `  ${JSON.stringify(id)}: () => import(${JSON.stringify(specifier)}).then(record),`
}

/**
 * Module text. Part descriptors are written as JSON literals so registering them imports nothing;
 * `chunks` imports each part module on demand and records its bindings.
 */
export function clientModuleText(input: IClientModuleInput): string {
  /** Lines of the module. */
  const lines = [HEAD]
  lines.push(`/** Capabilities this client build provides locally. */`)
  lines.push(`export const manifest = ${JSON.stringify(input.manifest)} as const`, '')
  lines.push(`/** Part module loaders by part id, for remotePlugin({ chunks }). */`)
  lines.push(`export const chunks: Readonly<Record<string, () => Promise<void>>> = {`)
  for (const chunk of input.chunks)
    for (const part of chunk.parts) lines.push(chunkEntry(part.id, chunk.specifier))
  lines.push('}', '')
  lines.push(
    `/** Lazy part definitions: descriptors only, bound to components that load on demand. */`
  )
  lines.push(`const lazyParts: readonly IPartDefinition<unknown>[] = [`)
  for (const chunk of input.chunks)
    for (const part of chunk.parts) lines.push(`  { descriptor: ${JSON.stringify(part)} },`)
  lines.push(']', '')
  lines.push(`/** Registers every lazy part now; each renders its real component once loaded. */`)
  lines.push(`export const lazyPartsPlugin = definePartPlugin({`)
  lines.push(`  name: 'partom-lazy-parts',`)
  lines.push(`  parts: lazyParts,`)
  lines.push(
    `  implementations: lazyParts.map((part) => bindReactComponent(part, lazyComponent(part.descriptor.id)))`
  )
  lines.push('})', '')
  lines.push(`/** Snapshot bytes of the inlined blueprints, for remotePlugin({ fallback }). */`)
  lines.push(
    input.inlined === undefined
      ? `export const inlined: Uint8Array | undefined = undefined`
      : `export const inlined: Uint8Array | undefined = new TextEncoder().encode(${JSON.stringify(input.inlined)})`
  )
  return `${lines.join('\n')}\n`
}
