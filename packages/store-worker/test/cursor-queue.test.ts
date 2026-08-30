import { describe, expect, it } from 'vitest'
import { CursorQueue } from '../src/cursor-queue.js'

describe('CursorQueue', () => {
  it('preserves FIFO order across repeated empty and refill cycles', () => {
    const queue = new CursorQueue<number>()
    queue.push(1)
    queue.push(2)
    expect(queue.take()).toBe(1)
    expect(queue.take()).toBe(2)
    expect(queue.take()).toBeUndefined()

    queue.push(3)
    expect(queue.size).toBe(1)
    expect(queue.take()).toBe(3)
    expect(queue.size).toBe(0)
  })

  it('preserves FIFO order while compacting a long consumed prefix', () => {
    const queue = new CursorQueue<number>()
    for (let value = 0; value < 256; value++) queue.push(value)
    for (let value = 0; value < 192; value++) expect(queue.take()).toBe(value)
    for (let value = 256; value < 320; value++) queue.push(value)

    const remaining: number[] = []
    while (queue.size > 0) remaining.push(queue.take()!)

    expect(remaining).toEqual(Array.from({ length: 128 }, (_, index) => index + 192))
    expect(queue.take()).toBeUndefined()
  })
})
