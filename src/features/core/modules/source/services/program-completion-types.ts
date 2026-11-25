import type { DataViewProgramPayload, ProgramArtifact, QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { CompositionBindingValue, CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { DataViewRef } from '@/features/core/modules/source/domain/types/data-view-source.types'
import type { SourceExpressionIR } from '@/features/core/modules/source/domain/types/source-expression.types'
import type { StoreSourceArtifact } from '@/features/core/modules/source/domain/types/store-source.types'
import type { TypeSourceExpression } from '@/features/core/modules/source/domain/types/type-source.types'
import type { ResolveCompletionType } from '@/features/core/modules/source/services/source-completion-types'
import { Endge } from '@/features/core/kernel/endge'
import {
  completionObjectType,
  completionTypeField,
  inferSourceExpressionType,
  readCompletionType,
  sampleCompletionType,
  sourceFieldCompletionType,
  sourceFieldsCompletionType,
} from '@/features/core/modules/source/services/source-completion-types'

export function resolveProgramCompletionType(identity: string) {
  return Endge.program.getTypeArtifact(identity)?.payload.definition
}

export function storeCompletionType(
  identity: string,
  resolveType: ResolveCompletionType,
): TypeSourceExpression | undefined {
  const store = Endge.program.getStoreArtifact(identity)
  const model = store ? null : Endge.domain.getStore(identity)
  const payload = store?.payload ?? (model
    ? Endge.source.compile('store', model.source, { sourceContext: Endge.source.currentSourceContext() ?? undefined }).artifact as StoreSourceArtifact | undefined
    : undefined)
  if (!payload) {
    return undefined
  }
  const descriptors = new Map(payload.data.map(descriptor => [descriptor.key, descriptor]))
  const fields = new Map<string, TypeSourceExpression | undefined>()
  const fieldType = (key: string): TypeSourceExpression | undefined => {
    if (fields.has(key)) {
      return fields.get(key)
    }
    const descriptor = descriptors.get(key)
    if (!descriptor) {
      return undefined
    }
    fields.set(key, undefined)
    const type = descriptor.contract
      ? sourceFieldCompletionType(descriptor.contract)
      : descriptor.kind === 'value'
        ? descriptor.initial.kind === 'literal' ? sampleCompletionType(descriptor.initial.value) : undefined
        : descriptor.dataViews.reduce<TypeSourceExpression | undefined>(
            (input, ref) => viewCompletionType(ref, input, resolveType, store?.children),
            fieldType(descriptor.source),
          )
    fields.set(key, type)
    return type
  }
  return completionObjectType([...descriptors.keys()].map(key => completionTypeField(key, fieldType(key))))
}

function viewCompletionType(
  ref: DataViewRef,
  input: TypeSourceExpression | undefined,
  resolveType: ResolveCompletionType,
  children: ProgramArtifact[] | undefined,
  boundProps: Record<string, TypeSourceExpression | undefined> = {},
): TypeSourceExpression | undefined {
  const view = ref.kind === 'external'
    ? readDataViewPayload(ref.identity)
    : ref.kind === 'local'
      ? children?.find(child => child.ref.entityType === 'data-view' && child.ref.id === ref.ref.id)?.payload as DataViewProgramPayload | undefined
      : Endge.source.compile('data-view', ref.source, { sourceContext: Endge.source.currentSourceContext() ?? undefined }).artifact as DataViewProgramPayload | undefined
  if (!view) {
    return undefined
  }
  if (view.contract && !['Any', 'Object'].includes(view.contract.output.type)) {
    return sourceFieldCompletionType(view.contract.output)
  }
  if (view.contract?.output.typeExpression) {
    return sourceFieldCompletionType(view.contract.output)
  }

  const props = sourceFieldsCompletionType(view.props ?? [])
  const fields = new Map(props.kind === 'object' ? props.fields.map(field => [field.key, field]) : [])
  for (const [key, type] of Object.entries(boundProps)) {
    if (type && !fields.has(key)) {
      fields.set(key, completionTypeField(key, type))
    }
  }
  const reads = { prop: completionObjectType([...fields.values()]), value: input }
  const scope = { resolveType, reads, current: input }
  if (view.mode === 'expression') {
    return inferSourceExpressionType(view.expression, scope)
  }
  if (view.mode === 'projection') {
    return completionObjectType(Object.entries(view.output).map(([key, expression]) =>
      completionTypeField(key, inferSourceExpressionType(expression, scope))))
  }
  if (view.mode === 'pipeline') {
    let current = input
    for (const step of view.steps) {
      if (step.type !== 'select') {
        return undefined
      }
      current = inferSourceExpressionType(step.expression, { ...scope, current })
    }
    return current
  }
}

function readDataViewPayload(identity: string): DataViewProgramPayload | undefined {
  const compiled = Endge.program.getDataViewArtifact(identity)?.payload
  if (compiled) {
    return compiled
  }
  const model = Endge.domain.getDataView(identity)
  if (model) {
    return Endge.source.compile('data-view', model.source, {
      sourceContext: Endge.source.currentSourceContext() ?? undefined,
    }).artifact
  }
}

export function compositionCompletionTypes(
  composition: CompositionProgramPayload,
  resolveType: ResolveCompletionType,
) {
  const outputFields = (runtimePath: string) => {
    const runtime = composition.runtimes.find(runtime => runtime.path === runtimePath)
      ?? composition.runtimes.find(runtime => runtime.name === runtimePath && !runtime.scopePath)
    if (runtime?.kind !== 'query') {
      return []
    }
    const compiled = Endge.program.getQueryArtifact(runtime.identity)?.payload
    const model = compiled ? null : Endge.domain.getQuery(runtime.identity)
    const query = compiled ?? (model
      ? Endge.source.compile('query', model.source, { sourceContext: Endge.source.currentSourceContext() ?? undefined }).artifact as QueryProgramPayload | undefined
      : undefined)
    if (!query) {
      return []
    }
    const reads = { response: query.mockData == null ? undefined : sampleCompletionType(query.mockData) }
    return query.outputs.map((output) => {
      const source = output.source
      const type = output.contract
        ? sourceFieldCompletionType(output.contract)
        : source.type === 'response'
          ? inferSourceExpressionType(source.expression, { resolveType, reads })
          ?? (source.path != null ? readCompletionType(reads.response, source.path, resolveType) : reads.response)
          : undefined
      return completionTypeField(output.key, type)
    })
  }
  const storeTypes = new Map<string, TypeSourceExpression | undefined>()
  const dataType = (name: string) => {
    if (!storeTypes.has(name)) {
      const data = composition.data.find(data => (data.path ?? data.name) === name)
      storeTypes.set(name, data?.kind === 'store' ? storeCompletionType(data.identity, resolveType) : undefined)
    }
    return storeTypes.get(name)
  }
  const readData = (path: string) => {
    const data = composition.data
      .map(data => data.path ?? data.name)
      .filter(name => path === name || path.startsWith(`${name}.`))
      .sort((left, right) => right.length - left.length)[0]
    return data ? readCompletionType(dataType(data), path.slice(data.length), resolveType) : undefined
  }
  const readOutput = (runtime: string, path: string) =>
    readCompletionType(completionObjectType(outputFields(runtime)), path, resolveType)

  const read = (expression: Extract<SourceExpressionIR, { type: 'read' }>) => {
    const [name, path = ''] = expression.parameters ?? []
    if (!name) {
      return undefined
    }
    if (expression.source === 'composition-data' || expression.source === 'composition-store') {
      return readData(name)
    }
    if (expression.source === 'composition-output' || expression.source === 'composition-outputs') {
      return readOutput(name, path)
    }
  }

  function readBinding(binding: CompositionBindingValue): TypeSourceExpression | undefined {
    switch (binding.kind) {
      case 'literal':
        return sampleCompletionType(binding.value)
      case 'data':
        return readCompletionType(dataType(binding.data), binding.path, resolveType)
      case 'output':
        return readOutput(binding.runtime, binding.output)
      case 'outputs':
        return readOutput(binding.runtime, '')
      case 'data-view':
        return viewCompletionType(
          { kind: 'external', identity: binding.identity },
          readCompletionType(dataType(binding.data), binding.path, resolveType),
          resolveType,
          undefined,
          Object.fromEntries(Object.entries(binding.props).map(([name, value]) => [name, readBinding(value)])),
        )
      case 'expression':
        return inferSourceExpressionType(binding.expression, {
          resolveType,
          reads: { prop: sourceFieldsCompletionType(composition.props) },
          read,
        })
      default:
        return undefined
    }
  }

  return {
    dataNames: composition.data.map(data => data.path ?? data.name),
    readData,
    readOutput,
    readBinding,
    read,
  }
}
