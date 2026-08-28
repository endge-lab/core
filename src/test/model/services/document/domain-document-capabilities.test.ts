import { describe, expect, it } from 'vitest'

import { DOMAIN_DOCUMENT_DESCRIPTORS } from '@/domain/documents/domain-document-descriptors'
import { EndgeCompiler } from '@/model/modules/program/endge-compiler'
import { EndgeSource } from '@/model/modules/program/endge-source'
import { ActionRuntimeStrategy } from '@/model/services/runtime/strategies/ActionRuntimeStrategy'
import { ComponentSFCRuntimeStrategy } from '@/model/services/runtime/strategies/ComponentSFCRuntimeStrategy'
import { CompositionRuntimeStrategy } from '@/model/services/runtime/strategies/CompositionRuntimeStrategy'
import { FilterRuntimeStrategy } from '@/model/services/runtime/strategies/FilterRuntimeStrategy'
import { PageRuntimeStrategy } from '@/model/services/runtime/strategies/PageRuntimeStrategy'
import { ProjectRuntimeStrategy } from '@/model/services/runtime/strategies/ProjectRuntimeStrategy'
import { QueryRuntimeStrategy } from '@/model/services/runtime/strategies/QueryRuntimeStrategy'
import { StoreRuntimeStrategy } from '@/model/services/runtime/strategies/StoreRuntimeStrategy'
import { StreamRuntimeStrategy } from '@/model/services/runtime/strategies/StreamRuntimeStrategy'

function descriptorCapabilityValues(key: 'source' | 'program' | 'runtime'): string[] {
  return [...new Set(Object.values(DOMAIN_DOCUMENT_DESCRIPTORS)
    .map(descriptor => descriptor.capabilities[key])
    .filter(value => value != null))]
    .sort()
}

describe('domain document capability contracts', () => {
  /** Сверяет descriptor Source capabilities с реальным language strategy registry. */
  it('matches registered Source language strategies', () => {
    const registered = new EndgeSource()
      .listLanguageStrategies()
      .map(strategy => strategy.sourceKind)
      .sort()

    expect(descriptorCapabilityValues('source').filter(value => value !== 'component-sfc'))
      .toEqual(registered)
  })

  /** Сверяет descriptor Program capabilities с реальными compiler handlers. */
  it('matches registered compiler handlers', () => {
    expect(descriptorCapabilityValues('program'))
      .toEqual(new EndgeCompiler().listSupportedEntityTypes().sort())
  })

  /** Сверяет descriptor Runtime capabilities с реальными built-in strategies. */
  it('matches built-in runtime strategies', () => {
    const strategies = [
      new ActionRuntimeStrategy(),
      new ComponentSFCRuntimeStrategy(),
      new CompositionRuntimeStrategy(),
      new FilterRuntimeStrategy(),
      new PageRuntimeStrategy(),
      new ProjectRuntimeStrategy(),
      new QueryRuntimeStrategy(),
      new StoreRuntimeStrategy(),
      new StreamRuntimeStrategy(async () => ({
        profileIdentity: null,
        headers: {},
        expiresAt: null,
      })),
    ]

    expect(descriptorCapabilityValues('runtime'))
      .toEqual(strategies.map(strategy => strategy.entityType).sort())
  })
})
