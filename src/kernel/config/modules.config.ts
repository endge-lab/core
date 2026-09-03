import type { EndgeModuleDefinition } from '@/kernel/types/endge-modules.types'
import { EndgeAuth_Module } from '@/modules/auth/EndgeAuth_Module'
import { EndgeCompiler_Module } from '@/modules/compiler/EndgeCompiler_Module'
import { EndgeConfiguration_Module } from '@/modules/configuration/EndgeConfiguration_Module'
import { EndgeConfigurationSchema_Module } from '@/modules/configuration/EndgeConfigurationSchema_Module'
import { EndgeContext_Module } from '@/modules/context/EndgeContext_Module'
import { EndgeDiagnostics_Module } from '@/modules/diagnostics/EndgeDiagnostics_Module'
import { EndgeDocumentImport_Module } from '@/modules/document-import/EndgeDocumentImport_Module'
import { EndgeDomainRepository_Module } from '@/modules/domain-repository/EndgeDomainRepository_Module'
import { EndgeDomain_Module } from '@/modules/domain/EndgeDomain_Module'
import { EndgeRuntimeDebugger_Module } from '@/modules/EndgeRuntimeDebugger_Module'
import { EndgeTypes_Module } from '@/modules/EndgeTypes_Module'
import { EndgeVocabs_Module } from '@/modules/EndgeVocabs_Module'
import { EndgeEvents_Module } from '@/modules/events/EndgeEvents_Module'
import { EndgeI18n_Module } from '@/modules/i18n/EndgeI18n_Module'
import { EndgeMock_Module } from '@/modules/mock/EndgeMock_Module'
import { EndgeProgram_Module } from '@/modules/program/EndgeProgram_Module'
import { EndgeRuntime_Module } from '@/modules/runtime/EndgeRuntime_Module'
import { EndgeSource_Module } from '@/modules/source/EndgeSource_Module'
import { EndgeStyles_Module } from '@/modules/styles/EndgeStyles_Module'
import { EndgeUI_Module } from '@/modules/ui/EndgeUI_Module'
import { EndgeUIRegistry_Module } from '@/modules/ui/EndgeUIRegistry_Module'
import { EndgeUpdates_Module } from '@/modules/updates/EndgeUpdates_Module'
import { EndgeWorkspace_Module } from '@/modules/workspace/EndgeWorkspace_Module'

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
  { key: 'documentImport', module: EndgeDocumentImport_Module, after: ['domain', 'domainRepository', 'source', 'types'] },
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
