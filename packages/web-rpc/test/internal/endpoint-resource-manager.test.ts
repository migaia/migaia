import { describe, expect, it } from 'vitest';
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
    expect(manager.hasReservedId('request-1')).toBe(false);
  });

  it('keeps replay-retained ids until the manager policy releases them', () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    expect(manager.reserveId('request-2')).toBe(true);
    const operation = manager.begin('request', 'request-2');
    operation.retainForReplay();
    operation.release();
    expect(manager.hasReservedId('request-2')).toBe(true);
    manager.releaseId('request-2');
    expect(manager.hasReservedId('request-2')).toBe(false);
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
    expect(manager.hasReservedId('ping-owner')).toBe(false);
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
      'operation identifier is already active'
    );
    first.release();
    expect(manager.hasReservedId('duplicate')).toBe(false);
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
    expect(manager.hasReservedId('replay-duplicate')).toBe(false);
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
      expect(manager.hasReservedId(`${kind}-scope`)).toBe(false);
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

  it('ignores late timer registration after manager disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    let cleared = 0;
    manager.trackTimer('late', { clear: () => (cleared += 1) });
    manager.releaseTimer('late');
    expect(cleared).toBe(0);
  });

  it('ignores late waiter registration after manager disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    let cleaned = 0;
    manager.trackWaiter('late', () => (cleaned += 1));
    manager.releaseWaiter('late');
    expect(cleaned).toBe(0);
  });

  it('ignores late provider controller registration after manager disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    await manager.dispose();
    const controller = new AbortController();
    manager.set('late-controller', controller);
    expect(manager.has('late-controller')).toBe(false);
    expect(controller.signal.aborted).toBe(false);
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
    manager.set('same-controller', first);
    manager.set('same-controller', second);
    await manager.dispose();
    expect(first.signal.aborted).toBe(true);
    expect(second.signal.aborted).toBe(false);
  });

  it('fails fast when construction-only owners are registered after disposal', async () => {
    const manager = new EndpointResourceManager(new ReplayWindow(), new ResourceScope());
    const owner = { purge: () => undefined, clear: () => undefined };
    await manager.dispose();
    expect(() => manager.registerReplayOwner(owner)).toThrow('EndpointResourceManager is disposed');
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
