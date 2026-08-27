import type {
  RComponentContract,
  RComponentDependencies,
  RComponentDiagnostic,
} from '@/domain/types/component/component-core.types'
import type { RComponentSFC_AST } from '@/domain/types/component/sfc/ast.types'
import type { RComponentSFC_RuntimeDependencies } from '@/domain/types/component/sfc/dependencies.types'
import type { RComponentSFC_IR, RComponentSFC_IR_Node, RComponentSFC_IR_Template } from '@/domain/types/component/sfc/ir.types'
import type {
  ComponentSFCActionPort,
  ComponentSFCPortManifest,
  ComponentSFCPortProviderDescriptor,
} from '@/domain/types/component/sfc/ports.types'
import type { RComponentSFCSource_Parts } from '@/domain/types/component/sfc/source.types'
import type { EndgeSFCEditingConfiguration } from '@/domain/types/configuration/configuration.type'
import type { ProgramMetadata } from '@/domain/types/program/program-metadata.types'
import type {
  ComponentSFCPreviewOptions,
  ComponentSFCPreviewProps,
} from '@/domain/types/program/program.types'
import type { TypeSourceDefinition } from '@/domain/types/source/type-source.types'
import {
  createEmptyComponentContract,
  createEmptyComponentDependencies,
} from '@/domain/types/component/component-core.types'
import { createEmptyComponentSFCRuntimeDependencies } from '@/domain/types/component/sfc/dependencies.types'
import { createEmptyProgramMetadata } from '@/domain/types/program/program-metadata.types'
import { validateComponentSFCAttributeValues } from '@/model/services/compiler/component-sfc/component-sfc-attributes'
import { analyzeComponentSFCRuntimeDependencies } from '@/model/services/compiler/component-sfc/component-sfc-dependencies'
import { resolveComponentSFCPortForwards } from '@/model/services/compiler/component-sfc/component-sfc-forward'
import { parseComponentSFC } from '@/model/services/compiler/component-sfc/component-sfc-parse'
import { analyzeComponentSFCPorts } from '@/model/services/compiler/component-sfc/component-sfc-ports'
import { analyzeComponentSFCScript } from '@/model/services/compiler/component-sfc/component-sfc-script'
import { compileComponentSFCStyle } from '@/model/services/compiler/component-sfc/component-sfc-style'
import {
  normalizeComponentSFCColumnCellMenu,
  normalizeComponentSFCTableCellMenu,
  normalizeComponentSFCTableColumnMenu,
} from '@/model/services/compiler/component-sfc/component-sfc-table-menu'
import { compileComponentSFCTemplate } from '@/model/services/compiler/component-sfc/component-sfc-template'

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

  /** Per-section status; style errors do not invalidate template rendering. */
  sections: Record<'script' | 'template' | 'style', 'valid' | 'warning' | 'error'>
}

/** Внешний registry-контекст, который связывает чистый SFC compiler с domain build. */
export interface ComponentSFCCompileOptions {
  /** Stable persisted identity used for the component style scope id. */
  identity?: string
  /** Разрешает прямой пользовательский tag в identity компонента. */
  resolveComponentTag?: (tag: string) => string | null

  /** Проверяет существование статической identity из Component is. */
  hasComponentIdentity?: (identity: string) => boolean

  /** Resolves and describes a default port provider for build-time validation. */
  resolvePortProvider?: (
    identity: string,
    expectedKind: 'computation' | 'component' | 'action' | 'query',
  ) => ComponentSFCPortProviderDescriptor | null

  /** Resolves the compiled public port manifest of a nested SFC component. */
  resolveComponentPortManifest?: (identity: string) => ComponentSFCPortManifest | null

  /** Resolves explicit root variants of one nested custom component. */
  resolveComponentVariants?: (identity: string) => string[] | null

  /** Resolves an external Type Registry definition used by a named SFC contract. */
  resolveTypeDefinition?: (identity: string) => TypeSourceDefinition | null

  /** Effective edit-session defaults из immutable build context. */
  sfcEditing?: EndgeSFCEditingConfiguration
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
      sections: sectionStatuses(diagnostics),
    }
  }

  const scriptResult = analyzeComponentSFCScript(parseResult.ast.script, {
    resolveTypeDefinition: options.resolveTypeDefinition,
  })
  diagnostics.push(...validateComponentSFCAttributeValues(source, parseResult.ast))
  const portResult = analyzeComponentSFCPorts(
    parseResult.ast.script,
    createEmptyComponentDependencies(),
    {
      resolveProvider: options.resolvePortProvider,
      resolveTypeDefinition: options.resolveTypeDefinition,
    },
  )
  const templateLocals = scriptResult.locals
    .filter(local => local.name !== portResult.bindingName)
  const templateResult = compileComponentSFCTemplate(parseResult.ast.template, {
    props: scriptResult.props.map(prop => prop.name),
    locals: templateLocals.map(local => local.name),
    componentPorts: portResult.manifest.require.components,
    ownerPorts: portResult.manifest,
    resolveComponentTag: options.resolveComponentTag,
    hasComponentIdentity: options.hasComponentIdentity,
    resolveComponentPortManifest: options.resolveComponentPortManifest,
    resolvePortProvider: options.resolvePortProvider,
    resolveComponentVariants: options.resolveComponentVariants,
    sfcEditing: options.sfcEditing,
  })
  for (const eventName of templateResult.emittedEvents) {
    if (portResult.manifest.emits.events.some(event => event.name === eventName)) {
      continue
    }
    if (eventName === 'edited') {
      portResult.manifest.emits.events.push({
        kind: 'event',
        role: 'emits',
        name: 'edited',
        payloadType: 'unknown',
      })
      continue
    }
    templateResult.diagnostics.push({
      severity: 'error',
      code: 'sfc-template-emit-port-missing',
      message: `Event "${eventName}" должен быть объявлен в definePorts.emits.`,
      sourcePath: `template.emit.${eventName}`,
    })
  }
  const forwardResult = resolveComponentSFCPortForwards(
    portResult.manifest,
    templateResult.template,
    { resolveComponentPortManifest: options.resolveComponentPortManifest },
  )
  const availableMenuActions = [
    ...portResult.manifest.require.actions,
    ...portResult.manifest.provides.actions,
  ]
  const menuResult = collectTableMenus(templateResult.template, availableMenuActions)
  const styleResult = compileComponentSFCStyle(parseResult.ast.style, { identity: options.identity })

  const propNames = new Set(scriptResult.props.map(prop => prop.name))
  for (const binding of [...scriptResult.props, ...scriptResult.locals]) {
    if (!binding.name.startsWith('$')) {
      continue
    }
    diagnostics.push({
      severity: 'error',
      code: 'sfc-platform-binding-name-reserved',
      message: `Имя "${binding.name}" зарезервировано для runtime-контекста платформы. Пользовательские props и bindings не должны начинаться с $.`,
      sourcePath: `script.binding.${binding.name}`,
      start: binding.sourceRange?.start,
      end: binding.sourceRange?.end,
    })
  }
  for (const port of allComponentSFCPorts(portResult.manifest)) {
    if (port.name.startsWith('$')) {
      diagnostics.push({
        severity: 'error',
        code: 'sfc-platform-port-name-reserved',
        message: `Имя port "${port.name}" зарезервировано для runtime-контекста платформы.`,
        sourcePath: `script.ports.${'role' in port ? port.role : 'require'}.${port.name}`,
        start: port.sourceRange?.start,
        end: port.sourceRange?.end,
      })
    }
    if (!propNames.has(port.name)) {
      continue
    }
    diagnostics.push({
      severity: 'error',
      code: 'sfc-prop-port-name-conflict',
      message: `Имя "${port.name}" объявлено одновременно как prop и port. Public props и ports должны иметь уникальные имена.`,
      sourcePath: `script.ports.${'role' in port ? port.role : 'require'}.${port.name}`,
      start: port.sourceRange?.start,
      end: port.sourceRange?.end,
    })
  }

  diagnostics.push(
    ...scriptResult.diagnostics,
    ...portResult.diagnostics,
    ...templateResult.diagnostics,
    ...forwardResult.diagnostics,
    ...menuResult.diagnostics,
    ...styleResult.diagnostics,
  )

  const dependencies = mergeDependencies(
    createEmptyComponentDependencies(),
    portResult.dependencies,
    forwardResult.dependencies,
    templateResult.dependencies,
    {
      ...createEmptyComponentDependencies(),
      actions: menuResult.actions,
    },
  )
  dependencies.actions = [...new Set(dependencies.actions)]

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
    contract: {
      ...scriptResult.contract,
      events: [
        ...scriptResult.contract.events,
        ...portResult.manifest.emits.events.map(event => ({
          name: event.name,
          payloadType: event.payloadType === 'void' ? undefined : event.payloadType,
        })),
      ],
    },
    dependencies,
    runtimeDependencies: analyzeComponentSFCRuntimeDependencies(ir),
    previewProps: scriptResult.previewProps,
    previewOptions: scriptResult.previewOptions,
    metadata: {
      self: scriptResult.metadata,
      nodes: templateResult.metadata,
    },
    diagnostics,
    sections: sectionStatuses(diagnostics),
  }
}

function allComponentSFCPorts(manifest: ComponentSFCPortManifest) {
  return [
    ...manifest.require.computations,
    ...manifest.require.components,
    ...manifest.require.actions,
    ...manifest.require.queries,
    ...manifest.provides.actions,
    ...manifest.emits.events,
  ]
}

function collectTableMenus(
  template: RComponentSFC_IR_Template | null,
  availableActions: ComponentSFCActionPort[],
): { diagnostics: RComponentDiagnostic[], actions: string[] } {
  const diagnostics: RComponentDiagnostic[] = []
  const actions = new Set<string>()
  const visit = (node: RComponentSFC_IR_Node): void => {
    if (node.kind !== 'element') {
      return
    }
    if (node.tag === 'Table') {
      const column = normalizeComponentSFCTableColumnMenu(node, { availableActions })
      const row = normalizeComponentSFCTableCellMenu(node, { availableActions })
      node.tableMenus = { column, row }
      diagnostics.push(...column.diagnostics, ...row.diagnostics)
      for (const menu of [column.menu, row.menu]) {
        for (const item of menu?.items ?? []) {
          if (item.kind === 'item') {
            actions.add(item.action)
          }
        }
      }
      for (const columnNode of node.children) {
        if (columnNode.kind !== 'element' || columnNode.tag !== 'Column') {
          continue
        }
        const cellMenu = normalizeComponentSFCColumnCellMenu(node, columnNode, { availableActions })
        if (!cellMenu) {
          continue
        }
        columnNode.cellMenu = cellMenu
        diagnostics.push(...cellMenu.diagnostics)
        for (const item of cellMenu.menu?.items ?? []) {
          if (item.kind === 'item') {
            actions.add(item.action)
          }
        }
      }
    }
    for (const child of node.children) {
      visit(child)
    }
  }
  for (const root of template?.roots ?? []) {
    visit(root)
  }
  return { diagnostics, actions: [...actions] }
}

function sectionStatuses(diagnostics: RComponentDiagnostic[]): Record<'script' | 'template' | 'style', 'valid' | 'warning' | 'error'> {
  const sections = { script: 'valid', template: 'valid', style: 'valid' } as Record<'script' | 'template' | 'style', 'valid' | 'warning' | 'error'>
  for (const diagnostic of diagnostics) {
    const section = diagnostic.sourcePath?.split('.')[0]
    if (section !== 'script' && section !== 'template' && section !== 'style') {
      continue
    }
    if (diagnostic.severity === 'error') {
      sections[section] = 'error'
    }
    else if (diagnostic.severity === 'warning' && sections[section] === 'valid') {
      sections[section] = 'warning'
    }
  }
  return sections
}

function mergeDependencies(
  base: RComponentDependencies,
  ...items: RComponentDependencies[]
): RComponentDependencies {
  for (const item of items) {
    base.components.push(...item.components)
    base.computations.push(...item.computations)
    base.actions.push(...item.actions)
    base.queries.push(...item.queries)
    base.dataSources.push(...item.dataSources)
    base.renderers.push(...item.renderers)
  }

  return base
}
