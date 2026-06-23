import { TypeMap } from '@endge/utils'
import { Expose } from 'class-transformer'
import { RField } from '@/domain/entities/reflect/RField'
import { REntity } from '@/domain/entities/reflect/REntity'

/**
 * Класс рефлексии для хранения информации о типе.
 * Содержит название и список полей.
 */
export class RType extends REntity {
  //
  get id(): string {
    return this.name
  }

  @Expose()
  name: string

  @Expose()
  isPrimitive: boolean = false

  @Expose()
  @TypeMap(RField, 'name')
  fields: Map<string, RField> = new Map()

  constructor(name: string) {
    super()
    this.name = name
  }

  // Добавление поля
  addField(field: RField): void {
    this.fields.set(field.name, field)
  }

  // Получение информации о поле
  getField(fieldName: string | number): RField | null {
    return this.fields.get(`${fieldName}`) || null
  }

  // Проверка, есть ли поле
  hasField(fieldName: string | number): boolean {
    return this.fields.has(`${fieldName}`)
  }

  // Получение списка всех полей
  getFields(): string[] {
    return Array.from(this.fields.keys())
  }
}
