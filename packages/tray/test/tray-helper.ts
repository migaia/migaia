import { type ITrayKey } from '../src/index.ts'

export const key = (value: string) => value as ITrayKey

export const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}
