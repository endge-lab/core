import { describe, expect, it } from 'vitest'

import { EndgeCompiler_Module } from '@/modules/compiler/EndgeCompiler_Module'
import { DOMAIN_DOCUMENT_DESCRIPTORS } from '@/modules/domain/documents/domain-document-descriptors'
import { ActionRuntimeStrategy } from '@/modules/runtime/services/strategies/ActionRuntimeStrategy'
import { ComponentSFCRuntimeStrategy } from '@/modules/runtime/services/strategies/ComponentSFCRuntimeStrategy'
import { CompositionRuntimeStrategy } from '@/modules/runtime/services/strategies/CompositionRuntimeStrategy'
import { FilterRuntimeStrategy } from '@/modules/runtime/services/strategies/FilterRuntimeStrategy'
import { PageRuntimeStrategy } from '@/modules/runtime/services/strategies/PageRuntimeStrategy'
import { ProjectRuntimeStrategy } from '@/modules/runtime/services/strategies/ProjectRuntimeStrategy'
import { QueryRuntimeStrategy } from '@/modules/runtime/services/strategies/QueryRuntimeStrategy'
import { StoreRuntimeStrategy } from '@/modules/runtime/services/strategies/StoreRuntimeStrategy'
import { StreamRuntimeStrategy } from '@/modules/runtime/services/strategies/StreamRuntimeStrategy'
import { EndgeSource_Module } from '@/modules/source/EndgeSource_Module'

function descriptorCapabilityValues(key: 'source' | 'program' | 'runtime'): string[] {
  return [...new Set(Object.values(DOMAIN_DOCUMENT_DESCRIPTORS)
    .map(descriptor => descriptor.capabilities[key])
    .filter(value => value != null))]
    .sort()
}

describe('контракты возможностей документов домена', () => {
  /** Сверяет descriptor Source capabilities с реальным language strategy registry. */
  it('сопоставляет зарегистрированные стратегии языка Source', () => {
    const registered = new EndgeSource_Module()
      .listLanguageStrategies()
      .map(strategy => strategy.sourceKind)
      .sort()

    expect(descriptorCapabilityValues('source').filter(value => value !== 'component-sfc'))
      .toEqual(registered)
  })

  /** Сверяет descriptor Program capabilities с реальными compiler handlers. */
  it('сопоставляет зарегистрированные handlers компилятора', () => {
    expect(descriptorCapabilityValues('program'))
      .toEqual(new EndgeCompiler_Module().listSupportedEntityTypes().sort())
  })

  /** Сверяет descriptor Runtime capabilities с реальными built-in strategies. */
  it('сопоставляет встроенные runtime-стратегии', () => {
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
