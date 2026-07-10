import type {
  DataSource,
  ExecuteQueryContext,
} from '@/domain/entities/data/DataSource'

export class DataSourceGQL implements DataSource {
  async executeQuery<T>(_ctx: ExecuteQueryContext): Promise<T> {
    throw new Error('DataSourceGQL is obsolete. Query source v2 currently supports REST only.')
  }
}
