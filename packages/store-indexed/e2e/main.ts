import {
  ObservableArray,
  ObservableMap,
  ObservableObject,
  ObservableSet
} from '@migaia/store-indexed'

declare global {
  interface Window {
    runStoreIndexedScenario(): readonly unknown[]
    runStoreIndexedIterableAdmissionScenario(): readonly unknown[]
    runStoreIndexedRollbackScenario(): readonly unknown[]
  }
}

window.runStoreIndexedScenario = () => {
  const object = new ObservableObject({ name: 'Ada', active: true })
  const array = new ObservableArray([1, 2, 3])
  const map = new ObservableMap<string, number>([['a', 1]])
  const set = new ObservableSet(['a'])
  object.set('name', 'Grace')
  array.splice(1, 1, 4, 5)
  map.set('b', 2)
  set.add('b')
  const result = [
    object.snapshot(),
    array.snapshot(),
    [...map.snapshot().entries()],
    set.valuesArray()
  ] as const
  object.dispose()
  array.dispose()
  map.dispose()
  set.dispose()
  return result
}

window.runStoreIndexedIterableAdmissionScenario = () => {
  let getterReads = 0
  let iteratorCalls = 0
  let receiverMatches = false
  const iterable = {
    get [Symbol.iterator]() {
      getterReads += 1
      return function (this: unknown) {
        iteratorCalls += 1
        receiverMatches = this === iterable
        return [1, 2][Symbol.iterator]()
      }
    }
  }
  const array = new ObservableArray(iterable)
  const characters = new ObservableSet('aba')
  const result = [
    array.snapshot(),
    getterReads,
    iteratorCalls,
    receiverMatches,
    characters.valuesArray()
  ]
  array.dispose()
  characters.dispose()
  return result
}

window.runStoreIndexedRollbackScenario = () => {
  const map = new ObservableMap<string, number>([['old', 1]])
  const failure = new Error('browser iterator failed')
  const hostile = {
    *[Symbol.iterator](): IterableIterator<readonly [string, number]> {
      yield ['next', 2]
      throw failure
    }
  }
  let code: unknown
  let causeMatches = false
  try {
    map.replace(hostile)
  } catch (error) {
    code = (error as { code?: unknown }).code
    causeMatches = (error as Error).cause === failure
  }
  const result = [[...map.snapshot().entries()], code, causeMatches] as const
  map.dispose()
  return result
}
