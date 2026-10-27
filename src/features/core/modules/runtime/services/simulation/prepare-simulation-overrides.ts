import type { QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { SimulationGraphQLError, SimulationMockStream, SimulationRuntimeOverride, SimulationSourceArtifact, SimulationTargetReference } from '@/features/core/modules/source/domain/types/simulation-source.types'
import type { StreamSourceArtifact } from '@/features/core/modules/source/domain/types/stream-source.types'

import { resolveSimulationResponseContract } from '@/features/core/modules/source/services/simulation-response-contract'

import { createSimulationSchema } from './create-simulation-schema'

// Подмена ответа Query: схема генератора и (GraphQL) errors ответа.
export interface SimulationRequestOverride {
  schema: Record<string, unknown>
  seed: string
  errors?: SimulationGraphQLError[]
}

export interface SimulationOverrides {
  requests: ReadonlyMap<string, SimulationRequestOverride>
  streams: ReadonlyMap<string, { schema: Record<string, unknown>, options: SimulationMockStream }>
}

// Подготавливает подмены по occurrence paths до активации target; Program остаётся неизменным.
export function prepareSimulationOverrides(
  simulation: SimulationSourceArtifact,
  artifacts: RuntimeArtifactReader,
  seed: string,
): SimulationOverrides {
  const requests = new Map<string, SimulationRequestOverride>()
  const streams = new Map<string, { schema: Record<string, unknown>, options: SimulationMockStream }>()
  const graph = (ref: SimulationTargetReference): CompositionProgramPayload => {
    const artifact = artifacts.getArtifact<CompositionProgramPayload>(ref.entityType, ref.identity)
    if (!artifact || artifact.status === 'error') {
      throw new Error(`[Simulation] Target "${ref.entityType}:${ref.identity}" недоступен.`)
    }
    return artifact.payload
  }
  const visit = (overrides: readonly SimulationRuntimeOverride[], payload: CompositionProgramPayload, scopePath: string, invocation: readonly string[]) => {
    for (const override of overrides) {
      const path = scopePath === 'scope_default' ? override.alias : `${scopePath}.${override.alias}`
      const runtime = payload.runtimes.find(item => item.path === path && item.scopePath === scopePath)
      const scope = payload.scopes.find(item => item.path === path && item.parentPath === scopePath)
      if (!runtime && !scope) {
        throw new Error(`[Simulation] Runtime alias "${path}" отсутствует в target.`)
      }
      if (override.request) {
        if (runtime?.kind !== 'query') {
          throw new Error(`[Simulation] Подмена request требует Query: "${path}".`)
        }
        const query = artifacts.getArtifact<QueryProgramPayload>('query', runtime.identity)
        if (!query || query.status === 'error') {
          throw new Error(`[Simulation] Query "${runtime.identity}" недоступна.`)
        }
        // GraphQL: корневой response — объект data операции, его поля задают выходы data('...').
        const resolved = resolveSimulationResponseContract(runtime.identity, query.payload.outputs, query.payload.type === 'query-gql')
        if (!resolved.contract) {
          throw new Error(`[Simulation] ${resolved.error}`)
        }
        if (override.request.errors && query.payload.type !== 'query-gql') {
          throw new Error(`[Simulation] Query "${runtime.identity}": errors поддерживается только для GraphQL Query.`)
        }
        const key = JSON.stringify([...invocation, runtime.path])
        requests.set(key, {
          schema: createSimulationSchema(resolved.contract, artifacts, override.request.arrays, {}, override.request.useExamples),
          seed: override.request.seed ?? `${seed}:${key}`,
          ...(override.request.errors ? { errors: override.request.errors } : {}),
        })
      }
      if (override.stream) {
        if (runtime?.kind !== 'stream') {
          throw new Error(`[Simulation] Подмена stream требует Stream: "${path}".`)
        }
        const stream = artifacts.getArtifact<StreamSourceArtifact>('stream', runtime.identity)
        if (!stream || stream.status === 'error') {
          throw new Error(`[Simulation] Stream "${runtime.identity}" недоступен.`)
        }
        // graphqlSse: Type описывает data события next, тип события задаёт events.next Stream.
        const graphql = stream.payload.transport.kind === 'graphql-sse'
        if (graphql && override.stream.event) {
          throw new Error(`[Simulation] Stream "${runtime.identity}" использует graphqlSse: event в mockStream не указывается.`)
        }
        if (!graphql && !override.stream.event.trim()) {
          throw new Error(`[Simulation] Stream "${runtime.identity}": mockStream требует event.`)
        }
        if (!graphql && override.stream.errors) {
          throw new Error(`[Simulation] Stream "${runtime.identity}": errors поддерживается только для graphqlSse.`)
        }
        const key = JSON.stringify([...invocation, runtime.path])
        streams.set(key, { schema: createSimulationSchema({ type: override.stream.type, array: false }, artifacts, {}, override.stream.fields), options: { ...override.stream, seed: override.stream.seed ?? `${seed}:${key}` } })
      }
      if (override.runtimes) {
        if (scope) {
          visit(override.runtimes, payload, scope.path, invocation)
        }
        else if (runtime?.kind === 'composition') {
          visit(override.runtimes, graph({ entityType: 'composition', identity: runtime.identity }), 'scope_default', [...invocation, runtime.path])
        }
        else {
          throw new Error(`[Simulation] Вложенные runtimes требуют Composition или scope: "${path}".`)
        }
      }
    }
  }
  visit(simulation.runtimes, graph(simulation.target), 'scope_default', [])
  return { requests, streams }
}
