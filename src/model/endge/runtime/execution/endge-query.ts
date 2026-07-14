import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { AxiosInstance } from 'axios'

import axios from 'axios'

import { Endge } from '@/model/endge/kernel/endge'
import { QueryExecutor } from '@/model/services/query/QueryExecutor'
import type { QueryProgramPayload } from '@/domain/types/program/program.types'
import type { QueryRuntimeHost } from '@/domain/entities/runtime/hosts/QueryRuntimeHost'

/**
 * Модуль выполнения доменных query: custom executor, mock data и REST.
 */
export class EndgeQuery {
  private readonly executor: QueryExecutor

  /**
   * Создает query runner с переданным или дефолтным axios instance.
   */
  constructor(
    private readonly http: AxiosInstance = axios.create({
      headers: { Accept: 'application/json' },
    }),
  ) {
    this.executor = new QueryExecutor(this.http)
  }

  /**
   * Выполняет query через compiled artifact и сохраняет результат в Raph.
   */
  async run(query: RQuery, params: Record<string, unknown> = {}): Promise<any> {
    const idOrIdentity = query.id ?? query.identity
    const artifact = idOrIdentity != null
      ? Endge.program.getQueryArtifact(idOrIdentity)
      : null
    if (!artifact)
      throw new Error(`Query artifact is missing for "${query.identity ?? query.name ?? query.id}". Compile domain before running query.`)
    if (artifact.status === 'error')
      throw new Error(`Query artifact has compile errors for "${query.identity ?? query.name ?? query.id}".`)

    const host = Endge.runtime.execute(query, {
      props: params,
      persistence: 'disabled',
    }) as QueryRuntimeHost | null
    if (!host)
      throw new Error(`Query runtime cannot be created for "${query.identity}".`)

    try {
      return await host.run()
    }
    finally {
      Endge.runtime.destroyRuntimeTree(host.id)
    }
  }

  /** Выполняет artifact для QueryRuntimeHost без преждевременной записи stores. */
  public executeArtifact(input: {
    payload: QueryProgramPayload
    props: Record<string, unknown>
    signal?: AbortSignal
  }): Promise<any> {
    return this.executor.execute({
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
    return this.executor.readResponseOutput(output, response)
  }
}
