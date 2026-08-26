import type {
  IMiddlewarePipelineAbortSignal,
  IMiddlewarePipelineContext,
  IMiddlewarePipelineControlOptions
} from '@migaia/middleware-pipeline'

type ICustomSignal = {
  readonly aborted: boolean
  readonly reason?: unknown
  addEventListener(type: 'abort', listener: () => void, options?: { readonly once?: boolean }): void
  removeEventListener(type: 'abort', listener: () => void): void
}

const customSignal: ICustomSignal = {
  aborted: false,
  addEventListener() {},
  removeEventListener() {}
}
const signal: IMiddlewarePipelineAbortSignal = customSignal
const context: IMiddlewarePipelineContext = Object.freeze({ signal })
const control: IMiddlewarePipelineControlOptions = { signal }

export const structuralFixture = { signal, context, control }
