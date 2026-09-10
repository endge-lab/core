import type { QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { RuntimeArtifactReader } from '@/features/core/modules/runtime/domain/runtime-host.types'
import type { CompositionProgramPayload } from '@/features/core/modules/source/domain/types/composition-source.types'
import type { SimulationMockStream, SimulationRuntimeOverride, SimulationSourceArtifact, SimulationTargetReference } from '@/features/core/modules/source/domain/types/simulation-source.types'

import { createSimulationSchema } from './create-simulation-schema'

export interface SimulationOverrides {
  requests: ReadonlyMap<string, { schema: Record<string, unknown>, seed: string }>
  streams: ReadonlyMap<string, { schema: Record<string, unknown>, options: SimulationMockStream }>
}

/** Подготавливает подмены по occurrence paths до активации target; Program остаётся неизменным. */
export function prepareSimulationOverrides(
  simulation: SimulationSourceArtifact,
  artifacts: RuntimeArtifactReader,
  seed: string,
): SimulationOverrides {
  const requests = new Map<string, { schema: Record<string, unknown>, seed: string }>()
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
        const contracts = query.payload.outputs
          .filter(output => output.source.type === 'response' && !output.source.path && !output.source.expression && !output.transforms?.length && !output.dataViews.length && output.contract)
          .map(output => output.contract!)
        const unique = new Map(contracts.map(contract => [JSON.stringify({ type: contract.type, expression: contract.typeExpression, array: contract.array }), contract]))
        if (unique.size !== 1) {
          throw new Error(`[Simulation] Query "${runtime.identity}" требует однозначный контракт корневого response.`)
        }
        const key = JSON.stringify([...invocation, runtime.path])
        requests.set(key, { schema: createSimulationSchema([...unique.values()][0]!, artifacts, override.request.arrays), seed: override.request.seed ?? `${seed}:${key}` })
      }
      if (override.stream) {
        if (runtime?.kind !== 'stream') {
          throw new Error(`[Simulation] Подмена stream требует Stream: "${path}".`)
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
