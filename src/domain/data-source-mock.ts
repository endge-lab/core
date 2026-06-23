import type {
  DataSource,
  ExecuteQueryContext,
} from '@/domain/entities/data/DataSource'

import mockGetUsers from '@/mock/demo-base/endge-data-getUsers.json'

export class DataSourceMock implements DataSource {
  async executeQuery<T>(ctx: ExecuteQueryContext): Promise<T> {
    let result = mockGetUsers

    if (ctx.params?.limit) {
      result = result.slice(0, ctx.params.limit)
    }

    return result as T
  }
}
