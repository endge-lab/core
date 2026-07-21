import { afterEach, describe, expect, it } from 'vitest'

import { RComposition } from '@/domain/entities/reflect/RComposition'
import { RStyle } from '@/domain/entities/reflect/RStyle'
import type { ProgramArtifact } from '@/domain/types/program/program.types'
import type { CompositionProgramPayload } from '@/domain/types/source/composition-source.types'
import type { RuntimeScopeHandle } from '@/domain/types/runtime/runtime-scope.types'
import { Endge } from '@/model/endge/kernel/endge'
import { compileEndgeCSS } from '@/model/services/style'

describe('Composition style scope integration', () => {
  afterEach(async () => {
    await Endge.runtime.reset()
    Endge.styles.reset()
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('acquires, suspends, resumes and releases scoped style resources', async () => {
    addStyle(101, 'project-theme', 'Text { color: red; }')
    addStyle(102, 'page-theme', 'Text { color: blue; }')
    const composition = new RComposition()
    composition.id = 103
    composition.identity = 'project-entry'
    composition.name = 'Project entry'
    Endge.domain.addComposition(composition)
    const payload: CompositionProgramPayload = {
      type: 'composition',
      sourceVersion: 1,
      activation: { mode: 'startup' },
      props: [],
      data: [],
      resources: [
        { name: 'projectTheme', path: 'projectTheme', scopePath: 'scope_default', kind: 'style', identity: 'project-theme', sourceOrder: 0 },
        { name: 'pageTheme', path: 'pages.pageTheme', scopePath: 'pages', kind: 'style', identity: 'page-theme', sourceOrder: 1 },
      ],
      scopes: [
        {
          name: 'scope_default', path: 'scope_default', parentPath: null,
          activationOverride: { mode: 'startup' }, effectiveActivation: { mode: 'startup' },
          resources: ['projectTheme'], runtimes: [], children: ['pages'], sourceOrder: 0,
        },
        {
          name: 'pages', path: 'pages', parentPath: 'scope_default',
          activationOverride: { mode: 'manual' }, effectiveActivation: { mode: 'manual' },
          resources: ['pages.pageTheme'], runtimes: [], children: [], sourceOrder: 1,
        },
      ],
      runtimes: [],
      hooks: [],
      outputs: [{ key: 'page', kind: 'scope', scope: 'pages' }],
      graph: { inputs: [], dataInputs: [], updates: [], publications: [], mounts: [] },
    }
    Endge.program.addArtifact(programArtifact('composition', 103, 'project-entry', payload))

    const session = await Endge.runtime.composition.mount('project-entry', { id: 'style-scope-session' })
    const page = session.output<RuntimeScopeHandle>('page')!
    expect(Endge.styles.getActivePlacements().map(item => item.artifactIdentity)).toEqual(['project-theme'])

    await page.activate()
    expect(Endge.styles.getActivePlacements().map(item => item.artifactIdentity)).toEqual(['project-theme', 'page-theme'])
    await page.pause()
    expect(Endge.styles.getActivePlacements().map(item => item.artifactIdentity)).toEqual(['project-theme'])
    await page.resume()
    expect(Endge.styles.getActivePlacements().map(item => item.artifactIdentity)).toEqual(['project-theme', 'page-theme'])
    await page.deactivate()
    expect(Endge.styles.getActivePlacements().map(item => item.artifactIdentity)).toEqual(['project-theme'])
    await session.unmount()
    expect(Endge.styles.getActivePlacements()).toEqual([])
  })
})

function addStyle(id: number, identity: string, source: string): void {
  const style = RStyle.fromPlain({ id, identity, name: identity, source })
  Endge.domain.addStyle(style)
  const stylesheet = compileEndgeCSS(source, { identity }).artifact!
  Endge.program.addArtifact(programArtifact('style', id, identity, {
    stylesheet,
    themes: [],
    dependencies: [],
  }))
}

function programArtifact<T>(
  entityType: 'composition' | 'style',
  id: number,
  identity: string,
  payload: T,
): ProgramArtifact<T> {
  return {
    ref: { entityType, id, identity },
    sourceHash: `test:${identity}`,
    compilerVersion: 'test',
    contextHash: 'test',
    status: 'valid' as const,
    diagnostics: [],
    dependencies: [],
    capabilities: ['compilable', 'executable'],
    metadata: { self: {}, nodes: [] },
    payload,
  }
}
