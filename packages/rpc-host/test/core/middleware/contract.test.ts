import { describe, expect, it } from 'vitest'
import { validateContractData } from '../../../dist/core/internal/contract.js'

describe('Core contract validation', () => {
  it('preserves a __proto__ schema method as an own key', () => {
    const schema = { parse: (value: unknown) => value }
    const config = { schemas: { ['__proto__']: { params: schema, result: schema } } }
    expect(() => validateContractData(config, '__proto__', 'params', 'ok')).not.toThrow()
  })

  it('exposes schema validation through the typed shared result', () => {
    const config = {
      schemas: {
        add: {
          params: {
            parse: (value: unknown) => {
              if (typeof value !== 'number') throw new Error('number')
              return value
            }
          },
          result: { parse: (value: unknown) => value }
        }
      }
    }
    expect(() => validateContractData(config, 'add', 'params', 'bad')).toThrow()
  })
})
