import type { AxiosInstance } from 'axios'

import { describe, expect, it, vi } from 'vitest'

import { Types_Repository } from '@/model/db/repositories/Types_Repository'

describe('Types_Repository', () => {
  it('updates the existing document when its identity changes', async () => {
    const get = vi.fn(async (url: string, config: { params: Record<string, unknown> }) => {
      expect(url).toBe('/types')
      expect(config.params['where[identity][equals]']).toBe('old-type')
      return { data: { docs: [{ id: 42, identity: 'old-type' }] } }
    })
    const patch = vi.fn(async () => ({ data: { id: 42, identity: 'new-type' } }))
    const post = vi.fn()
    const repository = new Types_Repository({ get, patch, post } as unknown as AxiosInstance)

    const saved = await repository.upsert({
      identity: 'new-type',
      displayName: 'New type',
      schema: {},
    }, 'old-type')

    expect(patch).toHaveBeenCalledWith('/types/42', {
      identity: 'new-type',
      displayName: 'New type',
      schema: {},
    })
    expect(post).not.toHaveBeenCalled()
    expect(saved).toEqual({ id: 42, identity: 'new-type' })
  })
})
