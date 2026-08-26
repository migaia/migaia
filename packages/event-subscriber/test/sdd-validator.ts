import { expect } from 'vitest'

export const ACTIVE_CALLABLE_CASES = new Set([
  ...Array.from({ length: 12 }, (_, index) => `ES-T${100 + index}`),
  ...Array.from({ length: 8 }, (_, index) => `ES-T${113 + index}`),
  'ES-T121'
])

type IParsedSdd = {
  readonly activeCases: Set<string>
  readonly forward: Map<string, Set<string>>
  readonly reverse: Map<string, Set<string>>
  readonly missions: Map<string, Set<string>>
  readonly errors: Map<string, Set<string>>
}

const cells = (line: string): string[] =>
  line
    .split('|')
    .slice(1, -1)
    .map((cell) => cell.trim())
/** Expands explicit IDs and same-family `～` ranges into canonical IDs. */
const ids = (text: string): Set<string> => {
  const result = new Set<string>()
  const pattern = /ES-([RTD])(\d+)(?:～(?:ES-)?\1?(\d+))?|ES-(E-\d+)/g
  for (const match of text.matchAll(pattern)) {
    if (match[4]) {
      result.add(`ES-${match[4]}`)
      continue
    }
    const prefix = match[1]
    const start = Number(match[2])
    const end = match[3] ? Number(match[3]) : start
    for (let value = start; value <= end; value += 1) result.add(`ES-${prefix}${value}`)
  }
  return result
}
const table = (text: string, heading: string, nextHeading: string): string[] => {
  const start = text.indexOf(heading)
  const end = text.indexOf(nextHeading, start + heading.length)
  return text.slice(start, end < 0 ? text.length : end).split('\n')
}

/** Extracts only authoritative SDD sections; historical Achievement Reviews are excluded. */
export const authoritativeSdd = (sdd: string): string => {
  const lines = sdd.split('\n')
  const sections = [
    ...lines.slice(
      0,
      lines.findIndex((line) => line.startsWith('## 1.'))
    ),
    ...lines.slice(
      lines.findIndex((line) => line.startsWith('## 1.')),
      lines.findIndex((line) => line.startsWith('### 8.1'))
    ),
    ...lines.slice(
      lines.findIndex((line) => line.startsWith('### 8.1')),
      lines.findIndex((line) => line.startsWith('### 8.4'))
    ),
    ...lines.slice(
      lines.findIndex((line) => line.startsWith('### 8.2')),
      lines.findIndex((line) => line.startsWith('### 8.4'))
    ),
    ...lines.slice(
      lines.findIndex((line) => line.startsWith('### 8.3')),
      lines.findIndex((line) => line.startsWith('### 8.4'))
    ),
    ...lines.slice(
      lines.findIndex((line) => line.startsWith('## 9.')),
      lines.findIndex((line) => line.startsWith('### 8.12'))
    )
  ]
  return sections.join('\n')
}

export const parseSdd = (sdd: string): IParsedSdd => {
  const caseLines = table(sdd, '| ES-T100 | type/compat', '历史编号：')
  const forward = new Map<string, Set<string>>()
  for (const line of caseLines) {
    const row = cells(line)
    if (row.length >= 4 && /^ES-T\d+$/.test(row[0]) && row[0] !== 'ES-T112')
      forward.set(row[0], new Set([...ids(row[3])].filter((id) => !id.startsWith('ES-T'))))
  }
  const reverse = new Map<string, Set<string>>()
  for (const line of table(sdd, '### 8.1', '### 8.2')) {
    const row = cells(line)
    if (row.length >= 2 && /^(?:ES-[RD]\d+|ES-E-\d+)$/.test(row[0]))
      reverse.set(row[0], ids(row[1]))
  }
  const missions = new Map<string, Set<string>>()
  for (const line of table(sdd, '### 8.2', '### 8.3')) {
    const row = cells(line)
    if (row.length >= 2 && /^ES-M\d+$/.test(row[0])) {
      const missionCases = row[0] === 'ES-M11' ? ids(row[1]) : ids(row[1])
      missionCases.delete('ES-T112')
      missions.set(row[0], missionCases)
    }
  }
  const errors = new Map<string, Set<string>>()
  for (const line of table(sdd, '### 8.3', '### 8.4')) {
    const row = cells(line)
    if (row.length >= 2 && /^ES-E-\d+$/.test(row[0])) {
      const mapped = ids(row[1])
      errors.set(row[0], mapped)
      reverse.set(row[0], mapped)
    }
  }
  return {
    activeCases: new Set(
      caseLines.flatMap((line) =>
        [...ids(line)].filter((id) => id.startsWith('ES-T') && id !== 'ES-T112')
      )
    ),
    forward,
    reverse,
    missions,
    errors
  }
}

export const assertSdd = (sdd: string): IParsedSdd => {
  const parsed = parseSdd(sdd)
  expect(parsed.activeCases).toEqual(ACTIVE_CALLABLE_CASES)
  expect(parsed.missions.get('ES-M11')).toEqual(ACTIVE_CALLABLE_CASES)
  expect(parsed.missions.get('ES-M11')).not.toContain('ES-T112')
  expect(authoritativeSdd(sdd)).not.toContain('ES-T112、ES-T113')
  const reverseCases = new Set([...parsed.reverse.values()].flatMap((value) => [...value]))
  for (const id of ACTIVE_CALLABLE_CASES) expect(reverseCases).toContain(id)
  const forwardEdges = new Set(
    [...parsed.forward]
      .filter(([id]) => ACTIVE_CALLABLE_CASES.has(id))
      .flatMap(([id, clauses]) => [...clauses].map((clause) => `${id}:${clause}`))
  )
  const reverseEdges = new Set(
    [...parsed.reverse].flatMap(([clause, cases]) =>
      [...cases].filter((id) => ACTIVE_CALLABLE_CASES.has(id)).map((id) => `${id}:${clause}`)
    )
  )
  expect(reverseEdges).toEqual(forwardEdges)
  expect([...forwardEdges].filter((edge) => !reverseEdges.has(edge))).toEqual([])
  expect([...reverseEdges].filter((edge) => !forwardEdges.has(edge))).toEqual([])
  const authoritative = authoritativeSdd(sdd)
  if (!/^- 状态：\*\*verified\*\*/m.test(authoritative))
    throw new Error('SDD header status mismatch: active verified scope requires verified header')
  expect(authoritative).toContain('Achievement Review：**ES-A01～ES-A08 verified**')
  const sectionSeven = authoritative.slice(
    authoritative.indexOf('## 7.'),
    authoritative.indexOf('## 8.')
  )
  if (/\| (?:red|implemented-unverified|pending|blocked) \|/.test(sectionSeven))
    throw new Error(
      'SDD active status mismatch: verified header cannot contain non-verified active item'
    )
  expect(sectionSeven).not.toContain('missing / red')
  expect(sectionSeven).not.toContain('尚未补齐')
  expect(sectionSeven).not.toContain('未闭合')
  return parsed
}
