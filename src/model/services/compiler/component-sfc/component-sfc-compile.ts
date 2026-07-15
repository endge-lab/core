import type {
  RComponentContract,
  RComponentDependencies,
  RComponentDiagnostic,
} from '@/domain/types/component/component-core.types'
import {
  createEmptyComponentContract,
  createEmptyComponentDependencies,
} from '@/domain/types/component/component-core.types'
import type {
  ComponentSFCPreviewOptions,
  ComponentSFCPreviewProps,
} from '@/domain/types/program/program.types'
import type {
  RComponentSFCSource_Parts,
  RComponentSFC_AST,
  RComponentSFC_IR,
  RComponentSFC_RuntimeDependencies,
  ComponentSFCPortProviderDescriptor,
} from '@/domain/types/component/sfc'
import type { ProgramMetadata } from '@/domain/types/program/program-metadata.types'
import { parseComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-parse'
import { analyzeComponentSFCScript } from '@/model/services/compiler/component-sfc/component-sfc-script'
import { analyzeComponentSFCRuntimeDependencies } from '@/model/services/compiler/component-sfc/component-sfc-dependencies'
import { compileComponentSFCStyle } from '@/model/services/compiler/component-sfc/component-sfc-style'
import { compileComponentSFCTemplate } from '@/model/services/compiler/component-sfc/component-sfc-template'
import { createEmptyComponentSFCRuntimeDependencies } from '@/domain/types/component/sfc'
import { createEmptyProgramMetadata } from '@/domain/types/program/program-metadata.types'
import { analyzeComponentSFCPorts } from '@/model/services/compiler/component-sfc/component-sfc-ports'

/** Результат полного SFC compiler pipeline в core. */
export interface ComponentSFCCompileResult {
  /** Разложенный canonical source. */
  sourceParts: RComponentSFCSource_Parts

  /** Parser-level AST. */
  ast: RComponentSFC_AST | null

  /** Target-neutral semantic IR. */
  ir: RComponentSFC_IR | null

  /** Внешний контракт компонента. */
  contract: RComponentContract

  /** Зависимости компонента. */
  dependencies: RComponentDependencies

  /** Runtime-зависимости SFC v1, извлеченные из IR reads. */
  runtimeDependencies: RComponentSFC_RuntimeDependencies

  /** Preview-only props для песочницы и debug UI. Не меняют contract. */
  previewProps: ComponentSFCPreviewProps | null

  /** Preview-only runtime options для песочницы компонента. */
  previewOptions: ComponentSFCPreviewOptions | null

  /** Все diagnostics pipeline. */
  diagnostics: RComponentDiagnostic[]

  /** Публичная metadata компонента и его template-узлов. */
  metadata: ProgramMetadata
}

/** Внешний registry-контекст, который связывает чистый SFC compiler с domain build. */
export interface ComponentSFCCompileOptions {
  /** Разрешает прямой пользовательский tag в identity компонента. */
  resolveComponentTag?: (tag: string) => string | null

  /** Проверяет существование статической identity из Component is. */
  hasComponentIdentity?: (identity: string) => boolean

  /** Resolves and describes a default port provider for build-time validation. */
  resolvePortProvider?: (
    identity: string,
    expectedKind: 'computation' | 'component',
  ) => ComponentSFCPortProviderDescriptor | null
}

/** Компилирует Endge SFC source до target-neutral artifact для Endge.program. */
export function compileComponentSFC(
  source: string,
  options: ComponentSFCCompileOptions = {},
): ComponentSFCCompileResult {
  const parseResult = parseComponentSFC(source)
  const diagnostics = [...parseResult.diagnostics]

  if (!parseResult.ast) {
    return {
      sourceParts: parseResult.sourceParts,
      ast: null,
      ir: null,
      contract: createEmptyComponentContract(),
      dependencies: createEmptyComponentDependencies(),
      runtimeDependencies: createEmptyComponentSFCRuntimeDependencies(),
      previewProps: null,
      previewOptions: null,
      metadata: createEmptyProgramMetadata(),
      diagnostics,
    }
  }

  const scriptResult = analyzeComponentSFCScript(parseResult.ast.script)
  const portResult = analyzeComponentSFCPorts(
    parseResult.ast.script,
    createEmptyComponentDependencies(),
    { resolveProvider: options.resolvePortProvider },
  )
  const templateLocals = scriptResult.locals
    .filter(local => local.name !== portResult.bindingName)
  const templateResult = compileComponentSFCTemplate(parseResult.ast.template, {
    props: scriptResult.props.map(prop => prop.name),
    locals: templateLocals.map(local => local.name),
    componentPorts: portResult.manifest.components,
    resolveComponentTag: options.resolveComponentTag,
    hasComponentIdentity: options.hasComponentIdentity,
  })
  const styleResult = compileComponentSFCStyle(parseResult.ast.style)

  diagnostics.push(
    ...scriptResult.diagnostics,
    ...portResult.diagnostics,
    ...templateResult.diagnostics,
    ...styleResult.diagnostics,
  )

  const dependencies = mergeDependencies(
    createEmptyComponentDependencies(),
    portResult.dependencies,
    templateResult.dependencies,
  )

  const ir: RComponentSFC_IR | null = templateResult.template
    ? {
        version: 1,
        script: {
          props: scriptResult.props,
          locals: templateLocals,
          ports: portResult.manifest,
          portCalls: portResult.calls,
        },
        template: templateResult.template,
        style: styleResult.style,
      }
    : null

  return {
    sourceParts: parseResult.sourceParts,
    ast: parseResult.ast,
    ir,
    contract: scriptResult.contract,
    dependencies,
    runtimeDependencies: analyzeComponentSFCRuntimeDependencies(ir),
    previewProps: scriptResult.previewProps,
    previewOptions: scriptResult.previewOptions,
    metadata: {
      self: scriptResult.metadata,
      nodes: templateResult.metadata,
    },
    diagnostics,
  }
}

function mergeDependencies(
  base: RComponentDependencies,
  ...items: RComponentDependencies[]
): RComponentDependencies {
  for (const item of items) {
    base.components.push(...item.components)
    base.computations.push(...item.computations)
    base.actions.push(...item.actions)
    base.dataSources.push(...item.dataSources)
    base.renderers.push(...item.renderers)
  }

  return base
}
