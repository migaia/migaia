/** Catalog-level model check run once per `partom doctor` run. */
import type { ICatalogView, IIssue } from './types.ts'

/** Rule id and message key of a missing relation target. */
export const MODEL_RELATION_TARGET = 'model.relation-target'

/**
 * Reports every model relation whose target is missing from the catalog or is not a model; the
 * issue address is the model id, so relations of the same name on two models stay apart. Pure; one
 * pass over the catalog and each model's relations, O(models + relations).
 */
export function checkModels(catalog: ICatalogView): IIssue[] {
  /** Collected issues. */
  const issues: IIssue[] = []
  for (const descriptor of catalog.all()) {
    if (descriptor.kind !== 'model') continue
    for (const [name, relation] of Object.entries(descriptor.model?.relations ?? {}))
      if (catalog.get(relation.target)?.kind !== 'model')
        issues.push({
          address: descriptor.id,
          facet: 'model',
          path: `model.relations.${name}`,
          code: MODEL_RELATION_TARGET,
          rule: MODEL_RELATION_TARGET,
          messageKey: MODEL_RELATION_TARGET,
          severity: 'error'
        })
  }
  return issues
}
