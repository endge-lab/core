import type { RQuery } from '@/features/core/modules/domain/entities/RQuery'

import type { QueryProgramPayload } from '@/features/core/modules/program/domain/types/program.types'
import type { GraphQLResponseError } from '@/features/core/modules/runtime/domain/graphql-query-error'
import type { QueryExecutionContext, QueryExecutionObserver } from '@/features/core/modules/runtime/domain/query-execution.types'

import type { RuntimeParentRef } from '@/features/core/modules/runtime/domain/runtime-execute.type'
import type { QueryRuntimeHost } from '@/features/core/modules/runtime/hosts/QueryRuntimeHost'
import { Endge } from '@/features/core/kernel/endge'
import { QueryExecutor_Adapter } from '@/features/core/modules/runtime/adapters/QueryExecutor_Adapter'
import { formatGraphQLResponseErrors } from '@/features/core/modules/runtime/domain/graphql-query-error'

/**
 * Модуль выполнения доменных query: custom executor, mock data и REST.
 */
export class EndgeQuery {
  private readonly _executor: QueryExecutor_Adapter

  /**
   * Создаёт query module с явным transport adapter.
   */
  public constructor(executor: QueryExecutor_Adapter = createQueryExecutor()) {
    this._executor = executor
  }

  /**
   * Выполняет query через compiled artifact и сохраняет результат в Raph.
   * observer видит итоговый HTTP-запрос и ответ (например, для панели запуска в IDE).
   */
  async run(
    query: RQuery,
    params: Record<string, unknown> = {},
    parent?: RuntimeParentRef | null,
    options: { observer?: QueryExecutionObserver } = {},
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
      return await host.run(undefined, options)
    }
    finally {
      await Endge.runtime.destroyRuntimeTreeAsync(host.id)
    }
  }

  /**
   * Выполняет artifact для QueryRuntimeHost без преждевременной записи stores.
   */
  public executeArtifact(input: {
    payload: QueryProgramPayload
    props: Record<string, unknown>
    signal?: AbortSignal
    onGraphQLErrors?: QueryExecutionContext['onGraphQLErrors']
    observer?: QueryExecutionObserver
  }): Promise<any> {
    return this._executor.execute({
      payload: input.payload,
      vars: input.props,
      signal: input.signal,
      onGraphQLErrors: input.onGraphQLErrors,
      onRequest: input.observer?.onRequest,
      onResponse: input.observer?.onResponse,
    })
  }

  /**
   * Ответ mockRequest Simulation для GraphQL Query: errors сценария по errorPolicy Query.
   */
  public applySimulatedGraphQLErrors(input: {
    payload: QueryProgramPayload
    data: unknown
    errors: readonly unknown[] | undefined
    props: Record<string, unknown>
    onGraphQLErrors?: QueryExecutionContext['onGraphQLErrors']
  }): unknown {
    return this._executor.applySimulatedGraphQLErrors(input.payload, input.data, input.errors, input.props, input.onGraphQLErrors)
  }

  /**
   * Извлекает response-backed output для атомарного commit в QueryRuntimeHost.
   */
  public readResponseOutput(
    output: QueryProgramPayload['outputs'][number],
    response: unknown,
    graphQLErrors: readonly GraphQLResponseError[] = [],
  ): unknown {
    return this._executor.readResponseOutput(output, response, graphQLErrors)
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
    reportGraphQLErrors: ({ url, operationName, errors }) => {
      if (!Endge.isConfigured) {
        return
      }
      Endge.diagnostics.warn(`[Query] GraphQL${operationName ? ` ${operationName}` : ''} returned ${errors.length} error(s) at ${url}: ${formatGraphQLResponseErrors(errors)}`, {
        scope: { name: 'endge.runtime.query' },
        phase: 'runtime',
        eventName: 'endge.query.graphql-errors',
      })
    },
  })
}
