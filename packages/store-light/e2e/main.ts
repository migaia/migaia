/* oxlint-disable unicorn/no-thenable -- browser fixture verifies lifecycle thenable admission. */
import { createStore, createStoreResource, createStoreResourceScope } from '@migaia/store-light'

declare global {
  interface Window {
    runStoreLightScenario(): readonly unknown[]
    runStoreLightResourceCleanupScenario(): Promise<readonly number[]>
    runStoreLightResourceAdmissionScenario(): Promise<readonly number[]>
    runStoreLightResourceScopeScenario(): Promise<readonly number[]>
  }
}

window.runStoreLightScenario = () => {
  const store = createStore({
    count: 1,
    get doubled() {
      return this.count * 2
    },
    increment() {
      this.count += 1
    }
  })
  let notifications = 0
  const unsubscribe = store.$subscribe(() => {
    notifications += 1
  })
  store.increment()
  store.$batch((draft) => {
    draft.count += 1
    draft.count += 1
  })
  const result = [store.count, store.doubled, notifications, store.$snapshot().count] as const
  unsubscribe()
  store.$dispose()
  return [...result, store.$disposed]
}

window.runStoreLightResourceCleanupScenario = async () => {
  let disposerReads = 0
  let disposerCalls = 0
  let thenReads = 0
  let thenCalls = 0
  const thenable = {
    get then() {
      thenReads += 1
      return function (this: unknown, resolve: () => void) {
        if (this === thenable) thenCalls += 1
        resolve()
      }
    }
  }
  const value = Object.defineProperty({}, '$dispose', {
    get() {
      disposerReads += 1
      return function (this: unknown) {
        if (this === value) disposerCalls += 1
        return thenable
      }
    }
  })
  const resource = createStoreResource(() => value)
  resource.preload()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  resource.forceDispose()
  await resource.whenTerminal()
  await Promise.resolve()
  return [disposerReads, disposerCalls, thenReads, thenCalls]
}

window.runStoreLightResourceAdmissionScenario = async () => {
  let loadReads = 0
  let unknownReads = 0
  let unknownEnumerations = 0
  const resource = createStoreResource(
    new Proxy(
      {
        get load() {
          loadReads += 1
          return () => 42
        },
        get unknown() {
          unknownReads += 1
          throw new Error('unknown option getter must not run')
        }
      },
      {
        ownKeys() {
          unknownEnumerations += 1
          throw new Error('factory keys must not be enumerated')
        }
      }
    ) as never
  )
  resource.preload()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const value = resource.read() as number
  resource.forceDispose()
  return [value, loadReads, unknownReads, unknownEnumerations]
}

window.runStoreLightResourceScopeScenario = async () => {
  let loadReads = 0
  let ownKeysCalls = 0
  let terminalCalls = 0
  const scope = createStoreResourceScope()
  const resource = scope.resource(
    new Proxy(
      {
        get load() {
          loadReads += 1
          return () => 42
        },
        onTerminal() {
          terminalCalls += 1
        }
      },
      {
        ownKeys() {
          ownKeysCalls += 1
          throw new Error('scope must not enumerate factory keys')
        }
      }
    ) as never
  )
  resource.preload()
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  const value = resource.read() as number
  resource.forceDispose()
  await resource.whenTerminal()
  await Promise.resolve()
  scope.dispose()
  return [value, loadReads, ownKeysCalls, terminalCalls]
}
