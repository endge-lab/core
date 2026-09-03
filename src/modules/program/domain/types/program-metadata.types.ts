/** JSON-совместимое значение публичной metadata compiled artifact. */
export type ProgramMetadataValue
  = | null
    | boolean
    | number
    | string
    | ProgramMetadataValue[]
    | { [key: string]: ProgramMetadataValue }

/** Metadata сущности, сгруппированная по пользовательскому namespace. */
export type ProgramMetadataMap = Record<string, ProgramMetadataValue>

/** Metadata внутреннего source/IR-узла с сохранением provenance. */
export interface ProgramNodeMetadata {
  /** Стабильный id узла внутри compiled artifact. */
  nodeId: string

  /** Семантический тип узла, например `Column` или `Text`. */
  nodeKind: string

  /** Пользовательский key узла, если он объявлен в source. */
  key?: string

  /** Metadata узла по namespace. */
  values: ProgramMetadataMap
}

/** Общий metadata-контракт любого compiled artifact. */
export interface ProgramMetadata {
  /** Metadata самой доменной сущности. */
  self: ProgramMetadataMap

  /** Metadata внутренних source/IR-узлов. */
  nodes: ProgramNodeMetadata[]
}

/** Создаёт пустой предсказуемый metadata-контракт artifact. */
export function createEmptyProgramMetadata(): ProgramMetadata {
  return {
    self: {},
    nodes: [],
  }
}
