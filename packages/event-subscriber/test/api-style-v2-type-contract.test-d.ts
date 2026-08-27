import {
  createEventChannel,
  createEventHub,
  defineEventApiStyle,
  type IEventApiStyleNames
} from '../src/index.js'

// ESV2-T06/T07/T09/T20/T21: custom styles require explicit generic placement and retain exact keys.
const inlineChannel = createEventChannel<
  number,
  void,
  { readonly subscribe: 'observe'; readonly publish: 'dispatch' }
>({ style: { subscribe: 'observe', publish: 'dispatch' } })
inlineChannel.observe((event) => {
  const value: number = event.value
  void value
})
inlineChannel.dispatch(1)
// @ts-expect-error custom Channel names cannot be inferred after an explicit payload type.
createEventChannel<number>({ style: { subscribe: 'observe', publish: 'dispatch' } })

const declaredStyle = defineEventApiStyle({ subscribe: 'listen', publish: 'fire' })
const declaredChannel = createEventChannel<number, void, typeof declaredStyle>({
  style: declaredStyle
})
declaredChannel.listen(() => undefined)
declaredChannel.fire(1)
// @ts-expect-error custom alias keeps the payload type of the canonical publish method.
declaredChannel.fire('wrong')

const asConstStyle = {
  subscribe: 'watch',
  publish: 'send'
} as const satisfies IEventApiStyleNames
const asConstChannel = createEventChannel<number, void, typeof asConstStyle>({
  style: asConstStyle
})
asConstChannel.watch(() => undefined)
asConstChannel.send(1)

type IEvents = { readonly ready: number; readonly done: string }
// @ts-expect-error custom Hub names cannot be inferred without the second style generic.
createEventHub<IEvents>({ style: { subscribe: 'observe', publish: 'dispatch' } })
const hub = createEventHub<IEvents, typeof declaredStyle>({ style: declaredStyle })
hub.listen('ready', (event) => {
  const value: number = event.value
  void value
})
hub.fire('done', 'ok')
// @ts-expect-error Hub aliases preserve keyed payload association.
hub.fire('ready', 'wrong')

const widenedStyle: IEventApiStyleNames = { subscribe: 'observe', publish: 'dispatch' }
const widenedChannel = createEventChannel<number, void, typeof widenedStyle>({
  style: widenedStyle
})
// @ts-expect-error a widened string style cannot claim an exact alias property.
widenedChannel.observe(() => undefined)
