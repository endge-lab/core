type ContextLevel = 'tenant' | 'project' | 'page'
type OverrideMode = 'merge' | 'replace' | 'disable'

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<any>
    ? T[K]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K]
}

interface FacetOverride<T extends object> {
  mode: OverrideMode
  patch?: DeepPartial<T>
  value?: T
}

interface ContextFacets<P extends object, B extends object> {
  presentation: P
  behavior: B
}

abstract class ConfigurationContext<P extends object, B extends object> {
  readonly id: string
  readonly level: ContextLevel

  protected parent: ConfigurationContext<P, B> | null
  protected own: {
    presentation: DeepPartial<P>
    behavior: DeepPartial<B>
  }

  protected overrides: {
    presentation: FacetOverride<P> | null
    behavior: FacetOverride<B> | null
  } = {
    presentation: null,
    behavior: null,
  }

  constructor(params: {
    id: string
    level: ContextLevel
    parent?: ConfigurationContext<P, B> | null
    own?: Partial<{ presentation: DeepPartial<P>; behavior: DeepPartial<B> }>
  }) {
    this.id = params.id
    this.level = params.level
    this.parent = params.parent ?? null
    this.own = {
      presentation: params.own?.presentation ?? {},
      behavior: params.own?.behavior ?? {},
    }
  }

  setParent(parent: ConfigurationContext<P, B> | null): void {
    this.parent = parent
  }

  patchPresentation(patch: DeepPartial<P>): void {
    this.own.presentation = ConfigurationContext.deepMerge(this.own.presentation, patch)
  }

  patchBehavior(patch: DeepPartial<B>): void {
    this.own.behavior = ConfigurationContext.deepMerge(this.own.behavior, patch)
  }

  setPresentationOverride(override: FacetOverride<P> | null): void {
    this.overrides.presentation = override
  }

  setBehaviorOverride(override: FacetOverride<B> | null): void {
    this.overrides.behavior = override
  }

  getEffective(): ContextFacets<P, B> {
    return {
      presentation: this.getEffectivePresentation(),
      behavior: this.getEffectiveBehavior(),
    }
  }

  getEffectivePresentation(): P {
    return this.resolveFacet('presentation', this.emptyPresentation)
  }

  getEffectiveBehavior(): B {
    return this.resolveFacet('behavior', this.emptyBehavior)
  }

  protected abstract emptyPresentation(): P
  protected abstract emptyBehavior(): B

  private resolveFacet<T extends object>(
    kind: 'presentation' | 'behavior',
    emptyFactory: () => T,
  ): T {
    const chain = this.getChain()
    let effective = emptyFactory()

    for (const ctx of chain) {
      const ownPatch = ctx.own[kind] as DeepPartial<T>
      effective = ConfigurationContext.deepMerge(effective, ownPatch)

      const ov = ctx.overrides[kind] as FacetOverride<T> | null
      if (!ov) continue

      if (ov.mode === 'disable') {
        effective = emptyFactory()
      } else if (ov.mode === 'replace') {
        effective = ov.value ?? ConfigurationContext.deepMerge(emptyFactory(), (ov.patch ?? {}) as DeepPartial<T>)
      } else {
        effective = ConfigurationContext.deepMerge(effective, (ov.patch ?? {}) as DeepPartial<T>)
      }
    }

    return effective
  }

  private getChain(): Array<ConfigurationContext<P, B>> {
    const chain: Array<ConfigurationContext<P, B>> = []
    let cursor: ConfigurationContext<P, B> | null = this
    while (cursor) {
      chain.unshift(cursor)
      cursor = cursor.parent
    }
    return chain
  }

  private static deepMerge<T>(base: T, patch: DeepPartial<T>): T {
    if (patch == null) return base
    if (Array.isArray(base) || Array.isArray(patch)) return (patch as T) ?? base
    if (typeof base !== 'object' || typeof patch !== 'object') return (patch as T) ?? base

    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
    for (const key of Object.keys(patch as Record<string, unknown>)) {
      const b = out[key]
      const p = (patch as Record<string, unknown>)[key]
      if (p && b && typeof b === 'object' && typeof p === 'object' && !Array.isArray(b) && !Array.isArray(p)) {
        out[key] = ConfigurationContext.deepMerge(b, p as any)
      } else {
        out[key] = p
      }
    }
    return out as T
  }
}

/* ===== Пример специализаций ===== */

type UIFacet = {
  theme: Record<string, string>
  layout: { sidebar: boolean; density: 'compact' | 'normal' }
  components: Record<string, { visible: boolean; title?: string }>
}

type BehaviorFacet = {
  contracts: Record<string, { enabled: boolean; version?: string }>
  handlers: Record<string, string[]> // event -> action refs
}

class TenantContext extends ConfigurationContext<UIFacet, BehaviorFacet> {
  constructor(id: string, parent: ConfigurationContext<UIFacet, BehaviorFacet> | null = null) {
    super({ id, level: 'tenant', parent })
  }
  protected emptyPresentation(): UIFacet {
    return { theme: {}, layout: { sidebar: true, density: 'normal' }, components: {} }
  }
  protected emptyBehavior(): BehaviorFacet {
    return { contracts: {}, handlers: {} }
  }
}

class ProjectContext extends ConfigurationContext<UIFacet, BehaviorFacet> {
  constructor(id: string, parent: ConfigurationContext<UIFacet, BehaviorFacet> | null = null) {
    super({ id, level: 'project', parent })
  }
  protected emptyPresentation(): UIFacet {
    return { theme: {}, layout: { sidebar: true, density: 'normal' }, components: {} }
  }
  protected emptyBehavior(): BehaviorFacet {
    return { contracts: {}, handlers: {} }
  }
}

class PageContext extends ConfigurationContext<UIFacet, BehaviorFacet> {
  constructor(id: string, parent: ConfigurationContext<UIFacet, BehaviorFacet> | null = null) {
    super({ id, level: 'page', parent })
  }
  protected emptyPresentation(): UIFacet {
    return { theme: {}, layout: { sidebar: true, density: 'normal' }, components: {} }
  }
  protected emptyBehavior(): BehaviorFacet {
    return { contracts: {}, handlers: {} }
  }
}
