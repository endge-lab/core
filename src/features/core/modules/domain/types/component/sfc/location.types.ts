/** Позиция фрагмента внутри полного SFC source. */
export interface RComponentSFC_SourceRange {
  /** Абсолютный offset начала фрагмента в source. */
  start: number

  /** Абсолютный offset конца фрагмента в source. */
  end: number

  /** Номер строки начала фрагмента, если parser его посчитал. */
  startLine?: number

  /** Номер колонки начала фрагмента, если parser его посчитал. */
  startColumn?: number

  /** Номер строки конца фрагмента, если parser его посчитал. */
  endLine?: number

  /** Номер колонки конца фрагмента, если parser его посчитал. */
  endColumn?: number
}
