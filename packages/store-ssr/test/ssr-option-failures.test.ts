import { describe, expect, it } from 'vitest'
import { createSSRRequestScope, createSSRStateScriptWith } from '../src/index.ts'

/** Captures a synchronous or asynchronous failure for identity assertions. */
async function failureOf(run: () => unknown): Promise<unknown> {
  try {
    await run()
  } catch (error) {
    return error
  }
  return undefined
}

describe('SSR option read failures', () => {
  it('passes through a coded ownership getter failure and codes an uncoded one', async () => {
    const scope = createSSRRequestScope()
    const coded = Object.assign(new Error('coded'), { source: 'app', code: 'APP_FAILED' })
    const fromCoded = await failureOf(() =>
      scope.register('a', {} as never, {
        get owned(): boolean {
          throw coded
        }
      })
    )
    expect(fromCoded).toBe(coded)
    const plain = new Error('plain')
    const fromPlain = await failureOf(() =>
      scope.register('b', {} as never, {
        get owned(): boolean {
          throw plain
        }
      })
    )
    expect(fromPlain).toMatchObject({ code: 'INVALID_OPTION', cause: plain })
    scope.dispose()
  })

  it('codes a throwing timeout getter and a throwing script option getter', async () => {
    const scope = createSSRRequestScope()
    const getterFailure = new Error('timeout getter failed')
    const fromTimeout = await failureOf(() =>
      scope.awaitResources({
        get timeoutMs(): number {
          throw getterFailure
        }
      })
    )
    expect(fromTimeout).toMatchObject({ code: 'INVALID_OPTION', cause: getterFailure })
    scope.dispose()
    const scriptFailure = new Error('codecs getter failed')
    const fromScript = await failureOf(() =>
      createSSRStateScriptWith(
        {} as never,
        {
          get codecs(): never {
            throw scriptFailure
          }
        } as never
      )
    )
    expect(fromScript).toMatchObject({ code: 'INVALID_OPTION', cause: scriptFailure })
  })
})
