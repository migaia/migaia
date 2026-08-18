import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const sddPath = fileURLToPath(
  new URL('../../../docs/serialize/serialize-registry.sdd.md', import.meta.url)
);

describe('serialize SDD closure', () => {
  it('resolves every mapped requirement to exactly one canonical declaration', () => {
    const sdd = readFileSync(sddPath, 'utf8');
    const requirementTableIds = [...sdd.matchAll(/^\|\s*(SER-R\d+-\d+)\s*\|/gm)].map(
      (match) => match[1]
    );
    const requirementTableSet = new Set(requirementTableIds);
    const batchRequirementIds = [...sdd.matchAll(/^-\s*`?(SER-R\d+-\d+)`?：/gm)].map(
      (match) => match[1]
    );
    const canonicalRequirementIds = [
      ...requirementTableIds,
      ...batchRequirementIds.filter((id) => !requirementTableSet.has(id))
    ];
    const closureStart = sdd.indexOf('## 7.');
    const closureEnd = sdd.indexOf('## 8.', closureStart);
    expect(closureStart).toBeGreaterThanOrEqual(0);
    expect(closureEnd).toBeGreaterThan(closureStart);
    const closure = sdd.slice(closureStart, closureEnd);
    const mappedRequirementIds = [...closure.matchAll(/`?(SER-R\d+-\d+)`?\s*=/g)].map(
      (match) => match[1]
    );

    expect(new Set(requirementTableIds).size).toBe(requirementTableIds.length);
    expect(new Set(mappedRequirementIds).size).toBe(mappedRequirementIds.length);
    for (const id of mappedRequirementIds) {
      expect(
        canonicalRequirementIds.filter((candidate) => candidate === id),
        id
      ).toHaveLength(1);
    }
    for (const id of canonicalRequirementIds) {
      expect(
        mappedRequirementIds.filter((candidate) => candidate === id),
        id
      ).toHaveLength(1);
    }

    const architectureStart = sdd.indexOf('## 3.');
    const architectureEnd = sdd.indexOf('## 4.', architectureStart);
    const decisionIds = [
      ...sdd.slice(architectureStart, architectureEnd).matchAll(/^\|\s*(SER-D\d+-\d+)\s*\|/gm)
    ].map((match) => match[1]);
    const testStart = sdd.indexOf('## 7.');
    const testIds = [
      ...sdd.slice(testStart, closureEnd).matchAll(/^\|\s*(SER-T\d+-\d+)\s*\|/gm)
    ].map((match) => match[1]);

    expect(new Set(decisionIds).size).toBe(decisionIds.length);
    expect(new Set(testIds).size).toBe(testIds.length);
  });
});
