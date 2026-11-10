import { expect, it } from 'vitest'
import { PluginHostError, PluginHostErrorCode } from '../src/index.ts'

/** Detail shape used to prove the generic parameter still flows to the `detail` field. */
type IFixtureDetail = { readonly plugin: string }

/** The three baseline call shapes keep their name, identity, cause and detail fields unchanged. */
function baselineCalls(): void {
  /** Plain code + message form. */
  const plain = new PluginHostError(PluginHostErrorCode.invalidOption, 'fixture')
  expect(plain).toBeInstanceOf(Error)
  expect(plain.name).toBe('PluginHostError')
  expect(plain).toMatchObject({ source: 'plugin.host', code: 'INVALID_OPTION', message: 'fixture' })
  expect(plain.detail).toBeUndefined()
  /** Original failure must stay reachable by identity. */
  const cause = new Error('root')
  const caused = new PluginHostError(PluginHostErrorCode.invalidOption, 'fixture', { cause })
  expect(caused.cause).toBe(cause)
  /** Generic detail form keeps the typed payload on the error. */
  const detailed = new PluginHostError<IFixtureDetail>(
    PluginHostErrorCode.invalidOption,
    'fixture',
    {
      detail: { plugin: 'p' }
    }
  )
  /** Type-level witness that `detail` is typed by the generic argument. */
  const plugin: string | undefined = detailed.detail?.plugin
  expect(plugin).toBe('p')
  expect(typeof detailed.stack).toBe('string')
}
it('keeps PluginHostError baseline construction shapes', baselineCalls)
