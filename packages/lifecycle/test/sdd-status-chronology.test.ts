import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

type IStatus = 'implemented-unverified' | 'verified';

type IFinding = {
  status: IStatus;
  owner: string;
};

type IStatusMapping = {
  foundationId: string;
  owner: string;
  documentPath: string;
  clauseIds: readonly string[];
  caseIds: readonly string[];
};

type IEvidenceCounts = {
  lifecycle: number;
  resource: number;
  capability: number;
  reactive: number;
  serialize: number;
  middleware: number;
  pluginHost: number;
  logger: number;
};

type IEvidenceSection = {
  round: number;
  document: string;
};

/** Stable status values used by the foundation audit and package SDD closure tables. */
const statusPattern = /^(implemented-unverified|verified)(?:\s*[（(].*)?$/;

/** Reads one repository document relative to this lifecycle test file. */
const readDocument = (documentPath: string): string =>
  readFileSync(fileURLToPath(new URL(documentPath, import.meta.url)), 'utf8');

/** Escapes an SDD identifier before using it in an anchored table-row expression. */
const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Returns exact table rows whose first cell is the requested stable ID. */
const tableRowsFor = (document: string, id: string): string[] => {
  const rowPattern = new RegExp(`^\\|\\s*${escapeRegExp(id)}\\s*\\|[^\\n]*$`, 'gm');
  return [...document.matchAll(rowPattern)].map((match) => match[0]);
};

/** Extracts status-bearing table cells for one stable ID without scanning prose. */
const statusesFor = (document: string, id: string): IStatus[] => {
  const rows = tableRowsFor(document, id);
  const statuses: IStatus[] = [];
  for (const row of rows) {
    const cells = row.split('|');
    for (let index = 1; index < cells.length - 1; index += 1) {
      const statusMatch = cells[index]?.trim().match(statusPattern);
      if (statusMatch) statuses.push(statusMatch[1] as IStatus);
    }
  }
  return statuses;
};

/** Reads the canonical AF finding status and owner from the foundation findings table. */
const findingFor = (document: string, id: string): IFinding[] => {
  const rows = tableRowsFor(document, id);
  const findings: IFinding[] = [];
  for (const row of rows) {
    const cells = row
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim());
    const status = cells[1]?.match(statusPattern)?.[1] as IStatus | undefined;
    const owner = cells[2];
    if (status && owner) findings.push({ status, owner });
  }
  return findings;
};

/** Reads the document header status, keeping package-level chronology separate from clause rows. */
const documentStatuses = (document: string): IStatus[] => {
  const statuses: IStatus[] = [];
  for (const match of document.matchAll(
    /^[-*]\s*状态：.*?\b(implemented-unverified|verified)\b/gm
  )) {
    statuses.push(match[1] as IStatus);
  }
  return statuses;
};

/** Extracts evidence-set lines so historical prose cannot masquerade as current evidence. */
const evidenceLinesFor = (document: string): string[] =>
  document
    .split('\n')
    .map((line) => line.trim())
    .filter((line) =>
      /^(?:[-*]\s*)?(?:Round\d+ [^（:：\n]*\bevidence(?:[（:：]|$)|历史\/superseded evidence(?:[（:：]|$)|当前证据(?:[（:：]|$)|current evidence(?:[（:：]|$))/.test(
        line
      )
    );

/** Extracts only the stable label prefix from an evidence line, excluding historical details. */
const evidenceLabelsFor = (document: string): string[] =>
  evidenceLinesFor(document).map((line) => {
    const labelMatch = line.match(
      /^(?:[-*]\s*)?(Round\d+\s+[^（:：]+|历史\/superseded evidence|当前证据|current evidence)/
    );
    return labelMatch?.[1]?.trim() ?? line;
  });

/** Reads the latest numbered implementation-evidence section from the umbrella audit. */
const latestUmbrellaEvidenceSectionFor = (document: string): IEvidenceSection => {
  const sectionPattern = /^###\s+(\d+)\.3\s+实现证据与(?:下一轮|最终)门禁\s*$/gm;
  const matches = [...document.matchAll(sectionPattern)];
  const latestMatch = matches.at(-1);
  if (!latestMatch) return { round: Number.NaN, document: '' };

  const sectionStart = latestMatch.index ?? 0;
  const contentStart = sectionStart + latestMatch[0].length;
  const nextSectionOffset = document.slice(contentStart).search(/^###\s+\d+\.\d+\s|^##\s+\d+\./m);
  const sectionEnd = nextSectionOffset < 0 ? document.length : contentStart + nextSectionOffset;
  return {
    round: Number(latestMatch[1]),
    document: document.slice(sectionStart, sectionEnd)
  };
};

/** Parses authoritative package counts from the latest umbrella evidence declaration. */
const evidenceCountsFor = (evidence: string): IEvidenceCounts => {
  const countMatch = evidence.match(
    /current counts\s+`?lifecycle\s+(\d+)\s*\/\s*resource\s+(\d+)\s*\/\s*capability\s+(\d+)\s*\/\s*reactive\s+(\d+)\s*\/\s*serialize\s+(\d+)\s*\/\s*middleware\s+(\d+)\s*\/\s*plugin-host\s+(\d+)\s*\/\s*logger\s+(\d+)`?/i
  );
  expect(countMatch, 'latest umbrella current counts').not.toBeNull();
  return {
    lifecycle: Number(countMatch?.[1]),
    resource: Number(countMatch?.[2]),
    capability: Number(countMatch?.[3]),
    reactive: Number(countMatch?.[4]),
    serialize: Number(countMatch?.[5]),
    middleware: Number(countMatch?.[6]),
    pluginHost: Number(countMatch?.[7]),
    logger: Number(countMatch?.[8])
  };
};

/** Reads one package count from a single declared evidence-set heading. */
const countFor = (evidence: string, packageName: string): number | undefined => {
  const countMatch = evidence.match(new RegExp(`${escapeRegExp(packageName)}.*?(\\d+)\\s+tests`));
  return countMatch?.[1] === undefined ? undefined : Number(countMatch[1]);
};

/** Maps document package labels to the matching umbrella count property. */
const authoritativeCountFor = (counts: IEvidenceCounts, packageName: string): number => {
  const countKeys: Record<string, keyof IEvidenceCounts> = {
    lifecycle: 'lifecycle',
    resource: 'resource',
    capability: 'capability',
    reactive: 'reactive',
    serialize: 'serialize',
    'middleware-pipeline': 'middleware',
    'plugin-host': 'pluginHost',
    logger: 'logger'
  };
  return counts[countKeys[packageName] ?? 'logger'];
};

/** Identifies labels that declare a document's current evidence set. */
const isCurrentEvidenceLabel = (label: string): boolean =>
  /\bcurrent\b/i.test(label) || /当前证据/.test(label);

/** Identifies historical labels required for non-current package count evidence. */
const isHistoricalEvidenceLabel = (label: string): boolean =>
  /historical|superseded|历史|已被.*supersede/i.test(label);

/** Reads a workspace metadata file relative to this lifecycle test file. */
const readWorkspaceDocument = (documentPath: string): string =>
  readFileSync(fileURLToPath(new URL(documentPath, import.meta.url)), 'utf8');

/** Round30 package documents whose current evidence must be checked against the umbrella. */
const currentEvidenceDocuments: readonly { packageName: string; documentPath: string }[] = [
  { packageName: 'lifecycle', documentPath: '../../../docs/lifecycle/lifecycle-extraction.sdd.md' },
  { packageName: 'resource', documentPath: '../../../docs/resource/admission-boundary.sdd.md' },
  { packageName: 'capability', documentPath: '../../../docs/capability/admission-boundary.sdd.md' },
  { packageName: 'reactive', documentPath: '../../../docs/reactive/reactive.sdd.md' },
  { packageName: 'serialize', documentPath: '../../../docs/serialize/serialize-registry.sdd.md' },
  {
    packageName: 'middleware-pipeline',
    documentPath: '../../../docs/middleware-pipeline/middleware-pipeline.sdd.md'
  },
  {
    packageName: 'plugin-host',
    documentPath: '../../../docs/plugin-host/runtime-neutral-foundation.sdd.md'
  },
  {
    packageName: 'logger',
    documentPath: '../../../docs/logger/logger-lifecycle-and-reliability.sdd.md'
  }
];

/**
 * Normative SDD paths that must be reproducible in a checkout despite docs being ignored by
 * default.
 */
const normativeSddPaths = [
  'docs/review/foundation-runtime-adversarial-audit.sdd.md',
  'docs/lifecycle/lifecycle-extraction.sdd.md',
  'docs/resource/admission-boundary.sdd.md',
  'docs/capability/admission-boundary.sdd.md',
  'docs/reactive/reactive.sdd.md',
  'docs/serialize/serialize-registry.sdd.md',
  'docs/middleware-pipeline/middleware-pipeline.sdd.md',
  'docs/plugin-host/runtime-neutral-foundation.sdd.md',
  'docs/logger/logger-lifecycle-and-reliability.sdd.md'
] as const;

/** Stable Round30 finding/case pairs recorded in the foundation umbrella. */
const round30Mappings = Array.from({ length: 11 }, (_, index) => {
  const number = index + 234;
  return { findingId: `AF-${number}`, caseId: `AF-T${number}` };
});

/** Canonical cross-SDD review mappings owned by the foundation audit. */
const mappings: readonly IStatusMapping[] = [
  {
    foundationId: 'AF-181',
    owner: 'middleware-pipeline',
    documentPath: '../../../docs/middleware-pipeline/middleware-pipeline.sdd.md',
    clauseIds: ['MP-R17', 'MP-D08'],
    caseIds: ['MP-T26', 'MP-T27', 'MP-T28', 'MP-T29', 'MP-T30']
  },
  {
    foundationId: 'AF-197',
    owner: 'lifecycle',
    documentPath: '../../../docs/lifecycle/lifecycle-extraction.sdd.md',
    clauseIds: ['L-R14'],
    caseIds: ['L-T60']
  },
  {
    foundationId: 'AF-198',
    owner: 'resource',
    documentPath: '../../../docs/resource/admission-boundary.sdd.md',
    clauseIds: ['R-R01', 'R-R02', 'R-R03'],
    caseIds: ['R-T01', 'R-T02', 'R-T03']
  },
  {
    foundationId: 'AF-199',
    owner: 'capability',
    documentPath: '../../../docs/capability/admission-boundary.sdd.md',
    clauseIds: ['C-R01'],
    caseIds: ['C-T01']
  },
  {
    foundationId: 'AF-200',
    owner: 'plugin-host',
    documentPath: '../../../docs/plugin-host/runtime-neutral-foundation.sdd.md',
    clauseIds: ['PH-R34'],
    caseIds: ['PH-T32a', 'PH-T32b', 'PH-T32c', 'PH-T32d']
  }
];

describe('cross-SDD status chronology', () => {
  it('preserves historical clause chronology after the package current status is verified', () => {
    const foundation = readDocument(
      '../../../docs/review/foundation-runtime-adversarial-audit.sdd.md'
    );

    for (const mapping of mappings) {
      const findings = findingFor(foundation, mapping.foundationId);
      expect(findings, mapping.foundationId).toHaveLength(1);
      const finding = findings[0];
      expect(finding?.owner, mapping.foundationId).toBe(mapping.owner);
      expect(finding?.status, mapping.foundationId).toBe('implemented-unverified');

      const packageDocument = readDocument(mapping.documentPath);
      const packageStatuses = documentStatuses(packageDocument);
      expect(packageStatuses, `${mapping.owner} document status`).toEqual(['verified']);

      for (const clauseId of mapping.clauseIds) {
        const clauseStatuses = statusesFor(packageDocument, clauseId);
        expect(clauseStatuses, `${mapping.owner} ${clauseId}`).toEqual(['implemented-unverified']);
      }

      for (const caseId of mapping.caseIds) {
        expect(tableRowsFor(packageDocument, caseId), `${mapping.owner} ${caseId}`).toHaveLength(1);
        const caseStatuses = statusesFor(packageDocument, caseId);
        if (caseStatuses.length > 0) {
          expect(caseStatuses, `${mapping.owner} ${caseId} status`).toEqual([
            'implemented-unverified'
          ]);
        }
      }
    }
  });

  it('AF-T227: keeps exactly one current evidence set with current package counts', () => {
    const umbrella = latestUmbrellaEvidenceSectionFor(
      readDocument('../../../docs/review/foundation-runtime-adversarial-audit.sdd.md')
    );
    const authoritativeCounts = evidenceCountsFor(umbrella.document);
    expect(umbrella.round, 'latest umbrella evidence round').toBeGreaterThan(0);

    for (const { packageName, documentPath } of currentEvidenceDocuments) {
      const document = readDocument(documentPath);
      const evidenceLines = evidenceLinesFor(document);
      const evidenceLabels = evidenceLabelsFor(document);
      const currentEvidence = evidenceLines.filter((_, index) =>
        isCurrentEvidenceLabel(evidenceLabels[index] ?? '')
      );

      expect(currentEvidence, `${documentPath} current evidence`).toHaveLength(1);
      expect(
        evidenceLabels.filter(isCurrentEvidenceLabel),
        `${documentPath} current headings`
      ).toHaveLength(1);
      expect(
        evidenceLabels.filter((label) =>
          /\b(?:current corrected|failure|failed|stale)\b|当前证据/.test(label)
        ),
        `${documentPath} stale evidence headings`
      ).toEqual([]);

      for (const [index, evidenceLine] of evidenceLines.entries()) {
        const label = evidenceLabels[index] ?? '';
        const hasPackageCount = ['middleware-pipeline', 'plugin-host', 'logger'].some(
          (packageName) => countFor(evidenceLine, packageName) !== undefined
        );
        if (hasPackageCount && !isCurrentEvidenceLabel(label)) {
          expect(isHistoricalEvidenceLabel(label), `${documentPath} historical label`).toBe(true);
        }
      }

      const evidence = currentEvidence[0] ?? '';
      const packageCount = countFor(evidence, packageName);
      const authoritativeCount = authoritativeCountFor(authoritativeCounts, packageName);
      expect(packageCount, `${documentPath} ${packageName} current count`).toBe(authoritativeCount);
    }
  });

  it('AF-T234..AF-T244: closes Round30 statuses and static metadata without Git index state', () => {
    const foundation = readDocument(
      '../../../docs/review/foundation-runtime-adversarial-audit.sdd.md'
    );

    for (const mapping of round30Mappings) {
      const findings = findingFor(foundation, mapping.findingId);
      expect(findings, mapping.findingId).toHaveLength(1);
      expect(findings[0]?.status, mapping.findingId).toBe('verified');
      expect(tableRowsFor(foundation, mapping.caseId), mapping.caseId).toHaveLength(1);
      expect(statusesFor(foundation, mapping.caseId), mapping.caseId).toEqual(['verified']);
    }

    const umbrella = latestUmbrellaEvidenceSectionFor(foundation);
    const authoritativeCounts = evidenceCountsFor(umbrella.document);
    expect(umbrella.round).toBe(47);

    for (const { packageName, documentPath } of currentEvidenceDocuments) {
      const document = readDocument(documentPath);
      const evidenceLines = evidenceLinesFor(document);
      const evidenceLabels = evidenceLabelsFor(document);
      const currentEvidence = evidenceLines.filter((_, index) =>
        isCurrentEvidenceLabel(evidenceLabels[index] ?? '')
      );
      expect(currentEvidence, `${documentPath} sole current evidence`).toHaveLength(1);
      const evidence = currentEvidence[0] ?? '';
      expect(evidence, `${documentPath} result status`).toMatch(/result status:\s*`?verified`?/i);
      expect(evidence, `${documentPath} blocker absence`).toMatch(/blocker:\s*none\b/i);
      expect(evidence, `${documentPath} dependency statement`).toMatch(/dependency:\s*[^;；]+/i);
      expect(countFor(evidence, packageName), `${documentPath} current count`).toBe(
        authoritativeCountFor(authoritativeCounts, packageName)
      );
    }

    const ignoreFile = readWorkspaceDocument('../../../.gitignore');
    const negatedPaths = ignoreFile
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('!'))
      .map((line) => line.slice(1));
    expect(normativeSddPaths.every((path) => negatedPaths.includes(path))).toBe(true);
    expect(negatedPaths.filter((path) => path.startsWith('docs/'))).toEqual([
      'docs/utils/',
      'docs/utils/public-utilities.sdd.md',
      'docs/review/',
      'docs/review/foundation-runtime-adversarial-audit.sdd.md',
      'docs/lifecycle/',
      'docs/lifecycle/lifecycle-extraction.sdd.md',
      'docs/resource/',
      'docs/resource/admission-boundary.sdd.md',
      'docs/capability/',
      'docs/capability/admission-boundary.sdd.md',
      'docs/reactive/',
      'docs/reactive/reactive.sdd.md',
      'docs/serialize/',
      'docs/serialize/serialize-registry.sdd.md',
      'docs/middleware-pipeline/',
      'docs/middleware-pipeline/middleware-pipeline.sdd.md',
      'docs/plugin-host/',
      'docs/plugin-host/runtime-neutral-foundation.sdd.md',
      'docs/logger/',
      'docs/logger/logger-lifecycle-and-reliability.sdd.md'
    ]);
  });
});
