import type { EndgeModuleDefinition } from '@/features/federation/types/endge-modules.types'
import { EndgeActions_Module } from '@/features/core/modules/actions/EndgeActions_Module'
import { EndgeAuth_Module } from '@/features/core/modules/auth/EndgeAuth_Module'
import { EndgeCompiler_Module } from '@/features/core/modules/compiler/EndgeCompiler_Module'
import { EndgeComputations_Module } from '@/features/core/modules/computations/EndgeComputations_Module'
import { EndgeConfiguration_Module } from '@/features/core/modules/configuration/EndgeConfiguration_Module'
import { EndgeConfigurationSchema_Module } from '@/features/core/modules/configuration/EndgeConfigurationSchema_Module'
import { EndgeContext_Module } from '@/features/core/modules/context/EndgeContext_Module'
import { EndgeConverters_Module } from '@/features/core/modules/converters/EndgeConverters_Module'
import { EndgeDiagnostics_Module } from '@/features/core/modules/diagnostics/EndgeDiagnostics_Module'
import { EndgeDocumentImport_Module } from '@/features/core/modules/document-import/EndgeDocumentImport_Module'
import { EndgeDomainRepository_Module } from '@/features/core/modules/domain-repository/EndgeDomainRepository_Module'
import { EndgeDomain_Module } from '@/features/core/modules/domain/EndgeDomain_Module'
import { EndgeRuntimeDebugger_Module } from '@/features/core/modules/EndgeRuntimeDebugger_Module'
import { EndgeTypes_Module } from '@/features/core/modules/EndgeTypes_Module'
import { EndgeVocabs_Module } from '@/features/core/modules/EndgeVocabs_Module'
import { EndgeEvents_Module } from '@/features/core/modules/events/EndgeEvents_Module'
import { EndgeI18n_Module } from '@/features/core/modules/i18n/EndgeI18n_Module'
import { EndgeImplementations_Module } from '@/features/core/modules/implementations/EndgeImplementations_Module'
import { EndgeMock_Module } from '@/features/core/modules/mock/EndgeMock_Module'
import { EndgeProgram_Module } from '@/features/core/modules/program/EndgeProgram_Module'
import { EndgeRuntime_Module } from '@/features/core/modules/runtime/EndgeRuntime_Module'
import { EndgeSource_Module } from '@/features/core/modules/source/EndgeSource_Module'
import { EndgeStyles_Module } from '@/features/core/modules/styles/EndgeStyles_Module'
import { EndgeUI_Module } from '@/features/core/modules/ui/EndgeUI_Module'
import { EndgeUIRegistry_Module } from '@/features/core/modules/ui/EndgeUIRegistry_Module'
import { EndgeUpdates_Module } from '@/features/core/modules/updates/EndgeUpdates_Module'
import { EndgeWorkspace_Module } from '@/features/core/modules/workspace/EndgeWorkspace_Module'

/** Декларативный граф загрузки модулей Endge Core. */
export const ENDGE_CORE_MODULES = [
  { key: 'context', create: () => new EndgeContext_Module() },
  { key: 'mock', create: () => new EndgeMock_Module(), after: 'context' },
  { key: 'domainRepository', create: () => new EndgeDomainRepository_Module(), after: 'context' },
  { key: 'workspace', create: () => new EndgeWorkspace_Module(), after: ['context', 'domainRepository'] },
  { key: 'domain', create: () => new EndgeDomain_Module(), after: 'domainRepository' },
  { key: 'types', create: () => new EndgeTypes_Module(), after: 'domain' },
  { key: 'configurationSchema', create: () => new EndgeConfigurationSchema_Module(), after: ['workspace', 'domain', 'types', 'source'] },
  { key: 'configuration', create: () => new EndgeConfiguration_Module(), after: ['workspace', 'domain', 'context', 'configurationSchema'] },
  { key: 'diagnostics', create: () => new EndgeDiagnostics_Module(), after: 'configuration' },
  { key: 'source', create: () => new EndgeSource_Module(), after: 'domain' },
  { key: 'documentImport', create: () => new EndgeDocumentImport_Module(), after: ['domain', 'domainRepository', 'source', 'types'] },
  { key: 'program', create: () => new EndgeProgram_Module(), after: 'domain' },
  { key: 'implementations', create: () => new EndgeImplementations_Module(), after: 'context' },
  {
    key: 'actions',
    create: ({ getModule }) => new EndgeActions_Module(getModule<EndgeImplementations_Module>('implementations')),
    after: ['domain', 'implementations'],
  },
  {
    key: 'computations',
    create: ({ getModule }) => new EndgeComputations_Module(getModule<EndgeImplementations_Module>('implementations')),
    after: ['domain', 'program', 'implementations'],
  },
  {
    key: 'converters',
    create: ({ getModule }) => new EndgeConverters_Module(getModule<EndgeImplementations_Module>('implementations')),
    after: ['domain', 'implementations'],
  },
  {
    key: 'compiler',
    create: () => new EndgeCompiler_Module(),
    after: ['domain', 'types', 'configuration', 'diagnostics', 'source', 'program', 'mock', 'actions', 'computations', 'converters'],
  },
  { key: 'auth', create: () => new EndgeAuth_Module(), after: ['configuration', 'domain'] },
  { key: 'vocabs', create: () => new EndgeVocabs_Module(), after: ['domain', 'auth'] },
  { key: 'i18n', create: () => new EndgeI18n_Module(), after: ['domain', 'configuration'] },
  { key: 'events', create: () => new EndgeEvents_Module(), after: 'context' },
  { key: 'runtime', create: () => new EndgeRuntime_Module(), after: ['compiler', 'workspace', 'context'] },
  { key: 'updates', create: () => new EndgeUpdates_Module(), after: 'runtime' },
  { key: 'ui', create: () => new EndgeUI_Module(), after: ['configuration', 'context'] },
  { key: 'uiRegistry', create: () => new EndgeUIRegistry_Module(), after: 'ui' },
  { key: 'runtimeDebugger', create: () => new EndgeRuntimeDebugger_Module(), after: ['diagnostics', 'runtime'] },
  { key: 'styles', create: () => new EndgeStyles_Module(), after: ['ui', 'domain', 'program', 'compiler'] },
] as const satisfies readonly EndgeModuleDefinition[]
