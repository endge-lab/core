import { afterEach, describe, expect, it } from 'vitest'

import { Endge } from '@/features/core/kernel/endge'
import { RStyle } from '@/features/core/modules/domain/entities/RStyle'
import { EndgeUI_Module } from '@/features/core/modules/ui/EndgeUI_Module'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'
import { prepareTestCompilerContext } from '@/test/helpers/compiler-context'

describe('жизненный цикл программы EndgeCSS', () => {
  afterEach(() => {
    Endge.configuration.reset()
    Endge.program.clear()
    Endge.domain.reset()
  })

  it('регистрирует стратегии Source и предоставляет типизированный артефакт стиля', () => {
    prepareCompilerContext()
    const source = '@theme night { --surface: #111; }\nText { color: white; }'
    expect(Endge.source.resolveStrategy('style')?.id).toBe('source:style')
    expect(Endge.source.resolveLanguageStrategy('style')?.syntax.extensions).toContain('.endgecss')

    Endge.program.beginCompile('test')
    const style = RStyle.fromPlain({ id: 71, identity: 'project-theme', name: 'Project theme', source })
    const artifact = Endge.compiler.buildStyle(style)

    expect(artifact.status).toBe('valid')
    expect(Endge.program.getStyleArtifact('project-theme')?.payload.themes).toEqual(['night'])
    expect(Endge.program.getStyleArtifact(71)?.payload.stylesheet.rules).toHaveLength(1)
  })

  it('переносит meta.user в артефакт и учитывает metadata в fingerprint', () => {
    prepareCompilerContext()
    const style = RStyle.fromPlain({
      id: 72,
      identity: 'metadata-theme',
      name: 'Metadata theme',
      source: 'Text { color: white; }',
      meta: {
        user: { 'company.feature': { owner: 'operations' } },
        configurator: { panel: 'source' },
      },
    })

    Endge.program.beginCompile('test')
    const first = Endge.compiler.buildStyle(style)
    expect(first.metadata.self).toEqual({ 'company.feature': { owner: 'operations' } })

    style.meta = {
      ...style.meta,
      user: { 'company.feature': { owner: 'platform' } },
    }
    const second = Endge.compiler.buildStyle(style)

    expect(second.metadata.self).toEqual({ 'company.feature': { owner: 'platform' } })
    expect(second.sourceHash).not.toBe(first.sourceHash)
    expect(style.meta.configurator).toEqual({ panel: 'source' })
  })

  it('использует каталог Workspace вместо публикации каждой темы из Source стиля', () => {
    Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
    Endge.context.setCurrentTheme('light')
    const ui = new EndgeUI_Module()
    ui.start()
    expect(ui.availableThemes).toEqual(['light', 'dark'])
    ui.setTheme('night')
    expect(ui.theme).toBe('light')
    ui.setTheme('dark')
    expect(ui.theme).toBe('dark')
    ui.reset()
  })
})

function prepareCompilerContext(): void {
  prepareTestCompilerContext()
}
