import { DBSchema, DBTable, DBColumn, DBRef, DBEnum, DBEnumValue } from './types'

export function parseDBML(input: string): DBSchema {
  const tables: DBTable[] = []
  const refs: DBRef[] = []
  const enums: DBEnum[] = []

  const text = input.replace(/\/\*[\s\S]*?\*\//g, '')
  const lines = text.split('\n')
  let i = 0

  while (i < lines.length) {
    const line = lines[i].trim()
    
    if (!line || line.startsWith('//')) { i++; continue }

    // Project block - skip
    if (line.match(/^Project\s+/i)) { i = skipBlock(lines, i); continue }

    // Table definition
    const tableMatch = line.match(/^Table\s+(\S+)\s*([\s\S]*?)$/i)
    if (tableMatch && (line.includes('{') || (i + 1 < lines.length && lines[i + 1].trim() === '{'))) {
      const result = parseTable(lines, i, tableMatch[1], tableMatch[2])
      tables.push(result.table)
      i = result.endLine
      continue
    }

    // Standalone Ref
    const refMatch = line.match(/^Ref[:\s]+(.+)/i)
    if (refMatch) {
      const parsed = parseStandaloneRef(refMatch[1])
      if (parsed) refs.push(parsed)
      i++
      continue
    }

    // Enum definition
    if (line.match(/^Enum\s+/i)) {
      const result = parseEnum(lines, i)
      if (result.dbEnum) enums.push(result.dbEnum)
      i = result.endLine
      continue
    }

    i++
  }

  // Extract inline refs from table columns
  for (const table of tables) {
    for (const col of table.columns) {
      if (col.ref) {
        refs.push({
          fromTable: table.name,
          fromColumn: col.name,
          toTable: col.ref.table,
          toColumn: col.ref.column,
          type: '>',
        })
      }
    }
  }

  return { tables, refs, enums }
}

function skipBlock(lines: string[], start: number): number {
  let depth = 0
  let i = start
  
  // Find opening brace
  while (i < lines.length) {
    const line = lines[i]
    const braceIdx = line.indexOf('{')
    if (braceIdx >= 0) {
      depth = 1
      i++
      break
    }
    i++
  }
  
  // Find matching closing brace
  while (i < lines.length && depth > 0) {
    const line = lines[i]
    for (const ch of line) {
      if (ch === '{') depth++
      if (ch === '}') depth--
      if (depth <= 0) break
    }
    i++
    if (depth <= 0) break
  }
  return i
}

function parseTable(lines: string[], start: number, rawName: string, attrs: string): { table: DBTable; endLine: number } {
  // Clean table name (remove trailing brackets etc)
  const name = rawName.replace(/\[.*$/, '').trim()
  const fullAttrs = attrs + (rawName.includes('[') ? rawName.substring(rawName.indexOf('[')) : '')
  
  const table: DBTable = { name, columns: [] }

  // Parse header color
  const headerColorMatch = fullAttrs.match(/headercolor:\s*(#[0-9a-fA-F]{3,8})/i)
  if (headerColorMatch) {
    table.headerColor = headerColorMatch[1]
  }

  // Table note can also live in the header attributes: Table users [note: '...']
  const attrContent = extractBracketContent(fullAttrs)
  if (attrContent) {
    for (const part of splitConstraints(attrContent)) {
      const noteMatch = part.match(/^note:\s*([\s\S]+)$/i)
      if (noteMatch) table.note = cleanNoteText(noteMatch[1])
    }
  }

  // Find opening brace
  let i = start
  let depth = 0
  while (i < lines.length) {
    if (lines[i].includes('{')) {
      depth = 1
      i++
      break
    }
    i++
  }

  // Parse table body
  while (i < lines.length && depth > 0) {
    const line = lines[i].trim()

    // Check for closing brace (simple line)
    if (line === '}') {
      depth--
      i++
      if (depth <= 0) break
      continue
    }

    // Skip empty lines and comments
    if (!line || line.startsWith('//')) { i++; continue }

    // Indexes block - skip entirely
    if (line.match(/^indexes\s*\{?/i)) {
      if (line.includes('{')) {
        i = skipInnerBlock(lines, i)
      } else {
        i++
        // next line should have {
        if (i < lines.length && lines[i].trim().includes('{')) {
          i = skipInnerBlock(lines, i)
        }
      }
      continue
    }

    // Table-level note block
    if (line.match(/^Note\s*:/i) || line.match(/^Note\s*\{/i)) {
      const parsed = parseNote(lines, i)
      if (parsed.note) table.note = parsed.note
      i = parsed.endLine
      continue
    }

    // Check if this line has a closing brace (table ends mid-line)
    if (line.endsWith('}') && !line.includes('[')) {
      // Could be last column + closing brace - unlikely but handle
      depth--
      i++
      if (depth <= 0) break
      continue
    }

    // Parse as column
    const col = parseColumn(line)
    if (col) {
      table.columns.push(col)
    }

    i++
  }

  return { table, endLine: i }
}

function skipInnerBlock(lines: string[], start: number): number {
  let depth = 0
  let i = start
  // Count opening braces on start line
  for (const ch of lines[i]) {
    if (ch === '{') depth++
    if (ch === '}') depth--
  }
  i++
  while (i < lines.length && depth > 0) {
    const line = lines[i]
    for (const ch of line) {
      if (ch === '{') depth++
      if (ch === '}') depth--
    }
    i++
    if (depth <= 0) break
  }
  return i
}

function parseColumn(line: string): DBColumn | null {
  // Remove inline comments (quote-aware, so a '//' inside a note survives)
  const cleaned = stripLineComment(line).trim()

  if (!cleaned || cleaned === '}') return null

  // Skip keywords
  if (/^(indexes|Note|Ref)\b/i.test(cleaned)) return null

  // Match: name type [constraints] — type may be parameterised, e.g. varchar(255)
  const match = cleaned.match(/^(\w+)\s+(\w+(?:\([^)]*\))?(?:\[\])?)\s*(.*)$/)
  if (!match) return null

  const colName = match[1]
  const colType = match[2]
  const rest = match[3] || ''

  // Skip if name is a keyword
  if (['indexes', 'Note', 'Ref', 'Project', 'Table', 'Enum'].includes(colName)) return null

  const constraints: string[] = []
  let ref: { table: string; column: string } | undefined
  let note: string | undefined

  // Parse bracket contents [...]
  const bracketContent = extractBracketContent(rest)
  if (bracketContent) {
    const parts = splitConstraints(bracketContent)
    for (const part of parts) {
      const trimmed = part.trim()
      const refMatch = trimmed.match(/ref:\s*[<>-]\s*(\w+)\.(\w+)/i)
      const noteMatch = trimmed.match(/^note:\s*([\s\S]+)$/i)
      if (refMatch) {
        ref = { table: refMatch[1], column: refMatch[2] }
      } else if (noteMatch) {
        note = cleanNoteText(noteMatch[1])
      } else if (trimmed === 'pk') {
        constraints.push('PK')
      } else if (trimmed === 'not null') {
        constraints.push('NOT NULL')
      } else if (trimmed === 'unique') {
        constraints.push('UNIQUE')
      } else if (trimmed === 'increment') {
        constraints.push('AUTO')
      }
    }
  }

  return { name: colName, type: colType, constraints, ref, note }
}

/** Truncate at a `//` comment, ignoring occurrences inside quoted strings. */
function stripLineComment(s: string): string {
  let inQuote = false
  let quoteChar = ''
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (inQuote) {
      if (ch === quoteChar) inQuote = false
      continue
    }
    if (ch === "'" || ch === '"' || ch === '`') { inQuote = true; quoteChar = ch; continue }
    if (ch === '/' && s[i + 1] === '/') return s.substring(0, i)
  }
  return s
}

function extractBracketContent(s: string): string | null {
  return matchBracket(s, 0)?.content ?? null
}

/** Find the first `[...]` group at or after `from`, returning its content and closing index. */
function matchBracket(s: string, from: number): { content: string; end: number } | null {
  const start = s.indexOf('[', from)
  if (start < 0) return null

  let depth = 0
  for (let i = start; i < s.length; i++) {
    if (s[i] === '[') depth++
    else if (s[i] === ']') { depth--; if (depth === 0) return { content: s.substring(start + 1, i), end: i } }
  }
  return null
}

function splitConstraints(s: string): string[] {
  const parts: string[] = []
  let current = ''
  let inQuote = false
  let quoteChar = ''
  let parenDepth = 0

  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if ((ch === "'" || ch === '"' || ch === '`') && !inQuote) {
      inQuote = true; quoteChar = ch; current += ch
    } else if (ch === quoteChar && inQuote) {
      inQuote = false; current += ch
    } else if (ch === '(' && !inQuote) {
      parenDepth++; current += ch
    } else if (ch === ')' && !inQuote) {
      parenDepth--; current += ch
    } else if (ch === ',' && parenDepth === 0 && !inQuote) {
      parts.push(current.trim()); current = ''
    } else {
      current += ch
    }
  }
  if (current.trim()) parts.push(current.trim())
  return parts
}

/**
 * Parse a note construct starting at `start`. Handles all DBML spellings:
 *   Note: 'text'      Note: '''multi\nline'''      Note { 'text' }      Note { '''...''' }
 */
function parseNote(lines: string[], start: number): { note: string; endLine: number } {
  let head = lines[start].trim().replace(/^Note\s*/i, '')
  const braced = head.startsWith('{')
  head = braced ? head.slice(1) : head.replace(/^:\s*/, '')

  let raw = head
  let i = start + 1

  if (braced) {
    let depth = 1 + countChar(head, '{') - countChar(head, '}')
    while (i < lines.length && depth > 0) {
      depth += countChar(lines[i], '{') - countChar(lines[i], '}')
      raw += '\n' + lines[i]
      i++
    }
    const lastBrace = raw.lastIndexOf('}')
    if (lastBrace >= 0) raw = raw.substring(0, lastBrace)
  } else if (raw.trimStart().startsWith("'''") && !raw.trimStart().slice(3).includes("'''")) {
    // Triple-quoted string left open on the first line
    while (i < lines.length) {
      raw += '\n' + lines[i]
      const closed = lines[i].includes("'''")
      i++
      if (closed) break
    }
  }

  return { note: cleanNoteText(raw), endLine: i }
}

/** Strip surrounding quotes, unescape, and dedent a note body. */
function cleanNoteText(s: string): string {
  let t = s.trim()

  if (t.startsWith("'''") && t.endsWith("'''") && t.length >= 6) {
    t = t.substring(3, t.length - 3)
  } else if (t.length >= 2 && (t[0] === "'" || t[0] === '"' || t[0] === '`') && t[t.length - 1] === t[0]) {
    t = t.substring(1, t.length - 1)
  }

  t = t.replace(/\\n/g, '\n').replace(/\\'/g, "'").replace(/\\"/g, '"')

  // Dedent by the shallowest indent across non-blank lines
  const noteLines = t.split('\n')
  const indents = noteLines.filter(l => l.trim()).map(l => l.match(/^\s*/)![0].length)
  const dedent = indents.length ? Math.min(...indents) : 0
  return noteLines.map(l => l.slice(dedent)).join('\n').replace(/^\n+|\s+$/g, '')
}

function parseEnum(lines: string[], start: number): { dbEnum: DBEnum | null; endLine: number } {
  const nameMatch = lines[start].trim().match(/^Enum\s+([^\s{]+)/i)
  const name = nameMatch ? cleanIdent(nameMatch[1]) : ''

  // Collect the brace-delimited body. The opening line may also carry values and the
  // closing brace, e.g. `Enum status { a b }`.
  const bodyLines: string[] = []
  let depth = 0
  let started = false
  let i = start

  for (; i < lines.length; i++) {
    let line = lines[i]

    if (!started) {
      const open = line.indexOf('{')
      if (open < 0) continue
      started = true
      depth = 1
      line = line.substring(open + 1)
    }

    let closeAt = -1
    for (let k = 0; k < line.length; k++) {
      if (line[k] === '{') depth++
      else if (line[k] === '}') { depth--; if (depth === 0) { closeAt = k; break } }
    }

    if (closeAt >= 0) {
      bodyLines.push(line.substring(0, closeAt))
      i++
      break
    }
    bodyLines.push(line)
  }

  if (!started) return { dbEnum: null, endLine: start + 1 }
  return { dbEnum: name ? { name, values: parseEnumValues(bodyLines.join('\n')) } : null, endLine: i }
}

/** Tokenise an enum body into values, each optionally followed by a `[note: '...']` block. */
function parseEnumValues(body: string): DBEnumValue[] {
  const text = body.split('\n').map(stripLineComment).join('\n')
  const values: DBEnumValue[] = []
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (/\s/.test(ch) || ch === ',') { i++; continue }

    let valueName: string
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = text.indexOf(ch, i + 1)
      if (end < 0) break
      valueName = text.substring(i + 1, end)
      i = end + 1
    } else {
      const word = /^[^\s,[\]]+/.exec(text.substring(i))
      if (!word) { i++; continue }
      valueName = word[0]
      i += word[0].length
    }

    // An attribute block belongs to this value only if it follows on the same line
    let note: string | undefined
    const sameLine = /^[^\S\n]*\[/.exec(text.substring(i))
    if (sameLine) {
      const bracket = matchBracket(text, i)
      if (bracket) {
        for (const part of splitConstraints(bracket.content)) {
          const noteMatch = part.match(/^note:\s*([\s\S]+)$/i)
          if (noteMatch) note = cleanNoteText(noteMatch[1])
        }
        i = bracket.end + 1
      }
    }

    if (valueName) values.push({ name: valueName, note })
  }

  return values
}

function cleanIdent(s: string): string {
  return s.replace(/["'`]/g, '').trim()
}

function countChar(s: string, ch: string): number {
  let n = 0
  for (const c of s) if (c === ch) n++
  return n
}

function parseStandaloneRef(text: string): DBRef | null {
  const cleaned = text.replace(/["']/g, '').trim()
  const match = cleaned.match(/(\w+)\.(\w+)\s*([<>-])\s*(\w+)\.(\w+)/)
  if (!match) return null
  return {
    fromTable: match[1],
    fromColumn: match[2],
    type: match[3] as '>' | '<' | '-',
    toTable: match[4],
    toColumn: match[5],
  }
}
