import type { DataViewProgramPayload, ProgramArtifact } from '@/features/core/modules/program/domain/types/program.types'
import type {
  DataViewExpression,
  DataViewPathOperation,
  DataViewRef,
  DataViewRunContext,
  DataViewRunTools,
} from '@/features/core/modules/source/domain/types/data-view-source.types'

import { Endge } from '@/features/core/kernel/endge'
import { RDataView } from '@/features/core/modules/domain/entities/RDataView'
import { compileDataViewSource } from '@/features/core/modules/source/services/compilers/data-view-source-compile'
import { evaluateSourceExpression } from '@/features/core/modules/source/services/source-expression-evaluate'

/** Сообщает, что persisted DataView не прошёл общий build pipeline. */
export class DataViewArtifactUnavailableError extends Error {
  public readonly code = 'data_view_artifact_unavailable'

  public constructor(identity: string) {
    super(`DataView artifact is unavailable for "${identity}". Run the compiler build before runtime execution.`)
    this.name = 'DataViewArtifactUnavailableError'
  }
}

/** Модуль выполнения скомпилированных RDataView artifacts. */
export class EndgeDataView {
  /** Выполняет DataView по id/identity/model над переданным input object. */
  public run(
    dataViewOrId: RDataView | string | number,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
    context: DataViewRunContext = {},
  ): unknown {
    const dataView = this._resolveDataView(dataViewOrId)
    const artifact = this._resolveArtifact(dataView)
    return this.runPayload(artifact.payload, input, tools, {
      children: artifact.children ?? [],
      props: context.props,
    })
  }

  /** Выполняет уже скомпилированный DataView artifact без поиска в домене. */
  public runArtifact(
    artifact: ProgramArtifact<DataViewProgramPayload>,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
    context: DataViewRunContext = {},
  ): unknown {
    if (artifact.status === 'error') {
      const message = artifact.diagnostics[0]?.message ?? `DataView artifact has compile errors for "${artifact.ref.identity}".`
      throw new Error(message)
    }

    return this.runPayload(artifact.payload, input, tools, {
      children: artifact.children ?? [],
      props: context.props,
    })
  }

  /** Выполняет уже скомпилированный DataView payload. */
  public runPayload(
    artifact: DataViewProgramPayload,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
    context: DataViewRunContext & { children?: ProgramArtifact[] } = {},
  ): unknown {
    const runTools = this._createTools(tools)
    const props = this._resolveProps(artifact, context.props)

    if (artifact.mode === 'manual') {
      return this._runManual()
    }
    if (artifact.mode === 'projection') {
      return this._runProjection(artifact, input, props)
    }
    if (artifact.mode === 'expression') {
      return this._runExpression(artifact, input, props)
    }

    return this._runPipeline(artifact, input, runTools, context, props)
  }

  /** Вычисляет object projection один раз над целым DataView input. */
  private _runProjection(
    artifact: DataViewProgramPayload,
    input: unknown,
    props: Record<string, unknown>,
  ): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(artifact.output ?? {}).map(([key, expression]) => [
        key,
        evaluateSourceExpression(expression, {
          scope: input,
          props,
          onWarning: Endge.isConfigured
            ? warning => Endge.diagnostics.warn(`[DataView] ${warning.message}`, {
              scope: { name: 'endge.runtime.data-view' },
              phase: 'runtime',
              eventName: 'endge.expression.warning',
            })
            : undefined,
        }),
      ]),
    )
  }

  /** Вычисляет root ValueExpression без object projection wrapper. */
  private _runExpression(
    artifact: DataViewProgramPayload,
    input: unknown,
    props: Record<string, unknown>,
  ): unknown {
    if (!artifact.expression) {
      return undefined
    }
    return evaluateSourceExpression(artifact.expression, {
      scope: input,
      props,
      onWarning: Endge.isConfigured
        ? warning => Endge.diagnostics.warn(`[DataView] ${warning.message}`, {
          scope: { name: 'endge.runtime.data-view' },
          phase: 'runtime',
          eventName: 'endge.expression.warning',
        })
        : undefined,
    })
  }

  /** Выполняет DataView-ссылку из query/DataView artifact. */
  public runRef(
    ref: DataViewRef,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
    context: DataViewRunContext & { children?: ProgramArtifact[] } = {},
  ): unknown {
    if (ref.kind === 'external') {
      return this.run(ref.identity, input, tools, context)
    }

    if (ref.kind === 'inline') {
      return this.runSource(ref.source, input, tools, context)
    }

    const artifact = this._findLocalDataViewArtifact(ref, context.children ?? [])
    if (!artifact) {
      throw new Error(`Local DataView artifact not found: "${ref.ref.identity}".`)
    }

    return this.runArtifact(artifact, input, tools, context)
  }

  /** Выполняет DataView source без записи artifact в `Endge.program`. */
  public runSource(
    source: string,
    input: unknown,
    tools?: Partial<DataViewRunTools>,
    context: DataViewRunContext = {},
  ): unknown {
    const result = compileDataViewSource(source)
    const error = result.diagnostics.find(diagnostic => diagnostic.severity === 'error')
    if (error) {
      throw new Error(error.message)
    }
    if (!result.artifact) {
      throw new Error('DataView source не создал artifact.')
    }

    return this.runPayload(result.artifact as DataViewProgramPayload, input, tools, context)
  }

  /** Возвращает DataView model из домена или входного экземпляра. */
  private _resolveDataView(dataViewOrId: RDataView | string | number): RDataView {
    if (dataViewOrId instanceof RDataView) {
      return dataViewOrId
    }

    const dataView = Endge.domain.getDataView(dataViewOrId)
    if (!dataView) {
      throw new Error(`DataView not found: "${dataViewOrId}".`)
    }

    return dataView
  }

  /** Возвращает только artifact, подготовленный общим compiler build. */
  private _resolveArtifact(dataView: RDataView): ProgramArtifact<DataViewProgramPayload> {
    const artifact = Endge.program.getDataViewArtifact(dataView.id ?? dataView.identity)
    if (!artifact) {
      throw new DataViewArtifactUnavailableError(dataView.identity)
    }
    if (artifact.status === 'error') {
      const message = artifact.diagnostics[0]?.message ?? `DataView artifact has compile errors for "${dataView.identity}".`
      throw new Error(message)
    }

    return artifact
  }

  /** Останавливает manual DataView до появления безопасного runtime. */
  private _runManual(): never {
    throw new Error('[DataView] mode "manual" временно отключён: безопасный runtime для пользовательского TypeScript ещё не реализован.')
  }

  /** Интерпретирует декларативные pipeline steps без eval. */
  private _runPipeline(
    artifact: DataViewProgramPayload,
    input: unknown,
    tools: DataViewRunTools,
    context: DataViewRunContext & { children?: ProgramArtifact[] },
    props: Record<string, unknown>,
  ): unknown {
    if (artifact.steps.some(step => step.type === 'select')) {
      return this._runSelectPipeline(artifact, input)
    }

    let rows: unknown[] = []
    let alias = 'item'
    const joins: Array<{ source: string, left: string, right: string, as: string }> = []

    for (const step of artifact.steps) {
      if (step.type === 'from') {
        let value = tools.path(input, step.source)
        for (const ref of step.dataViews ?? []) {
          value = this.runRef(ref, value, tools, context)
        }
        rows = Array.isArray(value) ? value : []
        alias = step.as || 'item'
      }

      if (step.type === 'join') {
        joins.push(step)
      }

      if (step.type === 'map') {
        rows = rows.map((row) => {
          const scope: Record<string, unknown> = {
            input,
            [alias]: row,
          }
          for (const join of joins) {
            scope[join.as] = this._resolveJoin(input, scope, join, tools)
          }

          const output = this._createMapOutput(step.spreads ?? [], scope, tools)
          for (const [key, expression] of Object.entries(step.fields)) {
            output[key] = this._evaluateExpression(expression, scope, tools)
          }

          return output
        })
        break
      }
    }

    if (!artifact.filter) {
      return rows
    }

    return rows.filter(row => Boolean(evaluateSourceExpression(artifact.filter!, {
      row,
      props,
      onWarning: Endge.isConfigured
        ? warning => Endge.diagnostics.warn(`[DataView] ${warning.message}`, {
          scope: { name: 'endge.runtime.data-view' },
          phase: 'runtime',
          eventName: 'endge.expression.warning',
        })
        : undefined,
    })))
  }

  /** Заполняет отсутствующие props декларативными defaults DataView artifact. */
  private _resolveProps(
    artifact: DataViewProgramPayload,
    input: Record<string, unknown> | undefined,
  ): Record<string, unknown> {
    const props = { ...(input ?? {}) }
    for (const field of artifact.props ?? []) {
      if (props[field.key] === undefined && field.defaultValue) {
        props[field.key] = evaluateSourceExpression(field.defaultValue)
      }
    }
    return props
  }

  /** Последовательно вычисляет whole-value steps; каждый select получает результат предыдущего. */
  private _runSelectPipeline(artifact: DataViewProgramPayload, input: unknown): unknown {
    let value = input

    for (const step of artifact.steps) {
      if (step.type !== 'select') {
        throw new Error('[DataView] select pipeline cannot contain structural steps.')
      }

      value = evaluateSourceExpression(step.expression, {
        scope: value,
        onWarning: Endge.isConfigured
          ? warning => Endge.diagnostics.warn(`[DataView] ${warning.message}`, {
            scope: { name: 'endge.runtime.data-view' },
            phase: 'runtime',
            eventName: 'endge.expression.warning',
          })
          : undefined,
      })
    }

    return value
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
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(output, value)
      }
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
    if (!Array.isArray(source)) {
      return null
    }

    return source.find(item => tools.path(item, join.right) === leftValue) ?? null
  }

  /** Вычисляет одно поле map-expression. */
  private _evaluateExpression(
    expression: DataViewExpression,
    scope: Record<string, unknown>,
    tools: DataViewRunTools,
  ): unknown {
    if (expression.type === 'literal') {
      return expression.value
    }
    if (expression.type === 'template') {
      return tools.template(expression.template, scope)
    }

    if (expression.type !== 'path') {
      return evaluateSourceExpression(expression, { scope })
    }

    let value = tools.path(scope, expression.path)
    for (const operation of expression.operations) {
      value = this._applyPathOperation(value, operation, tools)
    }

    return value
  }

  /** Применяет chain operation к path-expression. */
  private _applyPathOperation(
    value: unknown,
    operation: DataViewPathOperation,
    tools: DataViewRunTools,
  ): unknown {
    if (operation.type === 'pick') {
      return tools.pick(value, operation.path)
    }

    if (operation.type === 'convert') {
      return tools.convert(operation.converter, value, operation.options)
    }

    if (operation.type === 'find') {
      if (!Array.isArray(value)) {
        return null
      }
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
    // Converter resolution принадлежит общему definition/provider owner.
    // Это также сохраняет совместимость автономного выполнения DataView с определениями,
    // принадлежащими коду и намеренно не имеющими сохранённого документа RConverter.
    if (Endge.converters.has(identity)) {
      return Endge.converters.execute(identity, value, options)
    }

    if (identity === 'date.iso_to_time') {
      const date = new Date(String(value ?? ''))
      if (Number.isNaN(date.getTime())) {
        return value
      }
      const hours = String(date.getUTCHours()).padStart(2, '0')
      const minutes = String(date.getUTCMinutes()).padStart(2, '0')
      const format = String(options?.format ?? 'HH:mm')
      return format === 'HH:mm' ? `${hours}:${minutes}` : date.toISOString()
    }

    return value
  }

  /** Применяет один зарегистрированный Converter ко всему текущему значению. */
  public convert(identity: string, value: unknown, options?: Record<string, unknown>): unknown {
    return this._convert(identity, value, options)
  }

  /** Читает dot-path из object/array без выбрасывания ошибок. */
  private _path(source: unknown, path: string): unknown {
    const parts = String(path ?? '').split('.').filter(Boolean)
    let current: any = source
    for (const part of parts) {
      if (current == null) {
        return undefined
      }
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
      if (nested) {
        return nested
      }
    }

    return null
  }
}
