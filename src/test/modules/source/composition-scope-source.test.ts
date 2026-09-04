import { describe, expect, it } from 'vitest'

import { compileCompositionSource } from '@/modules/source/services/compilers/composition-source-compile'

describe('проверка Source области Composition', () => {
  it('детерминированно разворачивает ресурсы, вложенные scopes и переопределения активации', () => {
    const result = compileCompositionSource(`
defineComposition({
  activateOn: startup(),
  resources: {
    applicationTheme: style('groundhandling-themes'),
  },
  runtimes: {
    core: composition('groundhandling-default').activateOn(manual()),
    pages: scope({
      runtimes: {
        control: scope({
          resources: { tableTheme: style('groundhandling-table') },
          runtimes: {
            content: composition('groundhandling-control-page').activateOn(startup()),
          },
        }).activateOn(manual()),
      },
    }),
  },
  outputs: {
    controlPage: output().fromScope('pages.control'),
  },
})
`)

    expect(result.diagnostics).toEqual([])
    expect(result.artifact?.activation).toEqual({ mode: 'startup' })
    expect(result.artifact?.resources).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'applicationTheme', scopePath: 'scope_default' }),
      expect.objectContaining({ path: 'pages.control.tableTheme', scopePath: 'pages.control' }),
    ]))
    expect(result.artifact?.scopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'scope_default', effectiveActivation: { mode: 'startup' } }),
      expect.objectContaining({ path: 'pages', parentPath: 'scope_default', effectiveActivation: { mode: 'startup' } }),
      expect.objectContaining({ path: 'pages.control', parentPath: 'pages', effectiveActivation: { mode: 'manual' } }),
    ]))
    expect(result.artifact?.runtimes).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: 'core', activationOverride: { mode: 'manual' }, effectiveActivation: { mode: 'manual' } }),
      expect.objectContaining({ path: 'pages.control.content', scopePath: 'pages.control', activationOverride: { mode: 'startup' } }),
    ]))
    expect(result.artifact?.outputs).toEqual([
      { key: 'controlPage', kind: 'scope', scope: 'pages.control' },
    ])
  })

  it('отклоняет hooks onMount, нацеленные на ручной runtime', () => {
    const result = compileCompositionSource(`
defineComposition({
  runtimes: {
    request: query('request').activateOn(manual()),
  },
  hooks: [onMount().run('request')],
})
`)
    expect(result.artifact).toBeNull()
    expect(result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'composition-hook-manual-target' }),
    ]))
  })
})
