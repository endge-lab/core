import type {
  EndgeStyleMatchNode,
  EndgeStyleResolvedDeclaration,
  EndgeStyleSheetArtifact,
  EndgeStyleTargetProfile,
} from '@/domain/types/style'
import type { EndgeStyleProgramPayload, ProgramArtifact } from '@/domain/types/program'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/kernel/endge'
import { resolveEndgeStyleDeclarations } from '@/model/services/style'

export interface EndgeStyleResolver {
  readonly target: EndgeStyleTargetProfile
  resolve: (node: EndgeStyleMatchNode, theme?: string) => Record<string, EndgeStyleResolvedDeclaration>
}

/** Neutral style registry. Renderer materializers consume its artifacts/resolver. */
export class EndgeStyles extends EndgeModule {
  private _unsubscribeProgram: (() => void) | null = null
  private _themeOwners = new Set<string>()

  public override start(): void {
    if (this._unsubscribeProgram) return
    this._refreshThemes()
    this._unsubscribeProgram = Endge.program.subscribe(() => {
      this._refreshThemes()
      this.notify()
    })
  }

  /** Returns valid global artifacts in deterministic effective source order. */
  public getActiveArtifacts(): EndgeStyleSheetArtifact[] {
    const rankByIdentity = new Map(
      Endge.domain.getStyles()
        .filter(style => style.active !== false && !style.deletedAt)
        .sort((left, right) => {
          const rank = (style: typeof left) => style.isSystem ? 0 : style.inherited ? 1 : 2
          return rank(left) - rank(right) || left.identity.localeCompare(right.identity)
        })
        .map((style, index) => [style.identity, index]),
    )
    return Endge.program.getArtifacts()
      .filter((artifact): artifact is ProgramArtifact<EndgeStyleProgramPayload> => artifact.ref.entityType === 'style' && artifact.status !== 'error')
      .sort((left, right) => (rankByIdentity.get(left.ref.identity) ?? Number.MAX_SAFE_INTEGER) - (rankByIdentity.get(right.ref.identity) ?? Number.MAX_SAFE_INTEGER))
      .map(artifact => artifact.payload.stylesheet)
  }

  /** Creates a renderer-neutral resolver over the active program snapshot. */
  public createResolver(target: EndgeStyleTargetProfile): EndgeStyleResolver {
    const artifacts = this.getActiveArtifacts()
    return {
      target,
      resolve: (node, theme = Endge.ui.theme) => resolveEndgeStyleDeclarations(artifacts, node, target, theme),
    }
  }

  public override reset(): void {
    this._unsubscribeProgram?.()
    this._unsubscribeProgram = null
    for (const owner of this._themeOwners)
      Endge.ui.unregisterThemes(owner)
    this._themeOwners.clear()
  }

  private _refreshThemes(): void {
    const nextOwners = new Set<string>()
    for (const artifact of Endge.program.getArtifacts()) {
      if (artifact.status === 'error') continue
      const stylePayload = artifact.ref.entityType === 'style'
        ? artifact.payload as EndgeStyleProgramPayload
        : null
      const componentStyle = artifact.ref.entityType === 'component-sfc'
        ? (artifact.payload as { ir?: { style?: EndgeStyleSheetArtifact | null } | null }).ir?.style
        : null
      const themes = stylePayload?.themes ?? componentStyle?.themes.map(theme => theme.id)
      if (!themes) continue
      const owner = artifact.ref.entityType === 'style'
        ? `style:${artifact.ref.identity}`
        : `component-style:${artifact.ref.identity}`
      Endge.ui.registerThemes(owner, themes)
      nextOwners.add(owner)
    }
    for (const owner of this._themeOwners) {
      if (!nextOwners.has(owner)) Endge.ui.unregisterThemes(owner)
    }
    this._themeOwners = nextOwners
  }
}
