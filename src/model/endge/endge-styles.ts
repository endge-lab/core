import type { StyleBlocksPayload, StyleJsonBlock } from '@/domain/types/styles.types'

import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { EndgeJsxAttr } from '@/domain/types/jsx.types'

/** Id тега <style>, в который подставляются скомпилированные стили домена. */
export const ENDGE_STYLES_ELEMENT_ID = 'endge-styles-injected'

/** Источник стилей для init (домен или аналог). */
export interface EndgeStylesDomainSource {
  getStyles(): Array<{ identity: string; styles: Record<string, unknown> }>
}

/**
 * Подмодуль компиляции стилей домена в CSS.
 * Преобразует блоки path + properties в селекторы и kebab-case свойства.
 */
export class EndgeStyles extends EndgeModule {
  /** camelCase → kebab-case */
  static camelToKebab(s: string): string {
    return s.replace(/([A-Z])/g, (m) => `-${m.toLowerCase()}`)
  }

  /** Свойства в camelCase → строки "key: value;" в kebab-case */
  static propertiesToDecls(properties: Record<string, string | number>): string[] {
    return Object.entries(properties).map(([k, v]) => {
      const key = EndgeStyles.camelToKebab(k)
      return `  ${key}: ${String(v).trim()};`
    })
  }

  /** Проверка, является ли ключ селектором "<type>:<id>". */
  static isSelectorKey(key: string): boolean {
    const idx = key.indexOf(':')
    if (idx <= 0) return false
    const t = key.slice(0, idx)
    return t === 'table'
      || t === 'column'
      || t === 'tag'
  }

  /** Преобразовать ключ селектора в CSS-селектор. */
  static selectorKeyToCss(key: string): string {
    const idx = key.indexOf(':')
    if (idx <= 0) return ''
    const type = key.slice(0, idx)
    const id = key.slice(idx + 1)
    switch (type) {
      case 'table':
        return `[${EndgeJsxAttr.ComponentId}="${id}"]`
      case 'tag':
        return id
          ? `.${EndgeJsxAttr.Tag}[${EndgeJsxAttr.TagIdentity}="${id}"]`
          : `.${EndgeJsxAttr.Tag}`
      case 'column':
        return id ? `[data-endge-column-id="${id}"]` : ''
      default:
        return ''
    }
  }

  /** Рекурсивно скомпилировать один JSON-блок в набор CSS-правил. */
  private compileJsonBlock(block: StyleJsonBlock, parentSelector: string | null): string[] {
    const rules: string[] = []
    for (const [key, value] of Object.entries(block)) {
      if (!EndgeStyles.isSelectorKey(key) || !value || typeof value !== 'object' || Array.isArray(value))
        continue

      const baseSel = EndgeStyles.selectorKeyToCss(key)
      if (!baseSel)
        continue
      const selector = parentSelector ? `${parentSelector} ${baseSel}` : baseSel

      const inner = value as Record<string, any>
      const props: Record<string, string | number> = {}
      const nestedBlocks: StyleJsonBlock[] = []

      for (const [k, v] of Object.entries(inner)) {
        if (EndgeStyles.isSelectorKey(k) && v && typeof v === 'object' && !Array.isArray(v)) {
          nestedBlocks.push({ [k]: v as object })
        }
        else if (typeof v === 'string' || typeof v === 'number') {
          props[k] = v
        }
      }

      const decls = EndgeStyles.propertiesToDecls(props)
      if (decls.length) {
        rules.push(`${selector} {\n${decls.join('\n')}\n}`)
      }

      for (const nb of nestedBlocks) {
        rules.push(...this.compileJsonBlock(nb, selector))
      }
    }
    return rules
  }

  /**
   * Скомпилировать payload стиля (поле styles сущности) в одну строку CSS.
   */
  compile(payload: StyleBlocksPayload): string {
    if (!Array.isArray(payload))
      return ''
    const rules: string[] = []
    for (const block of payload) {
      rules.push(...this.compileJsonBlock(block, null))
    }
    return rules.join('\n\n')
  }

  /**
   * Скомпилировать несколько стилей (например, по домену) в одну строку CSS.
   * @param items пары [identity, payload] для префиксации при отладке (опционально)
   */
  compileMany(
    items: Array<{ identity?: string; payload: StyleBlocksPayload }>,
  ): string {
    const parts: string[] = []
    for (const { identity, payload } of items) {
      const css = this.compile(payload)
      if (!css) continue
      if (identity) {
        parts.push(`/* ${identity} */`)
        parts.push(css)
      } else {
        parts.push(css)
      }
    }
    return parts.join('\n\n')
  }

  /**
   * Применить все стили домена в DOM: компиляция и вставка в <style id="...">.
   * Вызывать после загрузки домена (например из Endge.init).
   */
  init(): void
  init(domain: EndgeStylesDomainSource): void
  init(domain?: EndgeStylesDomainSource): void {
    if (typeof document === 'undefined') return
    if (!domain)
      return
    const items = domain.getStyles().map(s => ({
      identity: s.identity,
      payload: Array.isArray(s.styles) ? (s.styles as StyleBlocksPayload) : [],
    }))
    const css = this.compileMany(items)
    let el = document.getElementById(ENDGE_STYLES_ELEMENT_ID) as HTMLStyleElement | null
    if (!el) {
      el = document.createElement('style')
      el.id = ENDGE_STYLES_ELEMENT_ID
      document.head.appendChild(el)
    }
    el.textContent = css || '/* no styles */'
  }
}
