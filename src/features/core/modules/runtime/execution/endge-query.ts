import type { RQuery } from '@/features/core/modules/domain/entities/RQuery'

import type { QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'

import type { RuntimeParentRef } from '@/features/core/modules/runtime/domain/runtime-execute.type'
import type { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import { Endge } from '@/features/core/kernel/endge'
import { QueryExecutor_Adapter } from '@/features/core/modules/runtime/adapters/QueryExecutor_Adapter'

/**
 * Модуль выполнения доменных query: custom executor, mock data и REST.
 */
export class EndgeQuery {
  private readonly _executor: QueryExecutor_Adapter

  /** Создаёт query module с явным transport adapter. */
  public constructor(executor: QueryExecutor_Adapter = createQueryExecutor()) {
    this._executor = executor
  }

  /**
   * Выполняет query через compiled artifact и сохраняет результат в Raph.
   */
  async run(
    query: RQuery,
    params: Record<string, unknown> = {},
    parent?: RuntimeParentRef | null,
  ): Promise<any> {
    const idOrIdentity = query.id ?? query.identity
    const artifact = idOrIdentity != null
      ? Endge.program.getQueryArtifact(idOrIdentity)
      : null
    if (!artifact) {
      throw new Error(`Query artifact is missing for "${query.identity ?? query.name ?? query.id}". Compile domain before running query.`)
    }
    if (artifact.status === 'error') {
      throw new Error(`Query artifact has compile errors for "${query.identity ?? query.name ?? query.id}".`)
    }

    const host = Endge.runtime.execute(query, {
      parent,
      persistence: 'disabled',
      meta: { props: params },
    }) as QueryRuntimeHost | null
    if (!host) {
      throw new Error(`Query runtime cannot be created for "${query.identity}".`)
    }

    try {
      return await host.run()
    }
    finally {
      await Endge.runtime.destroyRuntimeTreeAsync(host.id)
    }
  }

  /** Выполняет artifact для QueryRuntimeHost без преждевременной записи stores. */
  public executeArtifact(input: {
    payload: QueryProgramPayload
    props: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<any> {
    return this._executor.execute({
      payload: input.payload,
      vars: input.props,
      signal: input.signal,
    })
  }

  /** Извлекает response-backed output для атомарного commit в QueryRuntimeHost. */
  public readResponseOutput(
    output: QueryProgramPayload['outputs'][number],
    response: unknown,
  ): unknown {
    return this._executor.readResponseOutput(output, response)
  }
}

function createQueryExecutor(): QueryExecutor_Adapter {
  return new QueryExecutor_Adapter({
    resolveVariable: source => Endge.workspace.variables.resolve(source) || source,
    resolveAuth: (policy, options) => Endge.auth.requests.resolve(policy, options),
    reportWarning: (message) => {
      if (!Endge.isConfigured) {
        return
      }
      Endge.diagnostics.warn(`[Query] ${message}`, {
        scope: { name: 'endge.runtime.query' },
        phase: 'runtime',
        eventName: 'endge.expression.warning',
      })
    },
  })
}
