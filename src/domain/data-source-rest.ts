import type {
  DataSource,
  ExecuteQueryContext,
} from '@/domain/entities/data/DataSource'

export class DataSourceRest implements DataSource {
  async executeQuery<T>(_ctx: ExecuteQueryContext): Promise<T> {
    throw new Error('DataSourceRest is obsolete. Execute source-compiled Query through Endge.query.')
  }
}
