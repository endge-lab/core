import type { AxiosInstance } from 'axios'
import type { QueryExecutorDependencies } from '@/model/adapters/query/QueryExecutor_Adapter'

import axios from 'axios'

import { QueryExecutor_Adapter } from '@/model/adapters/query/QueryExecutor_Adapter'

/** Создаёт Query executor с изолированными test dependencies. */
export function createQueryExecutor(
  http: AxiosInstance = axios.create(),
  overrides: Partial<QueryExecutorDependencies> = {},
): QueryExecutor_Adapter {
  return new QueryExecutor_Adapter({
    resolveVariable: source => source,
    resolveAuth: async () => ({
      profileIdentity: null,
      headers: {},
      expiresAt: null,
    }),
    reportWarning: () => {},
    ...overrides,
  }, http)
}
