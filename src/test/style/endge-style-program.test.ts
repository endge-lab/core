import { describe, expect, it } from 'vitest'

import { RStyle } from '@/domain/entities/reflect/RStyle'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeUI } from '@/model/endge/ui/endge-ui'
import { TEST_ENDGE_WORKSPACE } from '@/test/fixtures/endge-workspace'

describe('EndgeCSS program lifecycle', () => {
  it('registers source strategies and provides a typed style artifact', () => {
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

  it('uses the workspace catalog instead of exposing every theme found in style source', () => {
    Endge.workspace.apply(TEST_ENDGE_WORKSPACE)
    Endge.context.setCurrentTheme('light')
    const ui = new EndgeUI()
    ui.start()
    expect(ui.availableThemes).toEqual(['light', 'dark'])
    ui.setTheme('night')
    expect(ui.theme).toBe('light')
    ui.setTheme('dark')
    expect(ui.theme).toBe('dark')
    ui.reset()
  })
})
