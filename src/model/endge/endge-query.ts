import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { AxiosInstance } from 'axios'

import axios from 'axios'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/endge'
import { QueryExecutor_Service } from '@/model/services/QueryExecutor_Service'

/**
 * Модуль выполнения доменных query: custom executor, mock data и REST.
 */
export class EndgeQuery extends EndgeModule {
  private readonly executor: QueryExecutor_Service

  /**
   * Создает query runner с переданным или дефолтным axios instance.
   */
  constructor(
    private readonly http: AxiosInstance = axios.create({
      headers: { Accept: 'application/json' },
    }),
  ) {
    super()
    this.executor = new QueryExecutor_Service(this.http)
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

    return this.executor.execute({
      query,
      payload: artifact.payload,
      children: artifact.children ?? [],
      vars: params,
    })
  }
}
