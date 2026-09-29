import { createRuntime } from '@migaia/reactive/runtime'
import { describe, expect, it } from 'vitest'
import { Resource } from '../src/index.js'
import { ResourceErrorCode } from '../src/error-code.js'
import { ResourceErrorText } from '../src/error-text.js'

describe('resource guarded-read policy', () => {
  it('stops after a hostile ttl getter and retains its cause', () => {
    const failure = new Error('ttl failed')
    const reads: string[] = []
    const options = {
      get debugName() {
        reads.push('debugName')
        return 'test'
      },
      get ttl(): never {
        reads.push('ttl')
        throw failure
      },
      get autoStart() {
        reads.push('autoStart')
        return false
      }
    }
    let thrown: unknown
    try {
      new Resource(async () => 'value', createRuntime(), options)
    } catch (error) {
      thrown = error
    }
    expect(thrown).toBeInstanceOf(TypeError)
    expect(thrown).toMatchObject({
      code: ResourceErrorCode.invalidOption,
      message: ResourceErrorText.optionsSnapshotFailed,
      cause: failure
    })
    expect(reads).toEqual(['debugName', 'ttl'])
  })
})
