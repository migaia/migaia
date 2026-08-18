import { describe, expect, it, vi } from 'vitest';
import { EndpointResourceManager } from '../../src/internal/endpoint-resource-manager';
import { ReplayWindow } from '../../src/internal/replay';
import { ResourceScope } from '../../src/internal/resource-scope';
import { ChunkAssembler } from '../../src/internal/chunk';
import { ProviderAdmissionRegistry } from '../../src/internal/provider-admission';
import { VerifiedPeerRegistry } from '../../src/internal/identity';

describe('EndpointResourceManager', () => {
  it('releases an operation once and retains replay ids only when requested', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('request-1')).toBe(true);
    const operation = manager.begin('request', 'request-1');
    operation.release();
    operation.release();
    expect(manager.hasReservedId('request-1')).toBe(true);
  });

  it('keeps replay-retained ids until the manager policy releases them', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('request-2')).toBe(true);
    const operation = manager.begin('request', 'request-2');
    operation.retainForReplay();
    operation.release();
    expect(manager.hasReservedId('request-2')).toBe(true);
    manager.releaseId('request-2');
    expect(manager.hasReservedId('request-2')).toBe(true);
  });

  it('owns ping caller registration and identifier release', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('ping-owner')).toBe(true);
    const pending = {
      targetId: 'target',
      resolve: () => undefined,
      settle: () => true
    };
    manager.setPingPending('ping-owner', pending);
    expect(manager.getPingPending('ping-owner')).toBe(pending);
    expect(manager.pingPendingSize).toBe(1);
    manager.deletePingPending('ping-owner');
    expect(manager.getPingPending('ping-owner')).toBeUndefined();
    expect(manager.hasReservedId('ping-owner')).toBe(true);
  });

  it('owns request caller commit and settlement removal', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const pending = { marker: 'request' };
    expect(manager.commitPending('request-owner', pending, () => true)).toBe(true);
    expect(manager.getPending<typeof pending>('request-owner')).toBe(pending);
    expect(manager.pendingSize).toBe(1);
    manager.deletePending('request-owner');
    expect(manager.getPending('request-owner')).toBeUndefined();
    expect(manager.pendingSize).toBe(0);
  });

  it('owns discovery registry shutdown after caller settlement', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const order: string[] = [];
    manager.attachCallerSettlement(() => order.push('callers'));
    manager.attachDiscoveryRegistry(() => order.push('discovery'));
    await manager.dispose();
    expect(order).toEqual(['callers', 'discovery']);
  });

  it('owns verified peer registration and lookup', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const token = manager.registerPeer('sender', 'peer', 'origin', 'source');
    expect(token).toEqual(expect.any(String));
    expect(manager.hasPeer('sender', 'peer', 'origin', 'source')).toBe(true);
    await manager.dispose();
    expect(manager.hasPeer('sender', 'peer', 'origin', 'source')).toBe(false);
    expect(manager.registerPeer('late')).toBe(false);
  });

  it('rejects late provider admission after disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const admission = new ProviderAdmissionRegistry();
    manager.attachRuntime(new ChunkAssembler(), admission);
    await manager.dispose();
    expect(manager.acquire('late-task', 'peer')).toBe(false);
    expect(admission.acquire('late-task', 'peer')).toBe(true);
  });

  it('rejects duplicate begin without replacing the active owner', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('duplicate')).toBe(true);
    const first = manager.begin('request', 'duplicate');
    expect(() => manager.begin('request', 'duplicate')).toThrow(
      expect.objectContaining({
        code: 'OVERLOADED',
        message: 'operation identifier is already active'
      })
    );
    first.release();
    expect(manager.hasReservedId('duplicate')).toBe(true);
  });

  it('rejects begin while an earlier scope retains replay protection', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('replay-duplicate')).toBe(true);
    const first = manager.begin('request', 'replay-duplicate');
    first.retainForReplay();
    first.release();
    expect(() => manager.begin('request', 'replay-duplicate')).toThrow(
      'operation identifier is already active'
    );
    manager.releaseId('replay-duplicate');
    expect(manager.hasReservedId('replay-duplicate')).toBe(true);
  });

  it('releases replay-retained ids after TTL and restores real allocation capacity', () => {
    vi.useFakeTimers();
    try {
      const manager = new EndpointResourceManager(new ReplayWindow(2, 10), new ResourceScope());
      expect(manager.reserveId('ttl-id')).toBe(true);
      const operation = manager.begin('request', 'ttl-id');
      operation.retainForReplay();
      operation.release();
      // TTL 内仍被保留，begin 拒绝复用。
      expect(() => manager.begin('request', 'ttl-id')).toThrow(
        'operation identifier is already active'
      );
      vi.advanceTimersByTime(20);
      manager.purgeReplay();
      expect(manager.hasReservedId('ttl-id')).toBe(false);
      // 过期后通过真实 reserve → begin 路径重新获得容量，而不是绕过分配器调用 begin。
      expect(manager.reserveId('replacement-1')).toBe(true);
      expect(manager.reserveId('replacement-2')).toBe(true);
      expect(manager.reserveId('replacement-3')).toBe(false);
      const replacement = manager.begin('request', 'replacement-1');
      replacement.release();
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps an in-flight outbound id active beyond the replay TTL', () => {
    vi.useFakeTimers();
    try {
      const manager = new EndpointResourceManager(new ReplayWindow(1, 10), new ResourceScope());
      expect(manager.reserveId('in-flight')).toBe(true);
      manager.begin('request', 'in-flight');
      vi.advanceTimersByTime(20);
      manager.purgeReplay();
      expect(manager.hasReservedId('in-flight')).toBe(true);
      expect(manager.reserveId('replacement')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('inbound operations do not consume the shared outbound id ledger budget', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(3, 310_000), new ResourceScope());
    // 入站 kind 大量进入也不应占用出站账本（ReplayWindow 容量 3）。
    manager.begin('provider', 'inbound-p', true).release();
    manager.begin('variation', 'inbound-v', true).release();
    manager.begin('chunk', 'inbound-c', true).release();
    expect(manager.hasReservedId('inbound-p')).toBe(false);
    expect(manager.hasReservedId('inbound-v')).toBe(false);
    expect(manager.hasReservedId('inbound-c')).toBe(false);
    // 出站账本仍有两个可用槽位。
    expect(manager.reserveId('outbound-1')).toBe(true);
    expect(manager.reserveId('outbound-2')).toBe(true);
    expect(manager.reserveId('outbound-3')).toBe(true);
    expect(manager.reserveId('outbound-4')).toBe(false);
  });

  it('does not let inbound retention expiry release a colliding active outbound id', () => {
    vi.useFakeTimers();
    try {
      const manager = new EndpointResourceManager(new ReplayWindow(1, 10), new ResourceScope());
      expect(manager.reserveId('shared-id')).toBe(true);

      // Inbound retention is deliberately a separate namespace, so a wire id may
      // equal an outbound id without gaining authority over the outbound ledger.
      manager.begin('provider', 'shared-id', true).release();
      vi.advanceTimersByTime(20);
      manager.purgeReplay();

      expect(manager.hasReservedId('shared-id')).toBe(true);
      expect(manager.reserveId('replacement')).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('tracks provider operations independently from request operations', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('provider-1')).toBe(true);
    const operation = manager.begin('provider', 'provider-1', true);
    expect(manager.size).toBe(1);
    operation.release();
    expect(manager.size).toBe(0);
    expect(manager.hasReservedId('provider-1')).toBe(true);
  });

  it.each(['request', 'dispatch', 'ping', 'discovery', 'variation', 'provider', 'chunk'] as const)(
    'creates and releases the %s operation scope',
    (kind) => {
      const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
      const operation = manager.begin(kind, `${kind}-scope`);
      expect(manager.size).toBe(1);
      operation.release();
      expect(manager.size).toBe(0);
      expect(manager.hasReservedId(`${kind}-scope`)).toBe(
        kind === 'request' || kind === 'dispatch' || kind === 'ping' || kind === 'discovery'
      );
    }
  );

  it('disposes active operation scopes and rejects new work', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('dispatch-1')).toBe(true);
    manager.begin('dispatch', 'dispatch-1');
    await manager.dispose();
    expect(manager.size).toBe(0);
    expect(() => manager.begin('dispatch', 'dispatch-1')).toThrow();
  });

  it('disposes multiple active and replay-retained scopes before late releases arrive', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const active = manager.begin('request', 'active-scope');
    const retained = manager.begin('ping', 'retained-scope');
    retained.retainForReplay();
    retained.release();
    expect(manager.size).toBe(1);
    await manager.dispose();
    expect(manager.size).toBe(0);
    expect(manager.hasReservedId('active-scope')).toBe(false);
    expect(manager.hasReservedId('retained-scope')).toBe(false);
    active.release();
    retained.release();
    manager.releaseId('active-scope');
    manager.releaseId('retained-scope');
    expect(manager.size).toBe(0);
  });

  it('settles caller operations before releasing lower-level resources', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const order: string[] = [];
    manager.pending.set('request', {});
    manager.pingPending.set('ping', {
      targetId: 'target',
      resolve: () => undefined,
      settle: () => true
    });
    manager.attachCallerSettlement(() => order.push('callers'));
    manager.registerReplayOwner({ purge: () => undefined, clear: () => order.push('replay') });
    await manager.dispose();
    expect(order).toEqual(['callers', 'replay']);
    expect(manager.pending.tasks.size).toBe(0);
    expect(manager.pingPending.size).toBe(0);
  });

  it('owns runtime admission, chunk and controller cleanup', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const chunks = new ChunkAssembler();
    const admission = new ProviderAdmissionRegistry();
    const controller = new AbortController();
    manager.attachRuntime(chunks, admission);
    manager.set('request-1', controller);
    expect(manager.has('request-1')).toBe(true);
    expect(manager.acquire('request-1', 'peer-1')).toBe(true);
    manager.delete('request-1');
    expect(manager.has('request-1')).toBe(false);
    manager.set('request-1', controller);
    await manager.dispose();
    expect(controller.signal.aborted).toBe(true);
    expect(admission.acquire('request-1', 'peer-1')).toBe(true);
  });

  it('routes chunk assembly through the endpoint owner', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const chunks = new ChunkAssembler({ maxChunkBytes: 32 });
    manager.attachRuntime(chunks, new ProviderAdmissionRegistry());
    expect(
      manager.acceptChunk({ messageId: 'message-1', index: 0, total: 2, data: 'a' }, 'peer-1')
    ).toBeUndefined();
    expect(manager.size).toBe(1);
    expect(
      manager.acceptChunk({ messageId: 'message-1', index: 1, total: 2, data: 'b' }, 'peer-1')
    ).toBe('ab');
    expect(manager.size).toBe(0);
  });

  it('ignores late chunks after manager disposal without resurrecting resources', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const chunks = new ChunkAssembler();
    manager.attachRuntime(chunks, new ProviderAdmissionRegistry());
    await manager.dispose();
    expect(() =>
      manager.acceptChunk({ messageId: 'late', index: 0, total: 2, data: 'late' }, 'peer-1')
    ).not.toThrow();
    expect(chunks.size).toBe(0);
    expect(manager.size).toBe(0);
  });

  it('clears a timer registered after manager disposal immediately', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    let cleared = 0;
    manager.trackTimer('late', { clear: () => (cleared += 1) });
    manager.releaseTimer('late');
    expect(cleared).toBe(1);
  });

  it('cleans a waiter registered after manager disposal immediately', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    let cleaned = 0;
    manager.trackWaiter('late', () => (cleaned += 1));
    manager.releaseWaiter('late');
    expect(cleaned).toBe(1);
  });

  it('aborts a provider controller registered after manager disposal immediately', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    const controller = new AbortController();
    manager.set('late-controller', controller);
    expect(manager.has('late-controller')).toBe(false);
    expect(controller.signal.aborted).toBe(true);
  });

  it('settles a ping registered after manager disposal immediately', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    const release = vi.fn();
    const settle = vi.fn(() => {
      release();
      return true;
    });
    manager.setPingPending('late-ping', {
      targetId: 'target',
      resolve: vi.fn(),
      settle,
      release
    });
    expect(settle).toHaveBeenCalledWith(false);
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects late identity lease retention after manager disposal', async () => {
    const peers = new VerifiedPeerRegistry();
    const token = peers.register('late-peer');
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope(), peers);
    await manager.dispose();
    expect(manager.retainPeer(token as string)).toBe(false);
  });

  it('does not overwrite an active provider controller on duplicate registration', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const first = new AbortController();
    const second = new AbortController();
    const abortSecond = vi.spyOn(second, 'abort');
    manager.set('same-controller', first);
    manager.set('same-controller', second);
    expect(manager.has('same-controller')).toBe(true);
    expect(manager.activeControllers.get('same-controller')).toBe(first);
    expect(abortSecond).toHaveBeenCalledOnce();
    await manager.dispose();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(true);
    expect(abortSecond).toHaveBeenCalledOnce();
  });

  it('fails fast when construction-only owners are registered after disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const owner = { purge: () => undefined, clear: () => undefined };
    await manager.dispose();
    expect(() => manager.registerReplayOwner(owner)).toThrow(
      expect.objectContaining({
        code: 'ENDPOINT_DISPOSED',
        message: 'EndpointResourceManager is disposed'
      })
    );
    expect(() => manager.registerMaintenanceOwner(owner)).toThrow(
      'EndpointResourceManager is disposed'
    );
  });

  it('fails fast when runtime attachments arrive after disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    expect(() =>
      manager.attachRuntime(new ChunkAssembler(), new ProviderAdmissionRegistry())
    ).toThrow('EndpointResourceManager is disposed');
    expect(() => manager.attachProviderRegistry({ clear: () => undefined })).toThrow(
      'EndpointResourceManager is disposed'
    );
  });

  it('fails fast when caller settlement is attached after disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    expect(() => manager.attachCallerSettlement(() => undefined)).toThrow(
      'EndpointResourceManager is disposed'
    );
  });

  it('clears duplicate replay and maintenance owners only once', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    let replayClears = 0;
    let maintenanceClears = 0;
    const replay = {
      purge: () => undefined,
      clear: () => (replayClears += 1)
    };
    const maintenance = {
      purge: () => undefined,
      clear: () => (maintenanceClears += 1)
    };
    manager.registerReplayOwner(replay);
    manager.registerReplayOwner(replay);
    manager.registerMaintenanceOwner(maintenance);
    manager.registerMaintenanceOwner(maintenance);
    await manager.dispose();
    expect(replayClears).toBe(1);
    expect(maintenanceClears).toBe(1);
  });

  it('clears tracked timers during endpoint disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    let cleared = 0;
    manager.trackTimer('discovery-1', { clear: () => (cleared += 1) });
    manager.trackTimer('discovery-2', { clear: () => (cleared += 1) });
    await manager.dispose();
    expect(cleared).toBe(2);
    await manager.dispose();
    expect(cleared).toBe(2);
  });

  it('shares dispose promise and collected result across concurrent callers', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    manager.attachDiscoveryRegistry(() => {
      throw new Error('discovery failed');
    });
    const first = manager.dispose();
    const second = manager.dispose();
    expect(first).toBe(second);
    const errors = await first;
    expect(errors).toEqual([
      expect.objectContaining({ resource: 'manual discovery abort listener' })
    ]);
    expect(await second).toBe(errors);
  });

  it('continues every cleanup phase after failures', async () => {
    const completed: string[] = [];
    const resourceScope = new ResourceScope();
    resourceScope.add('first resource', () => {
      throw new Error('resource failed');
    });
    resourceScope.add('second resource', () => {
      completed.push('resource');
    });
    const manager = new EndpointResourceManager(new ReplayWindow(), resourceScope);
    manager.attachCallerSettlement(() => {
      throw new Error('settlement failed');
    });
    manager.attachDiscoveryRegistry(() => {
      throw new Error('discovery failed');
    });
    manager.trackTimer('first', {
      clear: () => {
        throw new Error('timer failed');
      }
    });
    manager.trackTimer('second', { clear: () => completed.push('timer') });
    manager.registerReplayOwner({
      purge: () => undefined,
      clear: () => {
        throw new Error('replay failed');
      }
    });
    manager.registerReplayOwner({ purge: () => undefined, clear: () => completed.push('replay') });
    manager.registerMaintenanceOwner({
      purge: () => undefined,
      clear: () => {
        throw new Error('maintenance failed');
      }
    });
    manager.registerMaintenanceOwner({
      purge: () => undefined,
      clear: () => completed.push('maintenance')
    });
    manager.trackWaiter('first', () => {
      throw new Error('waiter failed');
    });
    manager.trackWaiter('second', () => completed.push('waiter'));
    manager.attachProviderRegistry({
      clear: () => {
        throw new Error('provider failed');
      }
    });

    const errors = await manager.dispose();
    expect(completed).toEqual(['timer', 'replay', 'maintenance', 'waiter', 'resource']);
    expect(errors.map((entry) => entry.resource)).toEqual([
      'caller settlement',
      'manual discovery abort listener',
      'timer',
      'replay owner',
      'maintenance owner',
      'waiter',
      'provider registry',
      'first resource'
    ]);
  });

  it('bounds inbound replay retention without consuming outbound capacity', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(2, 10_000), new ResourceScope());
    manager.begin('provider', 'inbound-1', true).release();
    manager.begin('variation', 'inbound-2', true).release();
    expect(manager.reserveId('outbound-request')).toBe(true);
    const outbound = manager.begin('request', 'outbound-request', true);
    expect(() => outbound.release()).not.toThrow();
    expect(manager.hasReservedId('outbound-request')).toBe(true);
    expect(() => manager.begin('chunk', 'inbound-3', true)).toThrow(
      expect.objectContaining({ code: 'OVERLOADED' })
    );
  });

  it('H-T19 expires inbound replay retention without evicting a colliding outbound owner', () => {
    vi.useFakeTimers();
    try {
      const manager = new EndpointResourceManager(new ReplayWindow(2, 10), new ResourceScope());
      manager.begin('provider', 'same-id', true).release();
      vi.advanceTimersByTime(5);
      expect(manager.reserveId('same-id')).toBe(true);
      const outbound = manager.begin('request', 'same-id', true);
      outbound.release();
      vi.advanceTimersByTime(6);
      manager.purgeReplay();
      expect(manager.hasReservedId('same-id')).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('coordinates replay purge and clear through registered owners', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const calls: string[] = [];
    manager.registerReplayOwner({
      purge: () => calls.push('purge'),
      clear: () => calls.push('clear')
    });
    manager.purgeReplay(123);
    expect(calls).toEqual(['purge']);
    await manager.dispose();
    expect(calls).toEqual(['purge', 'clear']);
  });

  it('cleans tracked discovery waiters during disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    let cleaned = 0;
    manager.trackWaiter('target-a', () => {
      cleaned += 1;
    });
    manager.releaseWaiter('target-a');
    manager.trackWaiter('target-b', () => {
      cleaned += 1;
    });
    await manager.dispose();
    expect(cleaned).toBe(2);
  });
});
