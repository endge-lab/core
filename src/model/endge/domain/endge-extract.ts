import type { RField } from '@/domain/entities/reflect/RField'
import type { DataPath } from '@endge/raph'
import type { RQuery } from '@/domain/entities/reflect/RQuery'
import type { EndgeDomain } from '@/model/endge/domain/endge-domain'
import { EndgeModule } from '@/domain/entities/endge/EndgeModule'

/**
 * EndgeExtract – класс для извлечения данных.
 */
export class EndgeExtract extends EndgeModule {
  /**
   * Точка входа: извлекает данные по заданному пути (DataPath).
   *
   * @param data Исходные данные (например, JSON-ответ или объект из store)
   * @param domain Схема домена (ReflectDomain)
   * @param path Описание пути извлечения (DataPath)
   * @param field Описание поля (RField), от которого начинается извлечение
   * @returns Извлечённое значение или undefined, если данные не найдены
   */
  pathFromQuery<T>(
    data: T,
    domain: EndgeDomain,
    path: DataPath,
    field: RField,
  ): any {
    if (!data || typeof data !== 'object' || !domain || !path || !field) {
      return undefined
    }
    return this.path(data, domain, path, field)
  }

  /**
   * Точка входа: извлекает данные запроса по заданной схеме.
   *
   * @param data Исходные данные, полученные в ответе
   * @param domain Схема домена, содержащая типы и поля
   * @param shape Описание выборки (DataShape) – что именно извлекать
   * @param query Source-only Query document
   * @returns Всегда undefined: legacy returnField больше не существует.
   */
  shapeFromQuery<T>(
    _data: T,
    _domain: EndgeDomain,
    _query: RQuery,
  ): Partial<T> | undefined {
    return undefined
  }

  /**
   * Рекурсивно извлекает данные по заданному пути.
   *
   * Логика:
   * - Если DataPath содержит ключ (key), то извлекается соответствующее значение.
   * - Если ключ равен "*" и данные – массив, возвращается массив обработанных элементов.
   * - Если путь имеет дочерний узел (value), рекурсивно вызывается извлечение для него.
   *
   * @param data Текущие данные для извлечения
   * @param domain Схема домена
   * @param path Описание пути (DataPath)
   * @param field Описание поля (RField)
   * @returns Извлечённое значение
   */
  path(
    data: any,
    domain: EndgeDomain,
    path: DataPath,
    field: RField,
    variables: Record<string, any> = {},
  ): any {
    if (data == null) return undefined

    // Подстановка переменной в key (если она есть)
    let resolvedKey: string | number | '*' | null = path.key
    if (
      typeof resolvedKey === 'string' &&
      variables.hasOwnProperty(resolvedKey)
    ) {
      resolvedKey = variables[resolvedKey]
    }

    // Подстановка переменных в params (если есть)
    let resolvedParams: Map<string, any> | null = null
    if (path.params && path.params.size > 0) {
      resolvedParams = new Map()
      for (const [k, v] of path.params.entries()) {
        resolvedParams.set(
          k,
          typeof v === 'string' && variables.hasOwnProperty(v)
            ? variables[v]
            : v,
        )
      }
    }

    let currentValue: any

    if (Array.isArray(data)) {
      if (resolvedParams && resolvedParams.size > 0) {
        const [targetField, expectedValue] = Array.from(
          resolvedParams.entries(),
        )[0]
        const found = data.find((item) => item?.[targetField] === expectedValue)
        if (!found) return undefined
        currentValue = found
      } else if (resolvedKey === '*') {
        return path.value
          ? data.map((item: any) =>
              this.path(item, domain, path.value!, field, variables),
            )
          : data
      } else if (typeof resolvedKey === 'number') {
        currentValue = data[resolvedKey]
      } else if (typeof resolvedKey === 'string') {
        const found = data.find((item) => item?.[resolvedKey] !== undefined)
        currentValue = found?.[resolvedKey]
      }
    } else if (resolvedKey !== null) {
      currentValue = data[resolvedKey]
    } else {
      currentValue = data
    }

    return path.value
      ? this.path(currentValue, domain, path.value, field, variables)
      : currentValue
  }

  /**
   * Извлекает данные по DataPath с поддержкой root/current/component контекстов.
   */
  pathV2(opts: {
    allData: any // _root данные с самого верхнего узла
    comData: any // текущие данные компонента
    data: any // текущий узел
    domain: EndgeDomain
    path: DataPath
    field: RField
    variables: Record<string, any>
  }): any {
    const { allData, comData, data, domain, path, field, variables } = opts
    if (data == null) return undefined

    // --- Псевдопеременная $ - ссылка на текущий узел
    if (path.key === '$' || path.key === '$data') {
      // продолжаем от текущего data, но со следующей частью пути
      return path.value
        ? this.pathV2({
            allData,
            comData,
            data,
            domain,
            path: path.value, // двигаемся глубже
            field,
            variables,
          })
        : data
    }

    if (path.key === '$allData') {
      return path.value ? this.pathV2({ ...opts, data: allData }) : allData
    }

    if (path.key === '$comData') {
      return path.value ? this.pathV2({ ...opts, data: comData }) : comData
    }

    // --- Разрешение переменной
    let resolvedKey: string | number | '*' | null = path.key
    if (
      typeof resolvedKey === 'string' &&
      variables.hasOwnProperty(resolvedKey)
    ) {
      resolvedKey = variables[resolvedKey]
    }

    // --- Разрешение параметров
    let resolvedParams: Map<string, any> | null = null
    if (path.params && path.params.size > 0) {
      resolvedParams = new Map()
      for (const [k, v] of path.params.entries()) {
        resolvedParams.set(
          k,
          typeof v === 'string' && variables.hasOwnProperty(v)
            ? variables[v]
            : v,
        )
      }
    }

    let currentValue: any

    // --- Обработка массива
    if (Array.isArray(data)) {
      if (resolvedParams && resolvedParams.size > 0) {
        const [targetField, expectedValue] = Array.from(
          resolvedParams.entries(),
        )[0]
        const found = data.find((item) => item?.[targetField] === expectedValue)
        if (!found) return undefined
        currentValue = found
      } else if (resolvedKey === '*') {
        return path.value
          ? data.map((item: any) =>
              this.pathV2({ ...opts, data: item, path: path.value! }),
            )
          : data
      } else if (typeof resolvedKey === 'number') {
        currentValue = data[resolvedKey]
      } else if (typeof resolvedKey === 'string') {
        const found = data.find((item) => item?.[resolvedKey] !== undefined)
        currentValue = found?.[resolvedKey]
      }
    } else if (resolvedKey !== null) {
      currentValue = data[resolvedKey]
    } else {
      currentValue = data
    }

    return path.value
      ? this.pathV2({ ...opts, data: currentValue, path: path.value })
      : currentValue
  }

  /**
   * Рекурсивно извлекает данные для указанного поля.
   *
   * @param data Текущие данные для извлечения
   * @param domain Схема домена, содержащая типы и поля
   * @param shape Описание выборки для текущего узла
   * @param field Текущее поле из описания домена
   * @returns Извлечённое значение поля
   */
  shape(data: any, domain: EndgeDomain, shape: any, field: RField): any {
    // Получаем описание типа поля из домена
    const fieldType = domain.getType(field.type)
    if (!fieldType) {
      console.warn(`[extractFieldData] Тип "${field.type}" не найден в домене`)
      return undefined
    }

    // Если поле представляет массив, обрабатываем его отдельно
    if (field.isArray) {
      if (!Array.isArray(data)) {
        console.warn('[extractFieldData] Ожидался массив, получен объект', data)
        return undefined
      }
      return this.processArray(data, domain, shape, field)
    }

    // Если тип примитивный - возвращаем значение напрямую
    if (fieldType.isPrimitive) {
      return data
    }

    // Иначе обрабатываем объект (рекурсивно извлекая его поля)
    return this.processObject(data, domain, shape, field)
  }

  /**
   * Обрабатывает данные массива согласно описанию выборки.
   *
   * @param data Массив данных, из которого нужно извлечь значения
   * @param domain Схема домена
   * @param shape Описание выборки для массива
   * @param field Описание поля массива из домена
   * @returns Массив извлечённых значений или undefined
   */
  private processArray(
    data: any[],
    domain: EndgeDomain,
    shape: any,
    field: RField,
  ): any {
    // Если в описании выборки ключ равен "*", извлекаем ВСЕ элементы массива
    if (shape.key === '*') {
      return data.map((item) => this.processObject(item, domain, shape, field))
    }

    // Если ключ - число, извлекаем конкретный элемент массива
    if (typeof shape.key === 'number') {
      if (data[shape.key] !== undefined) {
        return [this.processObject(data[shape.key], domain, shape, field)]
      }
    }

    // Если внешний узел не задаёт выборку, ищем вложенный узел с ключом "*"
    const starSubShape = shape.value.find((sub) => sub.key === '*')
    if (starSubShape) {
      return data.map((item) =>
        this.processObject(item, domain, starSubShape, field),
      )
    }

    // Если во вложенных узлах заданы числовые ключи, обрабатываем их
    const result: any[] = []
    for (const subShape of shape.value) {
      if (
        typeof subShape.key === 'number' &&
        data[subShape.key] !== undefined
      ) {
        result.push(
          this.processObject(data[subShape.key], domain, subShape, field),
        )
      }
    }

    if (result.length > 0) {
      return result
    }

    console.warn(`[processArray] Неподдерживаемое значение key: ${shape.key}`)
    return undefined
  }

  /**
   * Обрабатывает объект, извлекая его поля согласно описанию выборки.
   *
   * @param data Объект данных, из которого извлекаются поля
   * @param domain Схема домена
   * @param shape Описание выборки для объекта
   * @param field Описание текущего поля объекта из домена
   * @returns Объект с извлечёнными данными
   */
  private processObject(
    data: any,
    domain: EndgeDomain,
    shape: any,
    field: RField,
  ): any {
    const fieldType = domain.getType(field.type)
    if (!fieldType) {
      console.warn(`[processObject] Тип "${field.type}" не найден в домене`)
      return undefined
    }

    // Результирующий объект для хранения извлечённых полей
    const result: any = {}

    // Проходим по каждому подузлу описания выборки
    for (const subShape of shape.value) {
      // Находим соответствующее поле в описании типа
      const subField = fieldType.getField(subShape.key!)
      if (!subField) {
        console.warn(
          `[processObject] Поле "${subShape.key}" отсутствует в типе "${fieldType.name}"`,
        )
        continue
      }

      // Если поле представляет массив, вызываем обработку массива
      if (subField.isArray && Array.isArray(data[subShape.key!])) {
        result[subShape.key!] = this.processArray(
          data[subShape.key!],
          domain,
          subShape,
          subField,
        )
        continue
      }

      // Если в данных отсутствует указанное поле, устанавливаем undefined
      if (!Object.prototype.hasOwnProperty.call(data, subShape.key!)) {
        result[subShape.key!] = undefined
        continue
      }

      // Рекурсивно извлекаем данные для подузла
      result[subShape.key!] = this.shape(
        data[subShape.key!],
        domain,
        subShape,
        subField,
      )
    }

    return result
  }
}
