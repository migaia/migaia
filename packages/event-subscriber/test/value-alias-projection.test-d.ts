import { expectTypeOf } from 'vitest'
import { createEventChannel, createEventHub } from '../src/index.js'

type IEvent = {
  readonly data: { readonly count: number }
}
const valueConfig = { readPath: 'data.count', alias: 'resource' } as const
const channel = createEventChannel<IEvent, void, undefined, typeof valueConfig>({ valueConfig })
channel.subscribe((event) => {
  expectTypeOf(event.value).toEqualTypeOf<IEvent>()
  expectTypeOf(event.resource).toEqualTypeOf<number | undefined>()
})

// @ts-expect-error literal context members cannot be reused as aliases
createEventChannel<IEvent>({ valueConfig: { readPath: 'data.count', alias: 'value' } })

type IMap = {
  readonly numberEvent: { readonly data: { readonly count: number } }
  readonly textEvent: { readonly data: { readonly count: string } }
}
const hub = createEventHub<IMap, undefined, typeof valueConfig>({ valueConfig })
hub.subscribe('numberEvent', (event) => {
  expectTypeOf(event.resource).toEqualTypeOf<number | undefined>()
})
hub.subscribe('textEvent', (event) => {
  expectTypeOf(event.resource).toEqualTypeOf<string | undefined>()
})

const widenedPath: { readonly readPath: string; readonly alias: string } = valueConfig
const widened = createEventChannel<IEvent, void, undefined, typeof widenedPath>({
  valueConfig: widenedPath
})
widened.subscribe((event) => {
  expectTypeOf(event.resource).toEqualTypeOf<undefined>()
})
