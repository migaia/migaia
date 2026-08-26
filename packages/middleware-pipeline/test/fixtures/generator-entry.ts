import { GENERATOR_CONTINUE, runGeneratorMiddleware } from '@migaia/middleware-pipeline'

export const runGeneratorOnly = (): void =>
  runGeneratorMiddleware(
    [
      function* (value) {
        yield value + 1
        return GENERATOR_CONTINUE
      }
    ],
    1,
    () => undefined
  )
