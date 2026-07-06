import { Raph } from '@endge/raph'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'
import { Endge } from '@/model/endge/endge'

/**
 * Модуль применения внешних update-сообщений к runtime state.
 */
export class EndgeUpdates extends EndgeModule {
  /**
   * Применяет сообщение обновления по профилю из настроек домена.
   */
  public applyUpdateForProfile(
    profileIdentity: string,
    message: unknown,
    opts: { vars?: Record<string, string> } = {},
  ): number {
    const settings = Endge.domain.getSetting('general')
    if (!settings)
      return 0

    const profile = settings.getUpdateProfile(profileIdentity)
    if (!profile)
      return 0

    const typeSegs = settings.getUpdateTypePathSegs(profileIdentity)
    if (!typeSegs?.length)
      return 0

    const events: any[] = Array.isArray(message)
      ? message.filter(e => e && typeof e === 'object')
      : (message && typeof message === 'object' ? [message] : [])

    if (!events.length)
      return 0

    let applied = 0

    for (const root of events) {
      const eventType = this.getBySegs(root, typeSegs)
      const eventTypeStr = eventType != null ? String(eventType) : undefined

      Endge.events.emitEvent('updates:message', {
        type: eventTypeStr,
        message: root,
      })

      if (!eventTypeStr)
        continue

      const handler = settings.getUpdateHandler(profileIdentity, eventTypeStr)
      if (!handler)
        continue

      const op = String(handler.op ?? 'set').toLowerCase() // set | create | delete
      const schema: any = handler.jsonSchema ?? {}
      const vars: Record<string, string> = { ...(opts.vars ?? {}) }

      // 1) vars
      if (schema.vars && typeof schema.vars === 'object') {
        for (const key of Object.keys(schema.vars)) {
          if (key in vars)
            continue
          const fromPath = String(schema.vars[key] ?? '')
          const val = fromPath ? this.getByPath(root, fromPath) : undefined
          vars[key] = val != null ? String(val) : ''
        }
      }

      // 2) mappings
      const mappings: any[] = Array.isArray(schema.mappings) ? schema.mappings : []

      // ---------------------------
      // DELETE
      // ---------------------------
      if (op === 'delete') {
        const deleted = this.applyDelete(profileIdentity, profile, handler, mappings, vars)
        applied += deleted
        continue
      }

      // ---------------------------
      // CREATE (ensure exists)
      // ---------------------------
      if (op === 'create') {
        // если create идёт через селектор, гарантируем элемент в массиве
        this.ensureCreateTargetsExist(mappings, vars)
      }

      // ---------------------------
      // SET / CREATE: apply mappings
      // ---------------------------
      for (const map of mappings) {
        const fromPath = String(map?.from ?? '')
        const toRaw = String(map?.to ?? '')
        if (!fromPath || !toRaw)
          continue

        const value = this.getByPath(root, fromPath)
        const to = this.applyVars(toRaw, vars)

        Raph.set(to, value)
        applied++
      }
    }

    if (applied > 0) {
      Endge.events.emitEvent('updates:applied', {
        identity: profileIdentity,
        count: applied,
      })
    }

    return applied
  }

  // ---------------- private ----------------

  /**
   * Применяет Delete.
   */
  private applyDelete(
    profileIdentity: string,
    profile: any,
    handler: any,
    mappings: any[],
    vars: Record<string, string>,
  ): number {
    // Вариант A: delete явно задан через schema.delete.to (если решишь добавить в будущем)
    const schema: any = handler?.jsonSchema ?? {}
    const explicitTo = String(schema?.delete?.to ?? '')
    if (explicitTo) {
      const to = this.applyVars(explicitTo, vars)
      return this.deleteByPath(to, vars) ? 1 : 0
    }

    // Вариант B: если mappings есть - удаляем по каждому to (редко, но поддержим)
    if (Array.isArray(mappings) && mappings.length > 0) {
      let c = 0
      for (const map of mappings) {
        const toRaw = String(map?.to ?? '')
        if (!toRaw)
          continue
        const to = this.applyVars(toRaw, vars)
        if (this.deleteByPath(to, vars))
          c++
      }
      return c
    }

    // Вариант C (как у тебя сейчас): mappings нет -> пытаемся вывести base target из соседних set/create
    const inferred = this.inferDeleteTargetFromProfile(profile, vars)
    if (!inferred)
      return 0

    return this.deleteByPath(inferred, vars) ? 1 : 0
  }

  /**
   * Ищем первый "to" у set/create, обрезаем ".field" - получаем "$store.items[id=$i]"
   */
  private inferDeleteTargetFromProfile(profile: any, vars: Record<string, string>): string | null {
    const fields: any[] = Array.isArray(profile?.fields) ? profile.fields : []
    for (const f of fields) {
      const op = String(f?.op ?? 'set').toLowerCase()
      if (op !== 'set' && op !== 'create')
        continue

      const schema: any = f?.jsonSchema ?? {}
      const mappings: any[] = Array.isArray(schema?.mappings) ? schema.mappings : []
      for (const m of mappings) {
        const toRaw = String(m?.to ?? '')
        if (!toRaw)
          continue

        const to = this.applyVars(toRaw, vars)

        // хотим base: "$store.items[id=...]" (без ".prop")
        const base = this.stripTrailingProp(to)
        if (base)
          return base
      }
    }
    return null
  }

  /**
   * Внутренний helper модуля: strip Trailing Prop.
   */
  private stripTrailingProp(to: string): string | null {
    // если есть "].xxx" или ".xxx" - отрежем хвост после последней "."
    // но не ломаем случаи, где точка внутри переменных не актуальна уже после applyVars
    const s = String(to ?? '')
    if (!s)
      return null

    // если путь заканчивается на "]" - уже base
    if (s.endsWith(']'))
      return s

    const lastDot = s.lastIndexOf('.')
    if (lastDot === -1)
      return s

    return s.slice(0, lastDot)
  }

  /**
   * Для create: если mappings содержат "$store.items[id=$i].x",
   * то гарантируем, что items содержит объект с id=$i.
   */
  private ensureCreateTargetsExist(mappings: any[], vars: Record<string, string>): void {
    const arr = Array.isArray(mappings) ? mappings : []
    for (const m of arr) {
      const toRaw = String(m?.to ?? '')
      if (!toRaw)
        continue

      const to = this.applyVars(toRaw, vars)

      const sel = this.parseSelectorPath(to)
      if (!sel)
        continue

      // basePath - это путь до массива: "$store.items"
      // selectorKey/Val - "id" / "123"
      // если записи нет - добавим
      const cur = Raph.get(sel.basePath)
      if (!Array.isArray(cur))
        continue

      const exists = cur.some((x: any) => x && String(x?.[sel.selectorKey]) === sel.selectorVal)
      if (exists)
        continue

      const next = [...cur, { [sel.selectorKey]: sel.selectorVal }]
      Raph.set(sel.basePath, next)
    }
  }

  /**
   * Универсальное удаление:
   * - если путь содержит селектор "$store.items[id=123]" - удаляем элемент массива
   * - если "$store.items[id=123].field" - удаляем field у найденного элемента
   * - если обычный "a.b.c" - delete key в объекте
   */
  private deleteByPath(to: string, _vars: Record<string, string>): boolean {
    const sel = this.parseSelectorPath(to)
    if (sel) {
      const cur = Raph.get(sel.basePath)
      if (!Array.isArray(cur))
        return false

      const idx = cur.findIndex((x: any) => x && String(x?.[sel.selectorKey]) === sel.selectorVal)
      if (idx < 0)
        return false

      // delete field in element
      if (sel.restPath) {
        const next = [...cur]
        const el = { ...(next[idx] ?? {}) }
        this.deleteByDotPath(el, sel.restPath)
        next[idx] = el
        Raph.set(sel.basePath, next)
        return true
      }

      // delete element
      const next = [...cur]
      next.splice(idx, 1)
      Raph.set(sel.basePath, next)
      return true
    }

    // обычный dot-path
    const parentPath = this.parentPath(to)
    const leaf = this.leafKey(to)
    if (!parentPath || !leaf)
      return false

    const parent = Raph.get(parentPath)
    if (parent == null || typeof parent !== 'object')
      return false

    // array index
    const asIndex = Number(leaf)
    if (Array.isArray(parent) && Number.isInteger(asIndex)) {
      const next = [...parent]
      if (asIndex < 0 || asIndex >= next.length)
        return false
      next.splice(asIndex, 1)
      Raph.set(parentPath, next)
      return true
    }

    // object key
    const next = { ...(parent as any) }
    if (!(leaf in next))
      return false
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete (next as any)[leaf]
    Raph.set(parentPath, next)
    return true
  }

  /**
   * Внутренний helper модуля: delete By Dot Path.
   */
  private deleteByDotPath(obj: any, path: string): void {
    const segs = String(path).split('.').filter(Boolean)
    if (segs.length === 0)
      return
    const last = segs.pop()!
    let cur = obj
    for (const s of segs) {
      if (cur == null || typeof cur !== 'object')
        return
      cur = cur[s]
    }
    if (cur == null || typeof cur !== 'object')
      return
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
    delete cur[last]
  }

  /**
   * Парсим "$store.items[id=123].field.sub"
   */
  private parseSelectorPath(to: string): null | {
    basePath: string
    selectorKey: string
    selectorVal: string
    restPath: string | null
  } {
    const s = String(to ?? '')
    // base [key=value] .rest
    // прим: "$store.items[id=123].name"
    const m = s.match(/^(.*)\[([^\]=]+)=([^\]]+)\](?:\.(.*))?$/)
    if (!m)
      return null

    const basePath = String(m[1] ?? '').trim()
    const selectorKey = String(m[2] ?? '').trim()
    const selectorVal = String(m[3] ?? '').trim()
    const restPath = (m[4] != null && String(m[4]).trim().length) ? String(m[4]).trim() : null

    if (!basePath || !selectorKey)
      return null

    return { basePath, selectorKey, selectorVal, restPath }
  }

  /**
   * Внутренний helper модуля: parent Path.
   */
  private parentPath(path: string): string | null {
    const s = String(path ?? '')
    const i = s.lastIndexOf('.')
    if (i <= 0)
      return null
    return s.slice(0, i)
  }

  /**
   * Внутренний helper модуля: leaf Key.
   */
  private leafKey(path: string): string | null {
    const s = String(path ?? '')
    const i = s.lastIndexOf('.')
    if (i === -1)
      return null
    const leaf = s.slice(i + 1)
    return leaf.length ? leaf : null
  }

  /**
   * Возвращает By Segs.
   */
  private getBySegs(obj: any, segs: string[]): any {
    let cur: any = obj
    for (const key of segs) {
      if (cur == null)
        return undefined
      cur = cur[key]
    }
    return cur
  }

  /**
   * Возвращает By Path.
   */
  private getByPath(obj: any, path: string): any {
    return path.split('.').reduce((acc, key) => acc?.[key], obj)
  }

  /**
   * Применяет Vars.
   */
  private applyVars(path: string, vars: Record<string, string>): string {
    let out = path
    for (const k in vars) {
      out = out.replaceAll(`$${k}`, vars[k])
    }
    return out
  }
}
