import { describe, expect, it } from 'vitest'

import { RStyle } from '@/domain/entities/reflect/RStyle'
import { Endge } from '@/model/endge/kernel/endge'
import { EndgeUI } from '@/model/endge/ui/endge-ui'

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

  it('owns dynamic themes without changing the static compatibility classes contract', () => {
    const ui = new EndgeUI()
    ui.registerThemes('style:project', ['night', 'contrast'])
    expect(ui.availableThemes).toEqual(expect.arrayContaining(['light', 'dark', 'night', 'contrast']))
    ui.setTheme('night')
    expect(ui.theme).toBe('night')
    ui.unregisterThemes('style:project')
    expect(ui.theme).toBe('light')
  })
})
