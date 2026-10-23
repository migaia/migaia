import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseSync, Visitor, type Span } from 'oxc-parser'
import { describe, expect, it } from 'vitest'
import { createMemoryTransportPair } from '../../dist/core/adapters/memory.js'
import { RpcError } from '../../dist/core/errors.js'
import { RpcCoreErrorText } from '../../dist/core/error-text.js'
import { createFullEndpoint } from '../../dist/core/full.js'
import { RpcVariationCoordinator } from '../../dist/core/internal/variation-coordinator.js'
import { connect } from '../../dist/core/middleware/connect.js'

/** Find literal error messages within one method, leaving unrelated legacy methods alone. */
function hasInlineErrorText(file: string, method: string): boolean {
  const source = readFileSync(file, 'utf8')
  /** Spans of the named owner methods. */
  const methods: Span[] = []
  /** Spans of error constructors whose message argument is inline text. */
  const inlineConstructors: Span[] = []
  new Visitor({
    MethodDefinition(node) {
      if (source.slice(node.key.start, node.key.end) === method) methods.push(node)
    },
    Property(node) {
      if (node.method && source.slice(node.key.start, node.key.end) === method) methods.push(node)
    },
    /** Inspect only constructors that can emit a package-boundary error. */
    NewExpression(node) {
      const name = source.slice(node.callee.start, node.callee.end)
      if (name !== 'TypeError' && name !== 'Error' && name !== 'RpcError') return
      const message = node.arguments[name === 'RpcError' ? 1 : 0]
      if (
        message &&
        ((message.type === 'Literal' && typeof message.value === 'string') ||
          message.type === 'TemplateLiteral')
      )
        inlineConstructors.push(node)
    }
  }).visit(parseSync(file, source).program)
  return inlineConstructors.some((constructor) =>
    methods.some((owner) => owner.start <= constructor.start && constructor.end <= owner.end)
  )
}

describe('canonical control registration texts', () => {
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
            source: 'rpc.endpoint',
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
