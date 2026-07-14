import type { ProgramArtifact } from '@/domain/types/program/program.types'

import { Raph } from '@endge/raph'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { RFilter } from '@/domain/entities/reflect/RFilter'
import { FilterRuntimeHost } from '@/domain/entities/runtime/hosts/FilterRuntimeHost'
import { FilterViewRuntimeHost } from '@/domain/entities/runtime/hosts/FilterViewRuntimeHost'
import { compileFilterSource } from '@/model/services/source-engine/compilers/filter-source-compile'

describe('FilterViewRuntimeHost', () => {
  afterEach(() => Raph.app.reset())

  it('builds one renderer-neutral plan and delegates changes to Filter state', async () => {
    const filter = makeFilterRuntime()
    const view = new FilterViewRuntimeHost({
      id: 'filter-view',
      name: 'filters',
      model: filter.model,
      sourceRuntimeName: 'filter',
      sourceRuntime: filter,
      controls: {
        search: { type: 'Textarea' },
      },
      props: {
        showLabels: true,
        labels: { search: 'Поиск' },
        customerOption: 'compact',
      },
    })
    view.create()

    expect(view.hasCapability('renderable')).toBe(true)
    expect(view.getRenderModel()).toMatchObject({
      implementation: { kind: 'generated' },
      props: {
        showLabels: true,
        labels: { search: 'Поиск' },
        customerOption: 'compact',
      },
      fields: [
        { key: 'airports', control: { type: 'Select' } },
        { key: 'search', control: { type: 'Textarea' } },
        { key: 'cancelled', control: { type: 'Checkbox' } },
        { key: 'delay', control: { type: 'Input' } },
      ],
    })

    const renderChange = vi.fn()
    view.on('render:change', renderChange)
    view.setProps({ showLabels: false, customerOption: 'comfortable' })
    expect(view.getProps()).toEqual({
      showLabels: false,
      labels: { search: 'Поиск' },
      customerOption: 'comfortable',
    })
    expect(renderChange).toHaveBeenCalledTimes(1)

    await view.setValue('search', 'SU')
    expect(filter.getState()).toMatchObject({ search: 'SU' })
    expect(view.getRenderModel().fields.find(field => field.key === 'search')?.value).toBe('SU')

    view.destroy()
    filter.destroy()
  })
})

function makeFilterRuntime(): FilterRuntimeHost {
  const model = new RFilter()
  model.id = 1
  model.identity = 'schedule'
  model.name = 'Schedule'
  model.displayName = 'Schedule'
  const payload = compileFilterSource(`
defineFilter({
  fields: {
    airports: field('String').array().options([{ value: 'SVO', label: 'Шереметьево' }]).default([]),
    search: field('String').default(''),
    cancelled: field('Boolean').default(false),
    delay: field('Number').default(0),
  },
  outputs: {},
})
`).artifact!
  const artifact: ProgramArtifact<typeof payload> = {
    ref: { entityType: 'filter', id: model.id, identity: model.identity },
    sourceHash: 'test',
    compilerVersion: 'test',
    status: 'valid',
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable', 'data-provider', 'configuration'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
  const runtime = FilterRuntimeHost.createRuntime({
    id: 'filter',
    model,
    meta: { artifact },
    artifacts: { getArtifact: <T>() => artifact as unknown as ProgramArtifact<T> },
  })
  if (!runtime)
    throw new Error('Filter runtime was not created.')
  return runtime
}
