/** Security rules: secrets must never be written into blueprints. */
import { isResourceBinding } from '../data.ts'
import { defineRule, type IRuleContext } from '../rules.ts'
import { target } from './shared.ts'

/** Facet groups whose values are scanned; fixed size five. */
const VALUE_FACETS = ['props', 'attrs', 'aria', 'data', 'style'] as const

/**
 * Fixed secret signatures (compile-time list of five): private-key headers, AWS access key ids,
 * GitHub personal tokens, `sk-` API keys and Slack bot/user tokens. A match is a minimum defence;
 * missing a secret is possible, a match is never a false positive worth keeping in a blueprint.
 */
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /AKIA[0-9A-Z]{16}/,
  /ghp_[A-Za-z0-9]{36}/,
  /sk-[A-Za-z0-9]{20,}/,
  /xox[bp]-/
] as const

/** Key names whose non-empty literal string value is treated as a secret; fixed size four. */
const SECRET_KEYS = new Set(['password', 'secret', 'token', 'apiKey'])

/** True when a key/value pair looks like a secret. The value is only tested, never returned. */
function isSecret(key: string, value: unknown): boolean {
  if (typeof value !== 'string') return false
  if (SECRET_KEYS.has(key) && value !== '') return true
  return SECRET_PATTERNS.some((pattern) => pattern.test(value))
}

/**
 * Reports configuration values (value facets and resource binding parameters) that match a secret
 * signature. The issue names the address, facet and key only; it never carries the value.
 */
function checkSecrets(context: IRuleContext<unknown>): void {
  /** Node under check. */
  const { node, address } = target(context)
  for (const facet of VALUE_FACETS)
    for (const [key, value] of Object.entries(node.facets?.[facet] ?? {})) {
      if (isSecret(key, value))
        context.report({ address, facet, path: key, messageKey: 'security.secret' })
      if (!isResourceBinding(value)) continue
      for (const [name, param] of Object.entries(value.params ?? {}))
        if (isSecret(name, param))
          context.report({
            address,
            facet,
            path: `${key}.params.${name}`,
            messageKey: 'security.secret'
          })
    }
}

/** Security rule set. */
export const securityRules = [
  defineRule({
    id: 'security.secret',
    scope: 'part',
    phase: ['authored'],
    severity: 'error',
    check: checkSecrets
  })
]
