import {
  createStorageHost,
  defineFeature,
  memoryBackendKind,
  memoryBackendPlugin
} from '@migaia/storage-host'
import { defineEntity } from '@migaia/storage-host/entity'
import {
  lockKey,
  records,
  rdf,
  vector,
  type IQuad,
  type IVectorHit
} from '@migaia/storage-contract'

/** A domain row retains exact field names through each public query family. */
type ITypeCostRow = { id: string; name: string; active: boolean }
/** Bidirectional type comparison rejects accidental widening, including any. */
type IEqual<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false
/** A failed inference proof must fail this independent consumer's compilation. */
type IAssert<T extends true> = T

/** Feature 1 retains the exact receiver in every original chain family. */
const feature1 = defineFeature(memoryBackendKind, () => ({
  capabilities: [],
  chain: {
    query: {
      step1<T>(this: T): T {
        return this
      }
    },
    tx: {
      step1<T>(this: T): T {
        return this
      }
    },
    vector: {
      step1<T>(this: T): T {
        return this
      }
    },
    rdf: {
      step1<T>(this: T): T {
        return this
      }
    }
  },
  api: { store: {}, transaction: {} }
}))

/** Feature 2 retains the exact receiver in every original chain family. */
const feature2 = defineFeature(memoryBackendKind, () => ({
  capabilities: [],
  chain: {
    query: {
      step2<T>(this: T): T {
        return this
      }
    },
    tx: {
      step2<T>(this: T): T {
        return this
      }
    },
    vector: {
      step2<T>(this: T): T {
        return this
      }
    },
    rdf: {
      step2<T>(this: T): T {
        return this
      }
    }
  },
  api: { store: {}, transaction: {} }
}))

/** Feature 3 retains the exact receiver in every original chain family. */
const feature3 = defineFeature(memoryBackendKind, () => ({
  capabilities: [],
  chain: {
    query: {
      step3<T>(this: T): T {
        return this
      }
    },
    tx: {
      step3<T>(this: T): T {
        return this
      }
    },
    vector: {
      step3<T>(this: T): T {
        return this
      }
    },
    rdf: {
      step3<T>(this: T): T {
        return this
      }
    }
  },
  api: { store: {}, transaction: {} }
}))

/** Feature 4 retains the exact receiver in every original chain family. */
const feature4 = defineFeature(memoryBackendKind, () => ({
  capabilities: [],
  chain: {
    query: {
      step4<T>(this: T): T {
        return this
      }
    },
    tx: {
      step4<T>(this: T): T {
        return this
      }
    },
    vector: {
      step4<T>(this: T): T {
        return this
      }
    },
    rdf: {
      step4<T>(this: T): T {
        return this
      }
    }
  },
  api: { store: {}, transaction: {} }
}))

/** Feature 5 retains the exact receiver in every original chain family. */
const feature5 = defineFeature(memoryBackendKind, () => ({
  capabilities: [],
  chain: {
    query: {
      step5<T>(this: T): T {
        return this
      }
    },
    tx: {
      step5<T>(this: T): T {
        return this
      }
    },
    vector: {
      step5<T>(this: T): T {
        return this
      }
    },
    rdf: {
      step5<T>(this: T): T {
        return this
      }
    }
  },
  api: { store: {}, transaction: {} }
}))

/** Five actual Feature installations flow through the original memory backend authoring entry. */
const host = await createStorageHost({
  plugins: [memoryBackendPlugin(undefined, { feature1, feature2, feature3, feature4, feature5 })]
})
/** Exact backend lookup must preserve every selected Feature. */
const store = host.backend('memory')
/** Each original query receiver passes through every Feature twice before a shape change. */
const recordResult = store
  .use(records)
  .query<ITypeCostRow>()
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .where({ active: true })
  .select('name')
  .all()
/** Selection keeps only the requested record field. */
export type IRecordInference = IAssert<
  IEqual<Awaited<typeof recordResult>, Pick<ITypeCostRow, 'name'>[]>
>
/** The vector family keeps payload typing and its bounded terminal after ten Feature calls. */
const vectorResult = store
  .use(vector)
  .collection<ITypeCostRow>('profiles', { dimensions: 3, metric: 'cosine' })
  .near([1, 0, 0])
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .topK(3)
  .all()
/** Vector results remain the canonical shared hit type. */
export type IVectorInference = IAssert<
  IEqual<Awaited<typeof vectorResult>, IVectorHit<ITypeCostRow>[]>
>
/** RDF keeps its own projection family instead of borrowing record augmentations. */
const rdfResult = store
  .use(rdf)
  .match({})
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .select('subject')
  .all()
/** RDF selection keeps its actual subject term. */
export type IRdfInference = IAssert<IEqual<Awaited<typeof rdfResult>, Pick<IQuad, 'subject'>[]>>
/** Locking still grants run only through the original transaction builder. */
const transactionResult = store
  .tx()
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .step1()
  .step2()
  .step3()
  .step4()
  .step5()
  .lock(lockKey.text('profile'))
  .run(async (scope) => {
    /** Native transaction scopes retain all five record Feature methods. */
    const selected = scope
      .use(records)
      .query<ITypeCostRow>()
      .step1()
      .step2()
      .step3()
      .step4()
      .step5()
      .step1()
      .step2()
      .step3()
      .step4()
      .step5()
      .where({ active: true })
      .select('id')
      .all()
    return selected
  })
/** Transaction output carries the selected record field through its Promise boundary. */
export type ITransactionInference = IAssert<
  IEqual<Awaited<typeof transactionResult>, Pick<ITypeCostRow, 'id'>[]>
>
/** Entity queries consume the same original backend with precise selected field inference. */
const repository = defineEntity<ITypeCostRow>({ name: 'type-cost-users', key: 'id' }).connect(store)
/** Ten real immutable query steps retain the entity domain before projection. */
const entityResult = repository
  .query()
  .where({ active: true })
  .where({ name: 'Ada' })
  .where({ active: true })
  .where({ name: 'Ada' })
  .where({ active: true })
  .where({ name: 'Ada' })
  .where({ active: true })
  .where({ name: 'Ada' })
  .where({ active: true })
  .where({ name: 'Ada' })
  .select('name')
  .all()
/** Entity selection preserves the named domain field without a type assertion. */
export type IEntityInference = IAssert<
  IEqual<Awaited<typeof entityResult>, Pick<ITypeCostRow, 'name'>[]>
>

await host.dispose()
