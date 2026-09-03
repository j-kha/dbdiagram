import { DBEnum } from './types'

export type EnumMap = Record<string, DBEnum>

/** Index enums by full name and by bare name, so `jobs.status` and `status` both resolve. */
export function buildEnumMap(enums: DBEnum[]): EnumMap {
  const map: EnumMap = {}
  for (const e of enums) {
    const full = e.name.toLowerCase()
    map[full] = e
    const short = full.split('.').pop()
    if (short) map[short] = e
  }
  return map
}

export function lookupEnum(map: EnumMap | undefined, type: string): DBEnum | undefined {
  if (!map || !type) return undefined
  const key = type.toLowerCase().replace(/\[\]$/, '').replace(/["'`]/g, '').trim()
  return map[key] || map[key.split('.').pop() || '']
}
