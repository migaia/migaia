import { describe, expect, it } from 'vitest';
import { Computed, Effect, Signal, createRuntime } from '@migaia/reactive';
import type { IObservable, IObserver } from '@migaia/reactive/runtime';
import { getDependencyTree, getObserverTree } from '../src/index';

// Structural mocks: getDependencyTree/getObserverTree only read `deps`/`subs`/`debugName`/
// `version`/`constructor` off the objects they're given — they never touch the real reactive
// runtime. Building minimal literal objects (cast through `unknown`) lets us pin down the exact
// shape of edge cases (cycles, diamonds, maxDepth) without fighting the real graph, which doesn't
// support constructing a genuine cycle in the first place.
type IMockObservable = { debugName?: string; version?: number; deps?: Set<IMockObservable> };
type IMockObserver = { debugName?: string; deps?: Set<IMockObservable> };

const asObserver = (o: IMockObserver) => o as unknown as IObserver;
const asObservable = (o: IMockObservable) => o as unknown as IObservable;

describe('getDependencyTree', () => {
  it('rejects non-finite or fractional maxDepth before traversal', () => {
    const root = asObserver({ debugName: 'root', deps: new Set() });
    for (const depth of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() => getDependencyTree(root, depth)).toThrow(
        '[store] DevTools dependency tree maxDepth must be a non-negative safe integer'
      );
    }
  });

  it('returns a childless observer node when there are no deps', () => {
    const root = asObserver({ debugName: 'root', deps: new Set() });
    expect(getDependencyTree(root)).toEqual({ kind: 'observer', label: 'root', children: [] });
  });

  it('expands nested observable deps and reports version on each observable node', () => {
    const leaf: IMockObservable = { debugName: 'leaf', version: 3 };
    const mid: IMockObservable = { debugName: 'mid', version: 7, deps: new Set([leaf]) };
    const root = asObserver({ debugName: 'root', deps: new Set([mid]) });

    expect(getDependencyTree(root)).toEqual({
      kind: 'observer',
      label: 'root',
      children: [
        {
          kind: 'observable',
          label: 'mid',
          version: 7,
          children: [{ kind: 'observable', label: 'leaf', version: 3, children: [] }]
        }
      ]
    });
  });

  it('marks a node reached twice on the same path as circular and stops expanding it', () => {
    const a: IMockObservable = { debugName: 'a', version: 1 };
    const b: IMockObservable = { debugName: 'b', version: 2 };
    a.deps = new Set([b]);
    b.deps = new Set([a]);
    const root = asObserver({ debugName: 'root', deps: new Set([a]) });

    const tree = getDependencyTree(root);
    expect(tree.children[0]).toMatchObject({
      kind: 'observable',
      label: 'a',
      children: expect.any(Array)
    });
    const nodeB = tree.children[0].children[0];
    expect(nodeB).toMatchObject({ kind: 'observable', label: 'b' });
    const nodeACycle = nodeB.children[0];
    expect(nodeACycle).toEqual({
      kind: 'observable',
      label: 'a',
      version: 1,
      circular: true,
      children: []
    });
  });

  it('does not flag a diamond-shared node as circular, and expands both branches fully', () => {
    const shared: IMockObservable = { debugName: 'shared', version: 9 };
    const left: IMockObservable = { debugName: 'left', version: 1, deps: new Set([shared]) };
    const right: IMockObservable = { debugName: 'right', version: 2, deps: new Set([shared]) };
    const root = asObserver({ debugName: 'root', deps: new Set([left, right]) });

    const tree = getDependencyTree(root);
    const leftShared = tree.children[0].children[0];
    const rightShared = tree.children[1].children[0];
    expect(leftShared).toEqual({ kind: 'observable', label: 'shared', version: 9, children: [] });
    expect(rightShared).toEqual({ kind: 'observable', label: 'shared', version: 9, children: [] });
    expect(leftShared.circular).toBeUndefined();
    expect(rightShared.circular).toBeUndefined();
  });

  it('maxDepth = 0 keeps even the root childless', () => {
    const leaf: IMockObservable = { debugName: 'leaf', version: 1 };
    const root = asObserver({ debugName: 'root', deps: new Set([leaf]) });
    expect(getDependencyTree(root, 0)).toEqual({ kind: 'observer', label: 'root', children: [] });
  });

  it('truncates (without marking circular) once maxDepth is reached mid-graph', () => {
    const leaf: IMockObservable = { debugName: 'leaf', version: 1 };
    const mid: IMockObservable = { debugName: 'mid', version: 2, deps: new Set([leaf]) };
    const root = asObserver({ debugName: 'root', deps: new Set([mid]) });

    // depth for `mid` is 1; maxDepth = 1 means visitObservable(mid, 1) hits `depth >= maxDepth`
    // and returns before expanding leaf.
    const tree = getDependencyTree(root, 1);
    expect(tree.children).toEqual([{ kind: 'observable', label: 'mid', version: 2, children: [] }]);
  });

  it('falls back to constructor.name, then AnonymousReactiveNode, when debugName is absent', () => {
    class NamedNode {
      version = 1;
    }
    const named = asObservable(new NamedNode() as unknown as IMockObservable);
    const anonymous = asObservable(Object.assign(Object.create(null), { version: 1 }));
    const root = asObserver({
      debugName: 'root',
      deps: new Set([named as unknown as IMockObservable, anonymous as unknown as IMockObservable])
    });

    const tree = getDependencyTree(root);
    expect(tree.children.map((c) => c.label)).toEqual(['NamedNode', 'AnonymousReactiveNode']);
  });

  it('integrates with real Signal/Computed/Effect: labels, versions, and nesting are correct', () => {
    const runtime = createRuntime();
    const source = new Signal(1, runtime, { debugName: 'countSignal' });
    const doubled = new Computed(() => source.value * 2, runtime, { debugName: 'doubled' });
    const watcher = new Effect(
      () => {
        void doubled.value;
      },
      runtime,
      { debugName: 'watcher' }
    );
    runtime.flush();

    const tree = getDependencyTree(watcher);
    expect(tree).toEqual({
      kind: 'observer',
      label: 'watcher',
      children: [
        {
          kind: 'observable',
          label: 'doubled',
          version: expect.any(Number),
          children: [
            { kind: 'observable', label: 'countSignal', version: expect.any(Number), children: [] }
          ]
        }
      ]
    });
    expect('version' in tree).toBe(false);

    watcher.dispose();
    doubled.dispose();
    source.dispose();
  });
});

describe('getObserverTree', () => {
  it('rejects non-finite or fractional maxDepth before traversal', () => {
    const root = asObservable({ debugName: 'root', version: 0, deps: new Set() });
    for (const depth of [Number.NaN, Number.POSITIVE_INFINITY, -1, 1.5]) {
      expect(() => getObserverTree(root, depth)).toThrow(
        '[store] DevTools observer tree maxDepth must be a non-negative safe integer'
      );
    }
  });

  it('returns a childless observable node when nothing subscribes', () => {
    const root = { debugName: 'root', version: 1, subs: new Set() } as unknown as IObservable;
    expect(getObserverTree(root)).toEqual({
      kind: 'observable',
      label: 'root',
      version: 1,
      children: []
    });
  });

  it('expands nested observer subs (the reverse direction of getDependencyTree)', () => {
    type IMockNode = { debugName?: string; version?: number; subs?: Set<IMockNode> };
    const grandchild: IMockNode = { debugName: 'grandchild' };
    const child: IMockNode = { debugName: 'child', subs: new Set([grandchild]) };
    const root: IMockNode = { debugName: 'root', version: 5, subs: new Set([child]) };

    expect(getObserverTree(root as unknown as IObservable)).toEqual({
      kind: 'observable',
      label: 'root',
      version: 5,
      children: [
        {
          kind: 'observer',
          label: 'child',
          children: [{ kind: 'observer', label: 'grandchild', children: [] }]
        }
      ]
    });
  });

  it('marks a reused-on-path node circular but leaves diamond shares alone', () => {
    type IMockNode = { debugName?: string; version?: number; subs?: Set<IMockNode> };
    const a: IMockNode = { debugName: 'a' };
    const b: IMockNode = { debugName: 'b' };
    a.subs = new Set([b]);
    b.subs = new Set([a]);
    const root: IMockNode = { debugName: 'root', version: 1, subs: new Set([a]) };

    const tree = getObserverTree(root as unknown as IObservable);
    const nodeA = tree.children[0];
    const nodeB = nodeA.children[0];
    const cycleBackToA = nodeB.children[0];
    expect(cycleBackToA).toEqual({ kind: 'observer', label: 'a', circular: true, children: [] });

    // diamond: two independent branches sharing a leaf are NOT circular
    type IMockNode2 = { debugName?: string; version?: number; subs?: Set<IMockNode2> };
    const shared: IMockNode2 = { debugName: 'shared' };
    const left: IMockNode2 = { debugName: 'left', subs: new Set([shared]) };
    const right: IMockNode2 = { debugName: 'right', subs: new Set([shared]) };
    const diamondRoot: IMockNode2 = {
      debugName: 'root2',
      version: 1,
      subs: new Set([left, right])
    };
    const diamondTree = getObserverTree(diamondRoot as unknown as IObservable);
    expect(diamondTree.children[0].children[0].circular).toBeUndefined();
    expect(diamondTree.children[1].children[0].circular).toBeUndefined();
  });

  it('maxDepth = 0 keeps the root childless', () => {
    type IMockNode = { debugName?: string; version?: number; subs?: Set<IMockNode> };
    const child: IMockNode = { debugName: 'child' };
    const root: IMockNode = { debugName: 'root', version: 1, subs: new Set([child]) };
    expect(getObserverTree(root as unknown as IObservable, 0)).toEqual({
      kind: 'observable',
      label: 'root',
      version: 1,
      children: []
    });
  });

  it('integrates with real Signal/Computed/Effect: reverse traversal from the signal', () => {
    const runtime = createRuntime();
    const source = new Signal(1, runtime, { debugName: 'countSignal' });
    const doubled = new Computed(() => source.value * 2, runtime, { debugName: 'doubled' });
    const watcher = new Effect(
      () => {
        void doubled.value;
      },
      runtime,
      { debugName: 'watcher' }
    );
    runtime.flush();

    const tree = getObserverTree(source);
    expect(tree.kind).toBe('observable');
    expect(tree.label).toBe('countSignal');
    expect(tree.children).toEqual([
      {
        kind: 'observer',
        label: 'doubled',
        children: [{ kind: 'observer', label: 'watcher', children: [] }]
      }
    ]);

    watcher.dispose();
    doubled.dispose();
    source.dispose();
  });
});
