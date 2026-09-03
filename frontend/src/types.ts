export interface DBColumn {
  name: string
  type: string
  constraints: string[]
  ref?: { table: string; column: string }
  note?: string
}

export interface DBTable {
  name: string
  headerColor?: string
  columns: DBColumn[]
  note?: string
}

export interface DBRef {
  fromTable: string
  fromColumn: string
  toTable: string
  toColumn: string
  type: '>' | '<' | '-'  // many-to-one, one-to-many, one-to-one
}

export interface DBEnumValue {
  name: string
  note?: string
}

export interface DBEnum {
  name: string
  values: DBEnumValue[]
}

export interface DBSchema {
  tables: DBTable[]
  refs: DBRef[]
  enums: DBEnum[]
}

/** A note or enum surfaced in the floating info card. */
export interface InfoTarget {
  key: string
  kind: 'table' | 'column' | 'enum'
  title: string
  subtitle?: string
  note?: string
  values?: DBEnumValue[]
}
