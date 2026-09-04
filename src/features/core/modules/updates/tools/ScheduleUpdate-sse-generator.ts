// utils/runUpdates.ts
import { Raph } from '@endge/raph'
import { Endge } from '@/features/core/kernel/endge'

type ScheduleRecord = Record<string, unknown>

interface PatchField {
  key: string
  makeValue: (cur: unknown) => unknown
}

const MESSAGES_PER_SECOND: number = 5
const PROFILE_IDENTITY: string = 'configurator-updates'
const STORE_PATH: string = 'queries.schedule'

function pick<T>(arr: readonly T[]): T {
  return arr[(Math.random() * arr.length) | 0] as T
}

function randInt(min: number, max: number): number {
  return min + ((Math.random() * (max - min + 1)) | 0)
}

function randomDaysOfWeek(): string {
  const cnt = randInt(1, 7)
  const set = new Set<number>()
  while (set.size < cnt) {
    set.add(randInt(1, 7))
  }
  return [...set].sort((a, b) => a - b).join(',')
}

function buildPatchFields(): PatchField[] {
  return [
    { key: 'daysOfWeek', makeValue: () => randomDaysOfWeek() },
    // { key: 'flightCarrier', makeValue: () => randomCarrier() },
    // { key: 'flightNumber', makeValue: (cur) => randomFlightNumber(cur) },
    // { key: 'arrivalStation', makeValue: () => randomStation() },
    // { key: 'departureStation', makeValue: () => randomStation() },
    // { key: 'arrivalTerminal', makeValue: () => randomTerminal() },
    // { key: 'departureTerminal', makeValue: () => randomTerminal() },
    // { key: 'departureTime', makeValue: () => randomLocalTime() },
    // { key: 'arrivalTime', makeValue: () => randomLocalTime() },
    // { key: 'serviceType', makeValue: () => randomServiceType() },
    // { key: 'aircraftType', makeValue: () => randomAircraftType() },
    // { key: 'active', makeValue: () => randomBool() },
  ]
}

function getIdsFromStore(): string[] {
  const items: unknown = Raph.get(`${STORE_PATH}.items`)
  if (!Array.isArray(items)) {
    return []
  }
  const ids: string[] = []
  for (const it of items as any[]) {
    const id: unknown = it?.id
    if (typeof id === 'string' && id) {
      ids.push(id)
    }
  }
  return ids
}

function getRecordById(id: string): ScheduleRecord | undefined {
  const path = `${STORE_PATH}.items[id=${id}]`
  const rec: unknown = Raph.get(path)
  if (!rec || typeof rec !== 'object') {
    return undefined
  }
  return rec as ScheduleRecord
}

/**
 * Эмуляция потока ScheduleUpdated:
 * - генерирует MESSAGES_PER_SECOND сообщений
 * - в каждом сообщении меняет ровно одно поле в record
 * - применяет через Endge.updates.applyUpdateForProfile()
 *
 * @returns stop() функция
 */
export function runUpdates(): () => void {
  const ids: string[] = getIdsFromStore()
  if (ids.length === 0) {
    return () => {}
  }

  const intervalMs: number = Math.max(1, (1000 / MESSAGES_PER_SECOND) | 0)
  const patchFields: PatchField[] = buildPatchFields()

  let stopped = false
  let emitted = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const tick = (): void => {
    if (stopped) {
      return
    }

    const id: string = pick(ids)
    const cur: ScheduleRecord | undefined = getRecordById(id)

    const field: PatchField = pick(patchFields)
    const nextValue: unknown = field.makeValue(cur?.[field.key])

    const message = {
      eventInfo: {
        name: 'ScheduleUpdated',
        timestamp: new Date().toISOString(),
      },
      messageIdentity: { id },
      record: {
        id,
        [field.key]: nextValue,
      },
    }

    Endge.updates.applyUpdateForProfile(PROFILE_IDENTITY, message, {
      vars: { store: STORE_PATH },
    })

    emitted++
    timer = setTimeout(tick, intervalMs)
  }

  timer = setTimeout(tick, intervalMs)

  return (): void => {
    stopped = true
    if (timer) {
      clearTimeout(timer)
    }
    timer = null
    void emitted
  }
}
