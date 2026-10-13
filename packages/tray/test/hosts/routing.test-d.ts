import { defineFeature, definePlugin } from '@migaia/plugin-host'
import { createTray, defineTrayHost, defineRoutingPolicy } from '@migaia/tray'
import type { ITrayRoutingPolicy, ITrayRouting, ITrayRoutedRemote } from '@migaia/tray'
/** Exact method metadata exercises routing without recursively expanding the plugin graph. */
const service = definePlugin({
  name: 'node',
  features: { svc: defineFeature(() => ({ echo: (value: string) => value })) },
  install: () => ({})
})
/** A parent-only name must not become a child declaration. */
const bbb = defineRoutingPolicy('bbb', (candidates) => candidates[0]!.id)
/** The host tuple retains this declared name in its per-init Feature. */
const aaa = defineRoutingPolicy('aaa', (candidates) => candidates[0]!.id)
/** Named host provides a precise plugin tuple and child routing domain. */
const host = defineTrayHost({
  name: 'typed-mesh',
  routing: [aaa],
  plugins: (_info, trayPlugin) => {
    const dependent = definePlugin({
      name: 'consumer',
      features: {
        svc: defineFeature(
          (_core, deps) => {
            deps.tray.routing.aaa(host)
            deps.tray.routing('roundRobin', host)
            // @ts-expect-error A5: parent options do not declare a child policy.
            deps.tray.routing.bbb(host)
            return {}
          },
          { tray: trayPlugin.getFeature('tray') }
        )
      },
      install: () => ({})
    })
    return [service, dependent]
  },
  exposes: ['node.svc']
})
/** Static-only checks are never run; the package's test typecheck consumes their assertions. */
function check() {
  const tray = createTray({ hosts: [host], routing: [bbb] })
  tray.routing.aaa(host)
  tray.routing.bbb(host)
  tray.routing('aaa', host).request('node.svc.echo', 'ok')
  tray.routing('roundRobin', host)
  // @ts-expect-error A5: unregistered member remains outside the closed name union.
  tray.routing.nope(host)
  // @ts-expect-error A5: callable names have the same closed domain.
  tray.routing('nope', host)
  // @ts-expect-error A5: routed methods preserve their required payload type.
  tray.routing.aaa(host).request('node.svc.echo', 1)
  const policy: ITrayRoutingPolicy<'aaa'> = aaa
  const routing: ITrayRouting<'aaa', readonly [typeof host]> = tray.routing
  const remote: ITrayRoutedRemote<typeof host> = routing.aaa(host)
  void policy
  void remote
}
/** Four distinct literal policies per host exercise 256 names without recursive tuple walkers. */
function makeHost<const N extends string>(name: N) {
  return defineTrayHost({
    name,
    routing: [
      defineRoutingPolicy(`${name}A` as const, (candidates) => candidates[0]!.id),
      defineRoutingPolicy(`${name}B` as const, (candidates) => candidates[0]!.id),
      defineRoutingPolicy(`${name}C` as const, (candidates) => candidates[0]!.id),
      defineRoutingPolicy(`${name}D` as const, (candidates) => candidates[0]!.id)
    ],
    plugins: () => [service],
    exposes: ['node.svc']
  })
}
/** The explicit tuple preserves all 64 host identities and their four policy literals. */
const hosts = [
  makeHost('h0'),
  makeHost('h1'),
  makeHost('h2'),
  makeHost('h3'),
  makeHost('h4'),
  makeHost('h5'),
  makeHost('h6'),
  makeHost('h7'),
  makeHost('h8'),
  makeHost('h9'),
  makeHost('h10'),
  makeHost('h11'),
  makeHost('h12'),
  makeHost('h13'),
  makeHost('h14'),
  makeHost('h15'),
  makeHost('h16'),
  makeHost('h17'),
  makeHost('h18'),
  makeHost('h19'),
  makeHost('h20'),
  makeHost('h21'),
  makeHost('h22'),
  makeHost('h23'),
  makeHost('h24'),
  makeHost('h25'),
  makeHost('h26'),
  makeHost('h27'),
  makeHost('h28'),
  makeHost('h29'),
  makeHost('h30'),
  makeHost('h31'),
  makeHost('h32'),
  makeHost('h33'),
  makeHost('h34'),
  makeHost('h35'),
  makeHost('h36'),
  makeHost('h37'),
  makeHost('h38'),
  makeHost('h39'),
  makeHost('h40'),
  makeHost('h41'),
  makeHost('h42'),
  makeHost('h43'),
  makeHost('h44'),
  makeHost('h45'),
  makeHost('h46'),
  makeHost('h47'),
  makeHost('h48'),
  makeHost('h49'),
  makeHost('h50'),
  makeHost('h51'),
  makeHost('h52'),
  makeHost('h53'),
  makeHost('h54'),
  makeHost('h55'),
  makeHost('h56'),
  makeHost('h57'),
  makeHost('h58'),
  makeHost('h59'),
  makeHost('h60'),
  makeHost('h61'),
  makeHost('h62'),
  makeHost('h63')
] as const
/** Broad fixtures must retain the same closed namespace inference as small consumers. */
function checkWide() {
  /** Literal names must survive the generic host factory before namespace inference. */
  const first: 'h0A' = hosts[0].routing![0].name
  void first
  const tray = createTray({ hosts })
  tray.routing.h0A(hosts[0]).request('node.svc.echo', 'ok')
  tray.routing('h63D', hosts[63])
  // @ts-expect-error A5: scale never widens policy names to arbitrary strings.
  tray.routing('missing', hosts[0])
}
void check
void checkWide
