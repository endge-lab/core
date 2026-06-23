import type {
  DataSource,
  ExecuteQueryContext,
} from '@/domain/entities/data/DataSource'

export class DataSourceGQL implements DataSource {
  async executeQuery<T>(ctx: ExecuteQueryContext): Promise<T> {
    if (ctx.query.mockDataEnabled) {
      const mockData = ctx.query.mockData
      const queryName = ctx.query.query

      const mockDataParsed = JSON.parse(mockData)
      const dataPure = mockDataParsed?.data?.[queryName]

      console.log(mockDataParsed)

      return dataPure.slice(0, ctx.params.limit)
    }

    throw new Error('Not implemented in DataSourceGQL')
  }
}
