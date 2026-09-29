import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../src/core/adapters/memory.js'
import { RpcError } from '../../src/core/errors.js'
import { RpcCoreErrorText } from '../../src/core/error-text.js'
import { createFullEndpoint } from '../../src/core/full.js'
import { RpcVariationCoordinator } from '../../src/core/internal/variation-coordinator.js'
import { connect } from '../../src/core/middleware/connect.js'

/** Find literal error messages within one method, leaving unrelated legacy methods alone. */
function hasInlineErrorText(file: string, method: string): boolean {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  let inline = false
  /** Inspect only constructors that can emit a package-boundary error. */
  function visit(node: ts.Node): void {
    if (ts.isNewExpression(node)) {
      const name = node.expression.getText(source)
      if (name === 'TypeError' || name === 'Error' || name === 'RpcError') {
        const message = node.arguments?.[name === 'RpcError' ? 1 : 0]
        if (
          message &&
          (ts.isStringLiteral(message) ||
            ts.isNoSubstitutionTemplateLiteral(message) ||
            ts.isTemplateExpression(message))
        )
          inline = true
      }
    }
    ts.forEachChild(node, visit)
  }
  /** Locate the named owner method before checking its error constructors. */
  function find(node: ts.Node): void {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === method) visit(node)
    else ts.forEachChild(node, find)
  }
  find(source)
  return inline
}

describe('canonical control registration texts (A14–A15)', () => {
  it('keeps duplicate variation registration native and moves its message to core text', () => {
    const coordinator = new RpcVariationCoordinator(
      () => 0,
      () => 0
    )
    const dispose = coordinator.register('abort', () => undefined)
    try {
      expect(() => coordinator.register('abort', () => undefined)).toThrowError(
        expect.objectContaining({
          constructor: TypeError,
          message: 'variation handler already registered: abort'
        })
      )
      try {
        coordinator.register('abort', () => undefined)
      } catch (error) {
        expect(Object.hasOwn(error as object, 'code')).toBe(false)
      }
      expect(RpcCoreErrorText.variationHandlerDuplicate('abort')).toBe(
        'variation handler already registered: abort'
      )
      expect(
        hasInlineErrorText(
          join(import.meta.dirname, '../../src/core/internal/variation-coordinator.ts'),
          'register'
        )
      ).toBe(false)
    } finally {
      dispose()
    }
  })

  it('preserves manual query listener ownership and canonical conflict text', async () => {
    const [transport] = createMemoryTransportPair()
    const endpoint = await createFullEndpoint({
      id: 'manual-text',
      transport,
      middlewares: [connect({ transport, discoveryMode: 'manual' })] as const
    })
    try {
      const first = endpoint.connect.onQuery!(() => undefined)
      try {
        expect(() => endpoint.connect.onQuery!(() => undefined)).toThrowError(
          expect.objectContaining({
            constructor: RpcError,
            source: '@migaia/rpc/core',
            code: 'CAPABILITY_CONFLICT',
            message: 'only one manual query listener may be registered'
          })
        )
      } finally {
        first()
      }
      const second = endpoint.connect.onQuery!(() => undefined)
      second()
      expect(RpcCoreErrorText.manualQueryListenerDuplicate).toBe(
        'only one manual query listener may be registered'
      )
      expect(
        hasInlineErrorText(
          join(import.meta.dirname, '../../src/core/internal/discovery-attachment.ts'),
          'addManualQueryListener'
        )
      ).toBe(false)
    } finally {
      await endpoint.dispose()
    }
  })
})
