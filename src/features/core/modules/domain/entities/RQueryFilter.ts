import { JsonString } from '@endge/utils'
import { Expose } from 'class-transformer'

/** Режим элемента фильтра: свой JSON или ссылка на фильтр из коллекции. */
export type RQueryFilterItemMode = 'inline' | 'reference'

/**
 * Один элемент фильтра запроса: либо inline JSON, либо ссылка на доменный фильтр (parameters).
 */
export class RQueryFilter {
  @Expose()
  mode: RQueryFilterItemMode = 'inline'

  /** Identity фильтра из коллекции (parameters), если mode === 'reference'. */
  @Expose()
  filterId: string | null = null

  @Expose()
  @JsonString()
  inlineJson: string | null = '{}'

  constructor(init?: Partial<RQueryFilter>) {
    Object.assign(this, init)
  }
}
