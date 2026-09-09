/** Hardening regression cases for wire, replay, and identity invariants. */
import { describe, expect, it, vi } from 'vitest'
import { createEndpoint } from '../src/index'
import { connect } from '../src/middleware/connect'
import type { IWebRpcTransport } from '../src/transport'
import { splitUtf8 } from '../src/internal/utf8.js'
import { ReplayWindow } from '../src/internal/replay'
import { VerifiedPeerRegistry } from '../src/internal/identity'
import { normalizeRpcEnvelope } from '@migaia/rpc-contract'
import { createStringFramer } from '@migaia/rpc-contract/framing'
import { normalizeWebRpcRoutingData } from '../src/internal/routing-data.js'

describe('#1 splitUtf8 会产出超过 maxBytes 的分片，接收端必然拒收', () => {
  it('chunk budget 小于最大 UTF-8 code point 时拒绝配置', () => {
    expect(() => splitUtf8('😀😀', 2)).toThrow(
      expect.objectContaining({
        source: '@migaia/web-rpc',
        code: 'INVALID_CONFIG'
      })
    )
    expect(() => splitUtf8('😀😀', 2)).toThrow(RangeError)
  })
})

describe('#2 ReplayWindow 出站 id 账本满了之后不再记录', () => {
  it('容量用尽后 reserveId 恒为 false，调用方只能抛 overloaded', () => {
    const replay = new ReplayWindow(4, 310_000)
    expect(replay.reserveId('a')).toBe(true)
    expect(replay.reserveId('b')).toBe(true)
    expect(replay.reserveId('c')).toBe(true)
    expect(replay.reserveId('d')).toBe(true)
    // 前四个都还在 TTL 内，第五次发送直接被拒
    expect(replay.reserveId('e')).toBe(false)
    // 任务完成也没有释放通道，只能等 TTL
    expect(replay.reserveId('e')).toBe(false)
  })
})

describe('#4 VerifiedPeerRegistry token 与 origin 容量（WR4 修复后：仍序列化但不再声称 opaque，见类注释）', () => {
  it('token 保留可观测的自增序列号（随机后缀只增加熵，不隐藏计数）', () => {
    const registry = new VerifiedPeerRegistry()
    const first = registry.register('sender-1', 'peer', 'https://a.example')
    const second = registry.register('sender-2', 'peer', 'https://b.example')
    expect(first).toMatch(/^verified-peer-1-/)
    expect(second).toMatch(/^verified-peer-2-/)
  })

  it('容量按 origin 分桶，refs>0 的 binding 在硬上限内不被 idle-TTL 回收（不代表永不回收，见下一条 hard-lifetime 用例）', () => {
    const registry = new VerifiedPeerRegistry(1024, 2, 1)
    const a = registry.register('s1', '', 'https://x.example') as string
    const b = registry.register('s2', '', 'https://x.example') as string
    registry.retain(a)
    registry.retain(b)
    // idle TTL 已过，但 refs>0 使 idle purge 跳过，该 origin 暂时注册不进新 binding
    expect(registry.register('s3', '', 'https://x.example')).toBe(false)
  })

  it('WR5 修复验证：origin 容量最终会被 hard lifetime 强制释放，不是永久自锁', () => {
    vi.useFakeTimers()
    try {
      const registry = new VerifiedPeerRegistry(1024, 2, 1) // maxBindingLifetimeMs = 1*100 = 100ms
      const a = registry.register('s1', '', 'https://x.example') as string
      const b = registry.register('s2', '', 'https://x.example') as string
      registry.retain(a)
      registry.retain(b)
      expect(registry.register('s3', '', 'https://x.example')).toBe(false) // 容量暂时打满

      vi.advanceTimersByTime(101) // 越过 hard lifetime
      expect(registry.register('s3', '', 'https://x.example')).not.toBe(false) // 强制回收后可以注册进新 binding
    } finally {
      vi.useRealTimers()
    }
  })

  it('WR-R3-1 修复：retain() 自身在命中 token 后也会检查 hard lifetime，不再需要先调 has() 才能触发回收', () => {
    vi.useFakeTimers()
    try {
      const registry = new VerifiedPeerRegistry(10, 2, 10) // maxBindingLifetimeMs = 10*100 = 1000ms
      const token = registry.register('retained') as string
      expect(registry.retain(token)).toBe(true)
      vi.advanceTimersByTime(1_001) // 越过 hard lifetime，且不调用 has()
      // 直接调 retain()：修复前会无条件命中并 refs+1，绕过硬上限
      expect(registry.retain(token)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('#5 discovery/variation/chunk 的 sentAt 校验弱于 request/response', () => {
  it('负数 sentAt 在 discovery-query 上通过归一化，在 request 上被拒', () => {
    const discovery = normalizeWebRpcRoutingData({
      webRpc: {
        profile: 'web-rpc.route.v1',
        type: 'discovery-query',
        applicationVersion: '1',
        senderId: 's',
        targetId: 'g',
        sentAt: -1
      }
    })
    expect(discovery).toBeUndefined()

    const request = normalizeWebRpcRoutingData({
      webRpc: {
        profile: 'web-rpc.route.v1',
        type: 'request',
        applicationVersion: '1',
        senderId: 's',
        targetId: 'g',
        sentAt: -1
      }
    })
    expect(request).toBeUndefined() // 同样的值在这里被拒
  })

  it('第二轮：discovery-response 与 variation 仍然接受负数 sentAt（discovery-query 已修，这两处漏了）', () => {
    const discoveryResponse = normalizeWebRpcRoutingData({
      webRpc: {
        profile: 'web-rpc.route.v1',
        type: 'discovery-response',
        applicationVersion: '1',
        senderId: 's',
        targetId: 'g',
        resolvedTargetId: 'g',
        sentAt: -1
      }
    })
    expect(discoveryResponse).toBeUndefined() // 修复后应与 discovery-query 一致地拒绝

    const variation = normalizeWebRpcRoutingData({
      webRpc: {
        profile: 'web-rpc.route.v1',
        type: 'variation',
        applicationVersion: '1',
        senderId: 's',
        targetId: 'g',
        variation: 'ping',
        sentAt: -1
      }
    })
    expect(variation).toBeUndefined() // 修复后应与其余四种 kind 一致地拒绝
  })

  it('chunk 帧完全没有 sentAt，不参与任何新鲜度判定', () => {
    const framer = createStringFramer()
    expect(framer.accept('x', { source: 's', messageId: 'm' })).toMatchObject({
      status: 'complete',
      value: 'x'
    })
  })
})

describe('#6 归一化只冻结表头，payload 仍是活引用', () => {
  it('data 上的 getter 每次读取都会重新执行', () => {
    let reads = 0
    const hostile = {
      kind: 'request',
      id: 't',
      method: 'm',
      get data() {
        reads += 1
        return { attempt: reads }
      }
    }
    const envelope = normalizeRpcEnvelope(hostile)
    expect(Object.isFrozen(envelope)).toBe(true)
    expect(envelope.method).toBe('m') // 表头是快照，安全

    // data 在归一化时只读了一次并存下返回值，后续读取不再触发 getter
    const before = reads
    void envelope.data
    void envelope.data
    expect(reads).toBe(before)
  })
})

describe('second adversarial pass (R3, fixed)', () => {
  it('WR-R3-1 fixed: retain() enforces the hard binding lifetime even when called directly (not only via has())', () => {
    vi.useFakeTimers()
    try {
      const registry = new VerifiedPeerRegistry(10, 10, 10)
      const token = registry.register('peer') as string
      vi.advanceTimersByTime(1_001)
      // No has() call in between — this exercises retain()'s own enforcement, not a side effect
      // of has() having already deleted the entry.
      expect(registry.retain(token)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it('WR-R3-2 fixed: factory reads replay config in the upfront snapshot, before any middleware side effects', async () => {
    const transport: IWebRpcTransport = {
      platform: 'Memory',
      send() {},
      subscribe() {
        return () => undefined
      }
    }
    let installed = false
    let disposed = false
    const config = {
      id: 'late-replay',
      transport,
      middlewares: [
        {
          name: 'side-effect',
          install() {
            installed = true
            return () => {
              disposed = true
            }
          }
        },
        connect({ transport })
      ],
      get replay(): never {
        throw new Error('late replay getter')
      }
    }
    await expect(createEndpoint(config as any)).rejects.toMatchObject({ code: 'INVALID_CONFIG' })
    expect(installed).toBe(false) // middleware install() must never run once the descriptor is unreadable
    expect(disposed).toBe(false)
  })
})
