import { expect, it } from 'vitest'
import { createLogHost } from '@migaia/log-host'
import { httpPlugin } from '../src/index.ts'

it('codes a throwing option getter as INVALID_OPTION with the getter error on cause', () => {
  const getterFailure = new Error('option getter failed')
  expect(() =>
    httpPlugin({
      get url(): never {
        throw getterFailure
      }
    } as never)
  ).toThrowError(expect.objectContaining({ code: 'INVALID_OPTION', cause: getterFailure }))
})

it('reports a transport failure as DELIVERY_FAILED with the fetch error kept', async () => {
  const failures: unknown[] = []
  /** Failure thrown by the transport. */
  const transportFailure = new Error('network down')
  const host = createLogHost({
    report: (error: unknown) => {
      failures.push(error)
    },
    plugins: [
      httpPlugin({
        url: 'memory-only',
        fetcher: async () => {
          throw transportFailure
        }
      })
    ]
  } as never)
  host.dispatchRaw({ tag: 'info', message: 'ordinary', args: [] } as never)
  await host.flush()
  await host.shutdown('manual')
  expect(JSON.stringify(failures.map((error) => (error as { code?: string }).code))).toContain(
    'DELIVERY_FAILED'
  )
})

it('reports a response whose fields cannot be read as a malformed delivery', async () => {
  const failures: unknown[] = []
  /** Failure thrown by the response accessor. */
  const accessorFailure = new Error('ok getter failed')
  const host = createLogHost({
    report: (error: unknown) => {
      failures.push(error)
    },
    plugins: [
      httpPlugin({
        url: 'memory-only',
        fetcher: async () =>
          ({
            get ok(): boolean {
              throw accessorFailure
            }
          }) as never
      })
    ]
  } as never)
  host.dispatchRaw({ tag: 'info', message: 'ordinary', args: [] } as never)
  await host.flush()
  await host.shutdown('manual')
  expect(failures.length).toBeGreaterThan(0)
})
