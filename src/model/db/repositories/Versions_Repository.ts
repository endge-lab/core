import type { AxiosInstance } from 'axios'

export class Versions_Repository {
  constructor(private _api: AxiosInstance) {}

  /** Список версий без поля data (тяжёлое); data - через findById при необходимости. */
  async findAll(params: Record<string, any> = {}): Promise<any[]> {
    const r = await this._api.get('/versions', {
      params: {
        limit: 100,
        sort: '-createdAt',
        'select[data]': false,
        ...params,
      },
    })
    return r.data.docs ?? []
  }

  /** Одна версия по id, с полем data (для скачивания). */
  async findById(id: string | number): Promise<any> {
    const r = await this._api.get(`/versions/${id}`)
    return r.data
  }

  async create(data: { identity: string; description?: string; data: any }): Promise<any> {
    const r = await this._api.post('/versions', data)
    return r.data.doc ?? r.data
  }

  async delete(id: string | number): Promise<void> {
    await this._api.delete(`/versions/${id}`)
  }
}
