import type { EndgeModuleDefinition } from '@/domain/types/kernel/endge-modules.types'
import { EndgeConfiguration_Module } from '@/model/modules/context/EndgeConfiguration_Module'
import { EndgeConfigurationSchema_Module } from '@/model/modules/context/EndgeConfigurationSchema_Module'
import { EndgeContext_Module } from '@/model/modules/context/EndgeContext_Module'
import { EndgeI18n_Module } from '@/model/modules/context/EndgeI18n_Module'
import { EndgeWorkspace_Module } from '@/model/modules/context/EndgeWorkspace_Module'
import { EndgeDiagnostics_Module } from '@/model/modules/diagnostics/EndgeDiagnostics_Module'
import { EndgeRuntimeDebugger_Module } from '@/model/modules/diagnostics/EndgeRuntimeDebugger_Module'
import { EndgeDomain_Module } from '@/model/modules/domain/EndgeDomain_Module'
import { EndgeDomainRepository_Module } from '@/model/modules/domain/EndgeDomainRepository_Module'
import { EndgeTypes_Module } from '@/model/modules/domain/EndgeTypes_Module'
import { EndgeVocabs_Module } from '@/model/modules/domain/EndgeVocabs_Module'
import { EndgeEvents_Module } from '@/model/modules/events/EndgeEvents_Module'
import { EndgeMock_Module } from '@/model/modules/mock/EndgeMock_Module'
import { EndgeCompiler_Module } from '@/model/modules/program/EndgeCompiler_Module'
import { EndgeProgram_Module } from '@/model/modules/program/EndgeProgram_Module'
import { EndgeSource_Module } from '@/model/modules/program/EndgeSource_Module'
import { EndgeRuntime_Module } from '@/model/modules/runtime/core/EndgeRuntime_Module'
import { EndgeUpdates_Module } from '@/model/modules/runtime/core/EndgeUpdates_Module'
import { EndgeAuth_Module } from '@/model/modules/security/EndgeAuth_Module'
import { EndgeStyles_Module } from '@/model/modules/ui/EndgeStyles_Module'
import { EndgeUI_Module } from '@/model/modules/ui/EndgeUI_Module'
import { EndgeUIRegistry_Module } from '@/model/modules/ui/EndgeUIRegistry_Module'

/** Декларативный граф загрузки модулей Endge Core. */
export const ENDGE_CORE_MODULES: EndgeModuleDefinition[] = [
  { key: 'context', module: EndgeContext_Module },
  { key: 'mock', module: EndgeMock_Module, after: 'context' },
  { key: 'domainRepository', module: EndgeDomainRepository_Module, after: 'context' },
  { key: 'workspace', module: EndgeWorkspace_Module, after: ['context', 'domainRepository'] },
  { key: 'domain', module: EndgeDomain_Module, after: 'domainRepository' },
  { key: 'types', module: EndgeTypes_Module, after: 'domain' },
  { key: 'configurationSchema', module: EndgeConfigurationSchema_Module, after: ['workspace', 'domain', 'types', 'source'] },
  { key: 'configuration', module: EndgeConfiguration_Module, after: ['workspace', 'domain', 'context', 'configurationSchema'] },
  { key: 'diagnostics', module: EndgeDiagnostics_Module, after: 'configuration' },
  { key: 'source', module: EndgeSource_Module, after: 'domain' },
  { key: 'program', module: EndgeProgram_Module, after: 'domain' },
  { key: 'compiler', module: EndgeCompiler_Module, after: ['domain', 'types', 'configuration', 'diagnostics', 'source', 'program', 'mock'] },
  { key: 'auth', module: EndgeAuth_Module, after: ['configuration', 'domain'] },
  { key: 'vocabs', module: EndgeVocabs_Module, after: ['domain', 'auth'] },
  { key: 'i18n', module: EndgeI18n_Module, after: ['domain', 'configuration'] },
  { key: 'events', module: EndgeEvents_Module, after: 'context' },
  { key: 'runtime', module: EndgeRuntime_Module, after: ['compiler', 'workspace', 'context'] },
  { key: 'updates', module: EndgeUpdates_Module, after: 'runtime' },
  { key: 'ui', module: EndgeUI_Module, after: ['configuration', 'context'] },
  { key: 'uiRegistry', module: EndgeUIRegistry_Module, after: 'ui' },
  { key: 'runtimeDebugger', module: EndgeRuntimeDebugger_Module, after: ['diagnostics', 'runtime'] },
  { key: 'styles', module: EndgeStyles_Module, after: ['ui', 'domain', 'program', 'compiler'] },
]
