/**
 * Prints the complete skeleton a library reference must fill: every entry point, runtime symbol,
 * options field, enum value, type and member that `reference.ts` will check, with the declaration
 * signature and source JSDoc as `// src:` hints. Start a new `app/reference/<lib>.ts` from this
 * output, then replace every empty string after reading the package source; never copy a hint as
 * the final text (hints are often English-only or incomplete).
 *
 * Usage: bun scripts/audit/reference-scaffold.ts <library> > /tmp/<library>-skeleton.ts
 */
import { readFileSync } from 'node:fs'
import type { IApiSymbol } from '../../app/content-contract.ts'
import type { IManifestModule } from '../../app/reference/rules.ts'
import {
  callableShape,
  constantMembers,
  fieldLiteralValues,
  instanceSurface,
  returnedInstances
} from '../../app/reference/surface.ts'

/** Library slug to scaffold. */
const library = process.argv[2]
if (!library) {
  console.error('usage: bun scripts/audit/reference-scaffold.ts <library>')
  process.exit(2)
}
const manifest = JSON.parse(
  readFileSync(
    new URL(`../../src/generated/manifests/libraries/${library}.json`, import.meta.url),
    'utf8'
  )
) as { apis: IManifestModule[] }

/** Empty bilingual text literal. */
const EMPTY = "{ en: '', zh: '' }"

/** One-line hint from generated prose. */
function hint(text: string | null | undefined): string {
  const line = (text ?? '').replace(/\s+/g, ' ').trim()
  return line ? ` // src: ${line.slice(0, 160)}` : ''
}

/** Quotes an object key when it is not a plain identifier. */
function key(name: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `'${name}'`
}

/** Output lines. */
const out: string[] = []
/** Types shown as instances; they need scenarios and an example. */
const instanceTypes = new Set<string>()
for (const api of manifest.apis)
  for (const symbol of api.symbols) {
    for (const { type } of returnedInstances(symbol, api.symbols)) instanceTypes.add(type.name)
    if (symbol.kind === 'class') instanceTypes.add(symbol.name)
  }

/** Picks the named options type whose members cover every configuration field. */
function optionsType(symbol: IApiSymbol, symbols: readonly IApiSymbol[]): string | undefined {
  if (symbol.configuration.length === 0) return undefined
  const names = symbol.configuration.map((field) => field.name)
  return symbols.find(
    (candidate) =>
      (candidate.kind === 'type' || candidate.kind === 'interface') &&
      new RegExp(`\\b${candidate.name}\\b`).test(symbol.signature) &&
      names.every((name) =>
        instanceSurface(candidate, symbols).members.some((member) => member.name === name)
      )
  )?.name
}

out.push(`import type { ILibraryReference } from './contract.js'`, '')
out.push(`export const reference: ILibraryReference = {`, '  modules: {')
for (const api of manifest.apis) out.push(`    ${key(api.module)}: { summary: ${EMPTY} },`)
out.push('  },', '  symbols: {')
for (const api of manifest.apis)
  for (const symbol of api.symbols) {
    if (symbol.kind === 'type' || symbol.kind === 'interface') continue
    out.push(
      `    // ${api.module} · ${symbol.kind} · ${symbol.signature.replace(/\s+/g, ' ').slice(0, 200)}`
    )
    out.push(`    ${key(symbol.name)}: {`)
    out.push(
      `      role: '${constantMembers(symbol).length ? 'constant' : callableShape(symbol) ? 'operation' : symbol.kind === 'class' ? 'factory' : 'constant'}', // factory | enhancer | operation | constant | error`
    )
    out.push(`      purpose: ${EMPTY},${hint(symbol.purpose)}`)
    const shape = callableShape(symbol)
    if (shape) {
      const options = optionsType(symbol, api.symbols)
      const parameters = shape.parameters.filter(
        (parameter) => !(parameter.name === 'options' && symbol.configuration.length > 0)
      )
      if (parameters.length) {
        out.push('      params: {')
        for (const parameter of parameters)
          out.push(`        ${key(parameter.name)}: ${EMPTY}, // ${parameter.type}`)
        out.push('      },')
      }
      if (!/^(?:void|Promise<void>)$/.test(shape.returns.trim()))
        out.push(`      returns: ${EMPTY}, // ${shape.returns.slice(0, 120)}`)
      if (options)
        out.push(`      options: '${options}', // document fields in types.${options}.members`)
      else if (symbol.configuration.length) {
        out.push('      optionDocs: {')
        for (const field of symbol.configuration) {
          const literal = fieldLiteralValues(field.type, api.symbols)
          out.push(`        ${key(field.name)}: {${hint(field.description)}`)
          out.push(`          summary: ${EMPTY},`)
          if (field.optional) out.push(`          default: ${EMPTY},`)
          if (literal)
            out.push(
              literal.enumName
                ? `          values: { enum: '${literal.enumName}' },`
                : `          values: { ${literal.values.map((value) => `${key(value)}: ${EMPTY}`).join(', ')} },`
            )
          out.push('        },')
        }
        out.push('      },')
      }
    }
    out.push(`      example: \`\`,`)
    out.push('    },')
  }
out.push('  },', '  types: {')
for (const api of manifest.apis)
  for (const symbol of api.symbols) {
    if (symbol.kind !== 'type' && symbol.kind !== 'interface' && symbol.kind !== 'class') continue
    const surface = instanceSurface(symbol, api.symbols)
    out.push(
      `    // ${api.module} · ${symbol.kind}${instanceTypes.has(symbol.name) ? ' · INSTANCE (scenarios + example + member examples)' : ''}`
    )
    out.push(`    ${key(symbol.name)}: {`)
    out.push(`      summary: ${EMPTY},${hint(symbol.purpose)}`)
    if (instanceTypes.has(symbol.name)) out.push('      scenarios: [],', '      example: ``,')
    out.push('      members: {')
    /** Overloads share one doc. */
    const seen = new Set<string>()
    for (const member of surface.members) {
      if (seen.has(member.name)) continue
      seen.add(member.name)
      out.push(`        // ${member.signature.replace(/\s+/g, ' ').slice(0, 180)}`)
      out.push(`        ${key(member.name)}: {${hint(member.description)}`)
      out.push(`          summary: ${EMPTY},`)
      if (member.kind === 'method') {
        if (member.parameterDetails.length) {
          out.push('          params: {')
          for (const parameter of member.parameterDetails)
            out.push(`            ${key(parameter.name)}: ${EMPTY},`)
          out.push('          },')
        }
        out.push(`          returns: ${EMPTY},`)
        if (instanceTypes.has(symbol.name)) out.push('          example: ``,')
      } else if (/\?:/.test(member.signature))
        out.push(`          default: ${EMPTY}, // only when this type is an options bag`)
      const literal = fieldLiteralValues(member.returns, api.symbols)
      if (literal && member.kind === 'property')
        out.push(
          literal.enumName
            ? `          values: { enum: '${literal.enumName}' },`
            : `          values: { ${literal.values.map((value) => `${key(value)}: ${EMPTY}`).join(', ')} },`
        )
      out.push('        },')
    }
    out.push('      },', '    },')
  }
out.push('  },', '  enums: {')
for (const api of manifest.apis)
  for (const symbol of api.symbols) {
    const members = constantMembers(symbol)
    if (!members.length) continue
    out.push(`    ${key(symbol.name)}: {`, `      summary: ${EMPTY},`, '      values: {')
    for (const member of members)
      out.push(`        ${key(member.key)}: ${EMPTY},${hint(member.description)}`)
    out.push('      },', '    },')
  }
out.push('  },', '  enhancers: {}', '}')
console.log(out.join('\n'))
