import { faker } from '@faker-js/faker'
import { RField } from '@/domain/entities/reflect/RField'
import { Endge } from '@/model/endge/endge'

function generateTypeValue(
  nameOverride?: string,
  typeOverride?: string,
): object {
  const type =
    typeOverride ||
    faker.helpers.arrayElement(['text', 'integer', 'bool', 'dateTime'])

  const base = {
    id: faker.string.uuid(),
    name: nameOverride || faker.lorem.word(),
    type,
    timestamp: faker.date.recent().toISOString(),
  }

  switch (type) {
    case 'text':
      return { ...base, text: faker.lorem.sentence() }
    case 'integer':
      return { ...base, integer: faker.number.int({ min: 1, max: 100 }) }
    case 'bool':
      return { ...base, bool: faker.datatype.boolean() }
    case 'dateTime':
      return { ...base, dateTime: faker.date.future().toISOString() }
    default:
      return base
  }
}

export function generatePassengers(count: number): object[] {
  return Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
    hasBaggage: faker.datatype.boolean(),
  }))
}

export function generateDrivers(count: number): object[] {
  return Array.from({ length: count }, () => ({
    id: faker.string.uuid(),
    firstName: faker.person.firstName(),
    lastName: faker.person.lastName(),
  }))
}

export function generateBusRoute(drivers: any[], passengers: any[]): object {
  const routePassengers = faker.helpers.arrayElements(passengers, {
    min: 1,
    max: 5,
  })

  const departure = faker.date.soon()
  const arrival = faker.date.soon({ days: 2 })

  const attributes = [
    generateTypeValue('departureTime', 'dateTime'),
    generateTypeValue('arrivalTime', 'dateTime'),
    generateTypeValue('from', 'text'),
    generateTypeValue('to', 'text'),
    ...Array.from({ length: 2 }, () => generateTypeValue()),
  ]

  // Установка значений для времени
  attributes.find((a) => a.name === 'departureTime')!.dateTime =
    departure.toISOString()
  attributes.find((a) => a.name === 'arrivalTime')!.dateTime =
    arrival.toISOString()

  // Установка городов отправления и прибытия
  attributes.find((a) => a.name === 'from')!.text = faker.location
    .city()
    .slice(0, 16)
  attributes.find((a) => a.name === 'to')!.text = faker.location
    .city()
    .slice(0, 16)

  return {
    id: faker.string.uuid(),
    number: `B-${faker.number.int({ min: 100, max: 999 })}`,
    passengerCount: routePassengers.length,
    driver: faker.helpers.arrayElement(drivers),
    passengers: routePassengers,
    attributes,
  }
}

export function generateAllBusRoutes(count: number): object[] {
  const passengers = generatePassengers(20)
  const drivers = generateDrivers(5)

  return Array.from({ length: count }, () =>
    generateBusRoute(drivers, passengers),
  )
}

/**
 * Генерирует данные для inputFields, с вложенной структурой.
 *
 * @param inputFields Список входных полей.
 * @param maxDepth Максимальная глубина вложенности.
 */
export function generateMockInputData(
  inputFields: Record<string, RField>,
  maxDepth: number = 3,
): Record<string, any> {
  // console.debug('[generateMockInputData] start', { inputFields, maxDepth })

  const result: Record<string, any> = {}

  for (const field of Object.values(inputFields)) {
    // console.debug('[generateMockInputData] Generating field', field)
    result[field.name] = generateMockValue(field, 0, maxDepth)
  }

  // console.debug('[generateMockInputData] result', result)
  return result
}

/**
 * Рекурсивно генерирует значение для поля.
 */
export function generateMockValue(
  field: RField,
  currentDepth: number,
  maxDepth: number,
): any {
  // console.debug('[generateMockValue] Start', { field, currentDepth, maxDepth })

  if (currentDepth > maxDepth) {
    // console.debug('[generateMockValue] Max depth reached', { field })
    return null
  }

  if (field.isArray) {
    // console.debug('[generateMockValue] Field is array', { field })
    const length = faker.number.int({ min: 1, max: 2 })
    const items = Array.from({ length }, () =>
      generateMockValue(
        new RField(field.name, field.type, false, field.optional, field.params),
        currentDepth + 1,
        maxDepth,
      ),
    )
    // console.debug('[generateMockValue] Array generated', items)
    return items
  }

  if (Endge.domain.isPrimitiveName(field.type)) {
    // console.debug('[generateMockValue] Field is primitive', { field })
    const fieldName = field.name.toLowerCase()
    let value: any

    if (fieldName.includes('name')) {
      value = faker.person.fullName()
    } else if (fieldName.includes('email')) {
      value = faker.internet.email()
    } else if (fieldName.includes('date')) {
      value = faker.date.recent().toISOString()
    } else if (fieldName.includes('phone')) {
      value = faker.phone.number()
    } else if (fieldName.includes('city')) {
      value = faker.location.city()
    } else if (fieldName.includes('address')) {
      value = faker.location.streetAddress()
    } else {
      switch (field.type) {
        case 'ID':
          value = faker.lorem.words(2)
          break
        case 'String':
          value = faker.lorem.words(2)
          break
        case 'Number':
          value = faker.number.int({ min: 1, max: 1000 })
          break
        case 'Boolean':
          value = faker.datatype.boolean()
          break
        case 'DateTime':
          value = faker.date.recent().toISOString()
          break
        default:
          value = null
      }
    }

    // console.debug('[generateMockValue] Primitive generated', { field, value })
    return value
  }

  const complexType = Endge.domain.getType(field.type)
  if (complexType) {
    // console.debug('[generateMockValue] Found complex type', complexType)
    const nestedObj: Record<string, any> = {}

    if (!(complexType.fields instanceof Map)) {
      console.error('[generateMockValue] Expected fields to be a Map', {
        field,
        complexType,
      })
      return null
    }

    for (const nestedField of complexType.fields.values()) {
      // Дополнительная проверка структуры nestedField
      if (!nestedField.name || !nestedField.type) {
        console.error('[generateMockValue] Invalid nested field', {
          nestedField,
        })
        continue // Пропускаем некорректное поле
      }
      // console.debug('[generateMockValue] Processing nested field', {
      //   nestedField,
      // })
      const generatedValue = generateMockValue(
        nestedField,
        currentDepth + 1,
        maxDepth,
      )
      nestedObj[nestedField.name] = generatedValue
    }

    // console.debug('[generateMockValue] Nested object generated', nestedObj)
    return nestedObj
  }

  // console.debug('[generateMockValue] Unknown type, returning null', { field })
  return null
}
