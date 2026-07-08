import type {
  RComponentContract,
  RComponentDependencies,
  RComponentDiagnostic,
} from '@/domain/types/component-core.types'
import {
  createEmptyComponentContract,
  createEmptyComponentDependencies,
} from '@/domain/types/component-core.types'
import type {
  ComponentSFCPreviewOptions,
  ComponentSFCPreviewProps,
} from '@/domain/types/program.types'
import type {
  RComponentSFCSource_Parts,
  RComponentSFC_AST,
  RComponentSFC_IR,
  RComponentSFC_RuntimeDependencies,
} from '@/domain/types/component-sfc.types'
import { parseComponentSFC } from '@/domain/services/compiler/component-sfc-parse'
import { analyzeComponentSFCScript } from '@/domain/services/compiler/component-sfc-script'
import { analyzeComponentSFCRuntimeDependencies } from '@/domain/services/compiler/component-sfc-dependencies'
import { compileComponentSFCStyle } from '@/domain/services/compiler/component-sfc-style'
import { compileComponentSFCTemplate } from '@/domain/services/compiler/component-sfc-template'
import { createEmptyComponentSFCRuntimeDependencies } from '@/domain/types/component-sfc.types'

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
}

/** Компилирует Endge SFC source до target-neutral artifact для Endge.program. */
export function compileComponentSFC(source: string): ComponentSFCCompileResult {
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
      diagnostics,
    }
  }

  const scriptResult = analyzeComponentSFCScript(parseResult.ast.script)
  const templateResult = compileComponentSFCTemplate(parseResult.ast.template, {
    props: scriptResult.props.map(prop => prop.name),
    locals: scriptResult.locals.map(local => local.name),
  })
  const styleResult = compileComponentSFCStyle(parseResult.ast.style)

  diagnostics.push(
    ...scriptResult.diagnostics,
    ...templateResult.diagnostics,
    ...styleResult.diagnostics,
  )

  const dependencies = mergeDependencies(
    createEmptyComponentDependencies(),
    templateResult.dependencies,
  )

  const ir: RComponentSFC_IR | null = templateResult.template
    ? {
        version: 1,
        script: {
          props: scriptResult.props,
          locals: scriptResult.locals,
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
    diagnostics,
  }
}

function mergeDependencies(
  base: RComponentDependencies,
  ...items: RComponentDependencies[]
): RComponentDependencies {
  for (const item of items) {
    base.components.push(...item.components)
    base.actions.push(...item.actions)
    base.dataSources.push(...item.dataSources)
    base.renderers.push(...item.renderers)
  }

  return base
}
