/** One provider catalog owns exact entries, cold reservations and their cached directory. */
import type { IRpcMethodDescription } from '@migaia/rpc-contract/protocol'
import { ProviderRegistration } from './registration.js'
import type { IProviderMethodEntry } from './types.js'

/** Public providers use the global scope; ordinary native exposure uses its transport namespace. */
export class ProviderCatalog {
  /** This is the sole executable index for one scope, not a copied dispatch table. */
  readonly methods = new Map<string, IProviderMethodEntry>()
  /** Candidates own exact cold reservations until original native commit or rollback. */
  readonly reservations = new Map<string, ProviderRegistration>()
  /** Directory compilation is cold and never repeats on the business invocation path. */
  description: readonly IRpcMethodDescription[] = Object.freeze([])
  /** Empty native scopes retire with their last original registration. */
  readonly #onEmpty: () => void
  /** One canonical projection describes both public and native entries. */
  readonly #describe: (entry: IProviderMethodEntry) => IRpcMethodDescription

  /** The dispatcher supplies identity-based retirement without another persistent owner. */
  constructor(
    describe: (entry: IProviderMethodEntry) => IRpcMethodDescription,
    onEmpty: () => void
  ) {
    this.#describe = describe
    this.#onEmpty = onEmpty
  }

  /** Reserve original compiled entries; existing replacement keeps its exact transaction rules. */
  prepare(
    entries: ReadonlyMap<string, IProviderMethodEntry>,
    previous?: ProviderRegistration
  ): ProviderRegistration {
    return new ProviderRegistration(
      this.methods,
      entries,
      this.reservations,
      previous,
      this.#refresh
    )
  }

  /** Published methods win; an exact native reservation may wait on its existing install gate. */
  lookup(name: string): IProviderMethodEntry | undefined {
    return this.methods.get(name) ?? this.reservations.get(name)?.get(name)
  }

  /** Publication and withdrawal update one cached projection and drop only genuinely empty scopes. */
  readonly #refresh = (): void => {
    this.description = Object.freeze(Array.from(this.methods.values(), this.#describe))
    if (this.methods.size === 0 && this.reservations.size === 0) this.#onEmpty()
  }

  /** Closing releases original reservations before removing their one live catalog. */
  close(): void {
    for (const registration of this.reservations.values()) registration.dispose()
    this.methods.clear()
    this.#refresh()
  }
}
