import { describe, expect, it } from 'vitest'
import { PeerRegistry } from '../../src/internal/peers'

describe('PeerRegistry', () => {
  it('bounds learned peers without evicting configured targets', () => {
    const peers = new PeerRegistry<string>(2)
    peers.add('configured', true)
    peers.add('one')
    peers.add('two')
    peers.add('three')
    expect(peers.snapshot()).toEqual(['configured', 'two', 'three'])
  })

  it('clears all peer state at endpoint disposal', () => {
    const peers = new PeerRegistry<string>()
    peers.add('configured', true)
    peers.add('learned')
    peers.clear()
    expect(peers.snapshot()).toEqual([])
  })

  it('expires learned peers while retaining configured targets', async () => {
    const peers = new PeerRegistry<string>(10, 10)
    peers.add('configured', true)
    peers.add('learned')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(peers.snapshot()).toEqual(['configured'])
  })
})
