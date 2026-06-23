import { Raph } from '@endge/raph'
import { Endge } from '@/model/endge/endge'
import { ENDGE_LOG_LANES } from '@/model/config/debug'

export type RaphUpdateRunner = { stop: () => void; isRunning: () => boolean }

type AttrKind = 'date' | 'text' | 'int'

const ATTR_KIND: Record<string, AttrKind> = {
  STA: 'date',
  ETA: 'date',
  ATA: 'date',
  EON: 'date',
  AON: 'date',
  BestOn: 'date',
  BestTouch: 'date',

  ACTail: 'text',
  ACType: 'text',
  ACConfig: 'text',
  LatestDepartureStation: 'text',
  ArrivalGate: 'text',
  ArrivalPosition: 'text',
  ArrivalTerminal: 'text',
  ArrivalDispatcher: 'text',
  ArrivalModelType: 'text',

  ArrivalTaxi: 'int',
  ArrivalTaxiing: 'int',
}

function mulberry32(seed: number) {
  let t = seed >>> 0
  return () => {
    t += 0x6d2b79f5
    let x = Math.imul(t ^ (t >>> 15), 1 | t)
    x ^= x + Math.imul(x ^ (x >>> 7), 61 | x)
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296
  }
}

function genAttrValue(kind: AttrKind, rnd: () => number) {
  switch (kind) {
    case 'date': {
      const now = Date.now() + Math.floor((rnd() - 0.5) * 120_000) // ±60s
      return new Date(now).toISOString()
    }
    case 'int':
      return 5 + Math.floor(rnd() * 21) // 5..25
    case 'text': {
      const pool = [
        'EG035',
        'EG041',
        'DG11',
        'DG15',
        'BG106',
        'BG107',
        '321',
        '32A',
        '32B',
        '73H',
        'SU9',
        'C28Y142VVC28Y142',
        'C16Y167VVC16Y167',
        'C12Y75VVC12Y75',
        'SVO',
        'CrewUpdated',
        'Dispatcher#2',
        'I',
      ]
      return pool[Math.floor(rnd() * pool.length)]
    }
  }
}

function genLegFieldValue(field: string, rnd: () => number) {
  switch (field) {
    case 'carrier':
      return rnd() < 0.5 ? 'SU' : 'FV'
    case 'cancelled':
      return rnd() < 0.02
    case 'number':
      return 100 + Math.floor(rnd() * 5900)
    case 'date':
      return new Date().toISOString()
    case 'comment': {
      const msgs = [
        'ok',
        'delay check',
        'gate change',
        'boarding',
        'crew change',
        '-',
      ]
      return msgs[Math.floor(rnd() * msgs.length)]
    }
    default:
      return new Date().toISOString()
  }
}

export type StartOptions = {
  count: number
  templates: Set<string> | string[]
  vars?: Record<string, unknown>
  updatesPerSec: number
  seed?: number
}

export function startRaphUpdates(opts: StartOptions): RaphUpdateRunner {
  const dbg = Endge.debug

  const { count, updatesPerSec, vars = {}, seed = 12345 } = opts

  if (!Number.isFinite(count) || count <= 0) {
    throw new Error("startRaphUpdates: 'count' must be > 0")
  }
  if (!Number.isFinite(updatesPerSec) || updatesPerSec <= 0) {
    throw new Error("startRaphUpdates: 'updatesPerSec' must be > 0")
  }

  const templates = Array.isArray(opts.templates)
    ? opts.templates
    : Array.from(opts.templates)
  const rnd = mulberry32(seed)

  function pickNext(): { path: string; value: unknown; i: number } {
    let path = templates[Math.floor(rnd() * templates.length)]
    const i = Math.floor(rnd() * count)

    if (path.trim() === '$') {
      return { path: '$.heartbeat', value: Date.now(), i }
    }

    // items[name='X'] - добавить корректный leaf по типу
    const attrMatch = path.match(/items\[name=(['"])([^'"]+)\1\]$/)
    if (attrMatch) {
      const name = attrMatch[2] // <-- фикс: раньше брали кавычку
      const kind: AttrKind = ATTR_KIND[name] ?? 'text'
      const leaf =
        kind === 'date' ? 'dateTime' : kind === 'int' ? 'integer' : 'text'
      path = `${path}.${leaf}`
      return { path, value: genAttrValue(kind, rnd), i }
    }

    // legs[$i].field
    const legField = path.match(/\.legs\[\$?i\]\.([A-Za-z_]\w*)$/)?.[1]
    if (legField) {
      return { path, value: genLegFieldValue(legField, rnd), i }
    }

    return { path, value: new Date().toISOString(), i }
  }

  // -------- Планировщик «несколько апдейтов за тик» --------
  const ratePerMs = updatesPerSec / 1000
  let tokens = 0 // «аккумулятор» апдейтов
  let last = typeof performance !== 'undefined' ? performance.now() : Date.now()
  let running = true

  // Мягкий лимит, чтобы не блокировать кадр:
  //  ~в 4 раза больше номинала на кадр при 60 FPS.
  const MAX_BURST = Math.max(1, Math.ceil((updatesPerSec / 60) * 4))

  const rafLike = (cb: () => void) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(cb)
    else setTimeout(cb, 0)
  }

  const loop = () => {
    if (!running) return

    const now =
      typeof performance !== 'undefined' ? performance.now() : Date.now()
    const dt = now - last
    last = now

    // начисляем «токены» пропорционально времени
    tokens += dt * ratePerMs

    // сколько реально выполним за тик
    let toRun = Math.floor(tokens)
    if (toRun > MAX_BURST) toRun = MAX_BURST
    tokens -= toRun

    for (let k = 0; k < toRun; k++) {
      const { path, value, i } = pickNext()
      try {
        dbg.startSpan(ENDGE_LOG_LANES.SSE, 'SSE test')

        Raph.set(path, value, { vars: { ...vars, i } })

        dbg.endSpan()
      } catch {
        // игнорим ошибки, не роняем цикл
      }
    }

    rafLike(loop)
  }

  loop()

  return {
    stop: () => {
      running = false
    },
    isRunning: () => running,
  }
}
