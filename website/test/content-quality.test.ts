import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import apiManifest from '../src/generated/manifests/apis.json'
import {
  createSupportingContractGuide,
  findApiGuide,
  findOptionTranslation
} from '../app/api-guides.js'
import { isCallableApiSymbol, type IApi } from '../app/content-contract.js'

/**
 * Reader-hostile generator text or unexplained implementation jargon forbidden in maintained
 * guides.
 */
const forbiddenProse =
  /first-party runtime surface|plain message transport|request\/response semantics|not-applicable|No documented errors are declared|No additional advanced behavior is declared|part of this module's public (?:function|class) contract/iu

/** Generated manifest interpreted through the public website projection contract. */
const typedApiManifest = apiManifest as unknown as { readonly apis: readonly IApi[] }

/** Returns every public operation that readers can invoke or construct. */
const callableSymbols = typedApiManifest.apis.flatMap((api) =>
  api.symbols.filter((symbol) => isCallableApiSymbol(symbol)).map((symbol) => ({ api, symbol }))
)

describe('site-wide task guide quality', () => {
  test('every callable API has complete independent Chinese and English guidance', () => {
    for (const { api, symbol } of callableSymbols) {
      for (const locale of ['zh', 'en'] as const) {
        const guide = findApiGuide(api.library, api.module, symbol.name, locale)
        assert.ok(guide, `${api.library}/${api.module}/${symbol.name} ${locale}`)
        if (!guide) continue
        assert.ok(
          guide.purpose.trim().length >= 30,
          `${symbol.name} ${locale} purpose is too short`
        )
        assert.ok(guide.quickStart?.trim(), `${symbol.name} ${locale} Quick Start`)
        assert.ok(guide.scenarios.length >= 2, `${symbol.name} ${locale} scenarios`)
        assert.ok(guide.avoidWhen.length >= 2, `${symbol.name} ${locale} avoid`)
        const prose = [guide.purpose, ...guide.scenarios, ...guide.avoidWhen].join(' ')
        assert.doesNotMatch(prose, forbiddenProse, `${symbol.name} ${locale} forbidden prose`)
      }
    }
  })

  test('every extracted configuration field has a useful reader-facing explanation', () => {
    for (const { api, symbol } of callableSymbols) {
      for (const field of symbol.configuration) {
        for (const locale of ['zh', 'en'] as const) {
          const guide = findApiGuide(api.library, api.module, symbol.name, locale)
          const option = guide?.options.find((candidate) => candidate.name === field.name)
          const description =
            option?.description ??
            findOptionTranslation(api.library, api.module, symbol.name, field.name, locale) ??
            (locale === 'zh' ? field.descriptionZh : field.descriptionEn) ??
            field.description
          assert.ok(
            description.trim().length >= 20,
            `${api.library}/${api.module}/${symbol.name}.${field.name} ${locale}`
          )
          assert.doesNotMatch(description, forbiddenProse)
        }
      }
    }
  })

  test('every supporting constant has a bilingual reference path', () => {
    for (const api of typedApiManifest.apis) {
      for (const symbol of api.symbols.filter(
        (candidate) => candidate.kind === 'const' && !isCallableApiSymbol(candidate)
      )) {
        for (const locale of ['zh', 'en'] as const) {
          const guide =
            findApiGuide(api.library, api.module, symbol.name, locale) ??
            createSupportingContractGuide(api.library, symbol, locale)
          assert.ok(guide, `${api.library}/${api.module}/${symbol.name} ${locale}`)
          assert.ok(guide.quickStart?.trim(), `${symbol.name} ${locale} reference example`)
          assert.ok(guide.scenarios.length >= 2, `${symbol.name} ${locale} scenarios`)
          assert.ok(guide.avoidWhen.length >= 2, `${symbol.name} ${locale} avoid`)
          assert.doesNotMatch(
            [guide.purpose, ...guide.scenarios, ...guide.avoidWhen].join(' '),
            forbiddenProse
          )
        }
      }
    }
  })
})
