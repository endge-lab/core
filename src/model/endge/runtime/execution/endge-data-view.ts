import type {
  DataViewExpression,
  DataViewRef,
  DataViewPathOperation,
  DataViewRunTools,
} from '@/domain/types/source/data-view-source.types'
import type { DataViewProgramPayload, ProgramArtifact } from '@/domain/types/program/program.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { RDataView } from '@/domain/entities/reflect/RDataView'
import { compileDataViewSource } from '@/model/services/source-engine/data-view-source-compile'
import { Endge } from '@/model/endge/kernel/endge'
import { evaluateSourceExpression } from '@/model/services/source-engine/source-expression-evaluate'

/** Runtime executor для compiled RDataView artifacts. */
export class EndgeDataView extends EndgeModule {
  /** Выполняет DataView по id/identity/model над переданным input object. */
  public run(
    dataViewOrId: RDataView | string | number,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
  ): unknown {
    const dataView = this._resolveDataView(dataViewOrId)
    const artifact = this._resolveArtifact(dataView)
    return this.runPayload(artifact.payload, input, tools, {
      children: artifact.children ?? [],
    })
  }

  /** Выполняет уже скомпилированный DataView artifact без поиска в домене. */
  public runArtifact(
    artifact: ProgramArtifact<DataViewProgramPayload>,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
  ): unknown {
    if (artifact.status === 'error') {
      const message = artifact.diagnostics[0]?.message ?? `DataView artifact has compile errors for "${artifact.ref.identity}".`
      throw new Error(message)
    }

    return this.runPayload(artifact.payload, input, tools, {
      children: artifact.children ?? [],
    })
  }

  /** Выполняет уже скомпилированный DataView payload. */
  public runPayload(
    artifact: DataViewProgramPayload,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
    context: { children?: ProgramArtifact[] } = {},
  ): unknown {
    const runTools = this._createTools(tools)

    if (artifact.mode === 'manual')
      return this._runManual(artifact, input, runTools)

    return this._runPipeline(artifact, input, runTools, context)
  }

  /** Выполняет DataView-ссылку из query/DataView artifact. */
  public runRef(
    ref: DataViewRef,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
    context: { children?: ProgramArtifact[] } = {},
  ): unknown {
    if (ref.kind === 'external')
      return this.run(ref.identity, input, tools)

    if (ref.kind === 'inline')
      return this.runSource(ref.source, input, tools)

    const artifact = this._findLocalDataViewArtifact(ref, context.children ?? [])
    if (!artifact)
      throw new Error(`Local DataView artifact not found: "${ref.ref.identity}".`)

    return this.runArtifact(artifact, input, tools)
  }

  /** Выполняет DataView source без записи artifact в `Endge.program`. */
  public runSource(
    source: string,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
  ): unknown {
    const result = compileDataViewSource(source)
    const error = result.diagnostics.find(diagnostic => diagnostic.severity === 'error')
    if (error)
      throw new Error(error.message)
    if (!result.artifact)
      throw new Error('DataView source не создал artifact.')

    return this.runPayload(result.artifact as DataViewProgramPayload, input, tools)
  }

  /** Возвращает DataView model из домена или входного экземпляра. */
  private _resolveDataView(dataViewOrId: RDataView | string | number): RDataView {
    if (dataViewOrId instanceof RDataView)
      return dataViewOrId

    const dataView = Endge.domain.getDataView(dataViewOrId)
    if (!dataView)
      throw new Error(`DataView not found: "${dataViewOrId}".`)

    return dataView
  }

  /** Возвращает compiled artifact, компилируя DataView локально при необходимости. */
  private _resolveArtifact(dataView: RDataView): ProgramArtifact<DataViewProgramPayload> {
    const artifact = Endge.program.getDataViewArtifact(dataView.id ?? dataView.identity)
      ?? Endge.compiler.buildDataView(dataView)
    if (artifact.status === 'error') {
      const message = artifact.diagnostics[0]?.message ?? `DataView artifact has compile errors for "${dataView.identity}".`
      throw new Error(message)
    }

    return artifact
  }

  /** Выполняет manual transform в controlled wrapper текущего frontend runtime. */
  private _runManual(
    artifact: DataViewProgramPayload,
    input: unknown,
    tools: DataViewRunTools,
  ): unknown {
    const body = artifact.transform?.body ?? ''
    const wrappedBody = `
      "use strict";
      const { convert, pick, path, template } = tools;
      ${body}
    `
    const fn = new Function('input', 'tools', wrappedBody) as (input: unknown, tools: DataViewRunTools) => unknown
    return fn(input, tools)
  }

  /** Интерпретирует декларативные pipeline steps без eval. */
  private _runPipeline(
    artifact: DataViewProgramPayload,
    input: unknown,
    tools: DataViewRunTools,
    context: { children?: ProgramArtifact[] },
  ): unknown {
    let rows: unknown[] = []
    let alias = 'item'
    const joins: Array<{ source: string, left: string, right: string, as: string }> = []

    for (const step of artifact.steps) {
      if (step.type === 'from') {
        let value = tools.path(input, step.source)
        for (const ref of step.dataViews ?? [])
          value = this.runRef(ref, value, tools, context)
        rows = Array.isArray(value) ? value : []
        alias = step.as || 'item'
      }

      if (step.type === 'join') {
        joins.push(step)
      }

      if (step.type === 'map') {
        return rows.map(row => {
          const scope: Record<string, unknown> = {
            input,
            [alias]: row,
          }
          for (const join of joins)
            scope[join.as] = this._resolveJoin(input, scope, join, tools)

          const output = this._createMapOutput(step.spreads ?? [], scope, tools)
          for (const [key, expression] of Object.entries(step.fields))
            output[key] = this._evaluateExpression(expression, scope, tools)

          return output
        })
      }
    }

    return rows
  }

  /** Собирает базовый output для map step из spread-источников. */
  private _createMapOutput(
    spreads: Array<{ source: string }>,
    scope: Record<string, unknown>,
    tools: DataViewRunTools,
  ): Record<string, unknown> {
    const output: Record<string, unknown> = {}
    for (const spread of spreads) {
      const value = tools.path(scope, spread.source)
      if (value && typeof value === 'object' && !Array.isArray(value))
        Object.assign(output, value)
    }
    return output
  }

  /** Вычисляет join-result для текущей строки pipeline. */
  private _resolveJoin(
    input: unknown,
    scope: Record<string, unknown>,
    join: { source: string, left: string, right: string },
    tools: DataViewRunTools,
  ): unknown {
    const leftValue = tools.path(scope, join.left)
    const source = tools.path(input, join.source)
    if (!Array.isArray(source))
      return null

    return source.find(item => tools.path(item, join.right) === leftValue) ?? null
  }

  /** Вычисляет одно поле map-expression. */
  private _evaluateExpression(
    expression: DataViewExpression,
    scope: Record<string, unknown>,
    tools: DataViewRunTools,
  ): unknown {
    if (expression.type === 'literal')
      return expression.value
    if (expression.type === 'template')
      return tools.template(expression.template, scope)

    if (expression.type !== 'path')
      return evaluateSourceExpression(expression, { scope })

    let value = tools.path(scope, expression.path)
    for (const operation of expression.operations)
      value = this._applyPathOperation(value, operation, tools)

    return value
  }

  /** Применяет chain operation к path-expression. */
  private _applyPathOperation(
    value: unknown,
    operation: DataViewPathOperation,
    tools: DataViewRunTools,
  ): unknown {
    if (operation.type === 'pick')
      return tools.pick(value, operation.path)

    if (operation.type === 'convert')
      return tools.convert(operation.converter, value, operation.options)

    if (operation.type === 'find') {
      if (!Array.isArray(value))
        return null
      return value.find(item =>
        Object.entries(operation.criteria).every(([key, expected]) => tools.path(item, key) === expected),
      ) ?? null
    }

    return value
  }

  /** Создает набор runtime tools с возможностью точечной подмены в preview. */
  private _createTools(overrides?: Partial<DataViewRunTools>): DataViewRunTools {
    const tools: DataViewRunTools = {
      convert: (identity, value, options) => this._convert(identity, value, options),
      pick: (value, path) => this._path(value, path),
      path: (scope, path) => this._path(scope, path),
      template: (template, scope = {}) => template.replace(/\{([^{}]+)\}/g, (_, path) => {
        const value = this._path(scope, String(path).trim())
        return value == null ? '' : String(value)
      }),
    }

    return { ...tools, ...(overrides ?? {}) }
  }

  /** Минимальные built-in converters для preview v1. */
  private _convert(identity: string, value: unknown, options?: Record<string, unknown>): unknown {
    // Не инициируем federation configuration из standalone DataView во время
    // циклической загрузки Endge modules; в полноценном runtime она уже собрана.
    const converter = Endge.isConfigured ? Endge.domain.getConverter(identity) : null
    if (converter?.customHandler) {
      const converted = converter.convert(value)
      if (converted && (typeof converted === 'object' || typeof converted === 'function') && typeof (converted as any).then === 'function')
        throw new Error(`[DataView] Async converter "${identity}" is not supported.`)
      return converted
    }

    if (identity === 'date.iso_to_time') {
      const date = new Date(String(value ?? ''))
      if (Number.isNaN(date.getTime()))
        return value
      const hours = String(date.getUTCHours()).padStart(2, '0')
      const minutes = String(date.getUTCMinutes()).padStart(2, '0')
      const format = String(options?.format ?? 'HH:mm')
      return format === 'HH:mm' ? `${hours}:${minutes}` : date.toISOString()
    }

    return value
  }

  /** Читает dot-path из object/array без выбрасывания ошибок. */
  private _path(source: unknown, path: string): unknown {
    const parts = String(path ?? '').split('.').filter(Boolean)
    let current: any = source
    for (const part of parts) {
      if (current == null)
        return undefined
      current = current[part]
    }
    return current
  }

  /** Ищет локальный DataView artifact среди child artifacts, включая вложенные children. */
  private _findLocalDataViewArtifact(
    ref: Extract<DataViewRef, { kind: 'local' }>,
    children: ProgramArtifact[],
  ): ProgramArtifact<DataViewProgramPayload> | null {
    for (const child of children) {
      if (
        child.ref.entityType === 'data-view'
        && (child.ref.identity === ref.ref.identity || child.ref.id === ref.ref.id)
      ) {
        return child as ProgramArtifact<DataViewProgramPayload>
      }

      const nested = this._findLocalDataViewArtifact(ref, child.children ?? [])
      if (nested)
        return nested
    }

    return null
  }
}
