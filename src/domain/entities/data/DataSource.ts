import type { RQuery } from '@/domain/entities/reflect/RQuery'

export interface ExecuteQueryContext {
  query: RQuery
  params: Record<string, any>
}

export interface DataSource {
  executeQuery<T>(ctx: ExecuteQueryContext): Promise<T>
}
