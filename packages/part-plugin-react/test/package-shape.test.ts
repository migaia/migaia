import { describe, expect, it } from 'vitest'
import manifest from '../package.json' with { type: 'json' }

describe('package shape', () => {
  it('keeps React as a peer dependency only', () => {
    const dependencies = Object.keys(manifest.dependencies)
    expect(dependencies).not.toContain('react')
    expect(dependencies).not.toContain('react-dom')
    expect(Object.keys(manifest.peerDependencies)).toEqual(['react', 'react-dom'])
  })
})
