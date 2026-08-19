import type { EndgeModuleDefinition } from '@/domain/types/kernel/endge-modules.types'
import { EndgeAuth } from '@/model/modules/security/endge-auth'
import { EndgeBind } from '@/model/modules/runtime/core/endge-bind'
import { EndgeCompiler } from '@/model/modules/program/endge-compiler'
import { EndgeContext } from '@/model/modules/context/endge-context'
import { EndgeConfigurationModule } from '@/model/modules/context/endge-configuration'
import { EndgeDiagnostics } from '@/model/modules/diagnostics/endge-diagnostics'
import { EndgeDomain } from '@/model/modules/domain/endge-domain'
import { EndgeDomainRepository } from '@/model/modules/domain/endge-domain-repository'
import { EndgeTypes } from '@/model/modules/domain/endge-types'
import { EndgeEvents } from '@/model/modules/events/endge-events'
import { EndgeI18n } from '@/model/modules/context/endge-i18n'
import { EndgeMock } from '@/model/modules/mock/EndgeMock'
import { EndgeProgram } from '@/model/modules/program/endge-program'
import { EndgeRuntime } from '@/model/modules/runtime/core/endge-runtime'
import { EndgeRuntimeDebugger } from '@/model/modules/diagnostics/endge-runtime-debugger'
import { EndgeSource } from '@/model/modules/program/endge-source'
import { EndgeStyles } from '@/model/modules/ui/endge-styles'
import { EndgeUI } from '@/model/modules/ui/endge-ui'
import { EndgeUIRegistry } from '@/model/modules/ui/endge-ui-registry'
import { EndgeUpdates } from '@/model/modules/runtime/core/endge-updates'
import { EndgeVocabs } from '@/model/modules/domain/endge-vocabs'
import { EndgeWorkspace } from '@/model/modules/context/endge-workspace'


/** Декларативный граф загрузки модулей Endge Core. */
export const ENDGE_CORE_MODULES: EndgeModuleDefinition[] = [
  { key: 'context', module: EndgeContext },
  { key: 'mock', module: EndgeMock, after: 'context' },
  { key: 'domainRepository', module: EndgeDomainRepository, after: 'context' },
  { key: 'workspace', module: EndgeWorkspace, after: ['context', 'domainRepository'] },
  { key: 'domain', module: EndgeDomain, after: 'domainRepository' },
  { key: 'types', module: EndgeTypes, after: 'domain' },
  { key: 'configuration', module: EndgeConfigurationModule, after: ['workspace', 'domain', 'context'] },
  { key: 'diagnostics', module: EndgeDiagnostics, after: 'configuration' },
  { key: 'source', module: EndgeSource, after: 'domain' },
  { key: 'program', module: EndgeProgram, after: 'domain' },
  { key: 'compiler', module: EndgeCompiler, after: ['domain', 'types', 'configuration', 'diagnostics', 'source', 'program', 'mock'] },
  { key: 'auth', module: EndgeAuth, after: ['configuration', 'domain'] },
  { key: 'vocabs', module: EndgeVocabs, after: ['domain', 'auth'] },
  { key: 'i18n', module: EndgeI18n, after: ['domain', 'configuration'] },
  { key: 'events', module: EndgeEvents, after: 'context' },
  { key: 'runtime', module: EndgeRuntime, after: ['compiler', 'workspace', 'context'] },
  { key: 'updates', module: EndgeUpdates, after: 'runtime' },
  { key: 'ui', module: EndgeUI, after: ['configuration', 'context'] },
  { key: 'uiRegistry', module: EndgeUIRegistry, after: 'ui' },
  { key: 'bind', module: EndgeBind, after: ['compiler', 'runtime'] },
  { key: 'runtimeDebugger', module: EndgeRuntimeDebugger, after: ['diagnostics', 'runtime'] },
  { key: 'styles', module: EndgeStyles, after: ['ui', 'domain', 'program', 'compiler'] },
]
