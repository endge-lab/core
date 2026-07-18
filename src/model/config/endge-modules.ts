import type { EndgeModuleDefinition } from '@/domain/types/kernel/endge-modules.types'

import { EndgeAuth } from '@/model/endge/security/endge-auth'
import { EndgeBind } from '@/model/endge/runtime/core/endge-bind'
import { EndgeCompiler } from '@/model/endge/program/endge-compiler'
import { EndgeConsole } from '@/model/endge/diagnostics/endge-console'
import { EndgeContext } from '@/model/endge/context/endge-context'
import { EndgeConfigurationModule } from '@/model/endge/context/endge-configuration'
import { EndgeDiagnostics } from '@/model/endge/diagnostics/endge-diagnostics'
import { EndgeDomain } from '@/model/endge/domain/endge-domain'
import { EndgeEvents } from '@/model/endge/kernel/endge-events'
import { EndgeI18n } from '@/model/endge/context/endge-i18n'
import { EndgeMock } from '@/model/endge/mock/EndgeMock'
import { EndgeProgram } from '@/model/endge/program/endge-program'
import { EndgeRuntime } from '@/model/endge/runtime/core/endge-runtime'
import { EndgeRuntimeDebugger } from '@/model/endge/diagnostics/endge-runtime-debugger'
import { EndgeSchemaStorage } from '@/model/endge/schema/endge-schema-database'
import { EndgeSource } from '@/model/endge/program/endge-source'
import { EndgeSSE } from '@/model/endge/runtime/input/endge-sse'
import { EndgeStyles } from '@/model/endge/ui/endge-styles'
import { EndgeUI } from '@/model/endge/ui/endge-ui'
import { EndgeUIRegistry } from '@/model/endge/ui/endge-ui-registry'
import { EndgeUpdates } from '@/model/endge/runtime/core/endge-updates'
import { EndgeVocabs } from '@/model/endge/domain/endge-vocabs'
import { EndgeWorkspace } from '@/model/endge/context/endge-workspace'

export const ENDGE_CORE_MODULES: EndgeModuleDefinition[] = [
  { key: 'context', module: EndgeContext },
  { key: 'mock', module: EndgeMock, after: 'context' },
  { key: 'schema', module: EndgeSchemaStorage, after: 'context' },
  { key: 'workspace', module: EndgeWorkspace, after: ['context', 'schema'] },
  { key: 'domain', module: EndgeDomain, after: 'schema' },
  { key: 'configuration', module: EndgeConfigurationModule, after: ['workspace', 'domain', 'context'] },
  { key: 'diagnostics', module: EndgeDiagnostics, after: 'configuration' },
  { key: 'source', module: EndgeSource, after: 'domain' },
  { key: 'program', module: EndgeProgram, after: 'domain' },
  { key: 'compiler', module: EndgeCompiler, after: ['domain', 'configuration', 'diagnostics', 'source', 'program', 'mock'] },
  { key: 'auth', module: EndgeAuth, after: ['configuration', 'domain'] },
  { key: 'vocabs', module: EndgeVocabs, after: ['domain', 'auth'] },
  { key: 'i18n', module: EndgeI18n, after: ['domain', 'configuration'] },
  { key: 'events', module: EndgeEvents, after: 'context' },
  { key: 'runtime', module: EndgeRuntime, after: ['compiler', 'workspace', 'context'] },
  { key: 'updates', module: EndgeUpdates, after: 'runtime' },
  { key: 'sse', module: EndgeSSE, after: ['configuration', 'auth', 'events'] },
  { key: 'ui', module: EndgeUI, after: ['configuration', 'context'] },
  { key: 'uiRegistry', module: EndgeUIRegistry, after: 'ui' },
  { key: 'bind', module: EndgeBind, after: ['compiler', 'runtime'] },
  { key: 'console', module: EndgeConsole, after: ['domain', 'runtime'] },
  { key: 'runtimeDebugger', module: EndgeRuntimeDebugger, after: ['diagnostics', 'runtime'] },
  { key: 'styles', module: EndgeStyles, after: ['ui', 'domain', 'program', 'compiler'] },
]
