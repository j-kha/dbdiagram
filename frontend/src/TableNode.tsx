import { memo } from 'react'
import { Handle, Position } from 'reactflow'
import { DBColumn, InfoTarget } from './types'
import { EnumMap, lookupEnum } from './enums'
import { Eye, EyeOff, Info, ChevronsUpDown } from 'lucide-react'

interface TableNodeData {
  label: string
  columns: DBColumn[]
  headerColor?: string
  note?: string
  enumMap?: EnumMap
  isHighlighted: boolean
  isDimmed: boolean
  hideIncoming?: boolean
  hideOutgoing?: boolean
  onToggleIncoming?: () => void
  onToggleOutgoing?: () => void
  onInfoEnter?: (target: InfoTarget, anchor: DOMRect) => void
  onInfoLeave?: () => void
  onInfoClick?: (target: InfoTarget, anchor: DOMRect) => void
  pinnedKey?: string | null
}

function TableNode({ data }: { data: TableNodeData }) {
  const headerBg = data.headerColor || '#374151'
  const opacity = data.isDimmed ? 0.3 : 1

  // Wire an indicator up to the shared info card: hover previews, click pins.
  const infoProps = (target: InfoTarget) => ({
    onMouseEnter: (e: React.MouseEvent<HTMLElement>) =>
      data.onInfoEnter?.(target, e.currentTarget.getBoundingClientRect()),
    onMouseLeave: () => data.onInfoLeave?.(),
    onClick: (e: React.MouseEvent<HTMLElement>) => {
      e.stopPropagation()
      data.onInfoClick?.(target, e.currentTarget.getBoundingClientRect())
    },
  })

  return (
    <div
      className="rounded-lg overflow-hidden shadow-xl border border-white/20 min-w-[200px] transition-opacity duration-200"
      style={{ opacity }}
    >
      {/* Header */}
      <div
        className="px-3 py-2 font-semibold text-white text-sm flex items-center gap-2"
        style={{ backgroundColor: headerBg }}
      >
        <span className="flex-1">{data.label}</span>

        {/* Table note indicator */}
        {data.note && (
          <button
            className={`nodrag p-0.5 rounded hover:bg-white/20 transition-colors ${
              data.pinnedKey === `table:${data.label}` ? 'bg-white/25' : ''
            }`}
            title="Table note"
            {...infoProps({ key: `table:${data.label}`, kind: 'table', title: data.label, note: data.note })}
          >
            <Info className="w-3.5 h-3.5" />
          </button>
        )}

        {/* Edge visibility toggles */}
        <button
          onClick={(e) => { e.stopPropagation(); data.onToggleIncoming?.() }}
          className={`nodrag p-0.5 rounded hover:bg-white/20 transition-colors ${data.hideIncoming ? 'opacity-40' : ''}`}
          title={data.hideIncoming ? 'Show incoming edges' : 'Hide incoming edges'}
        >
          <div className="flex items-center gap-0.5">
            <div className="w-2 h-0.5 bg-blue-400 rounded" />
            {data.hideIncoming ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
          </div>
        </button>
        <button
          onClick={(e) => { e.stopPropagation(); data.onToggleOutgoing?.() }}
          className={`nodrag p-0.5 rounded hover:bg-white/20 transition-colors ${data.hideOutgoing ? 'opacity-40' : ''}`}
          title={data.hideOutgoing ? 'Show outgoing edges' : 'Hide outgoing edges'}
        >
          <div className="flex items-center gap-0.5">
            {data.hideOutgoing ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
            <div className="w-2 h-0.5 bg-orange-400 rounded" />
          </div>
        </button>
      </div>

      {/* Columns */}
      <div className="bg-[#1c1f26] divide-y divide-white/5">
        {data.columns.map((col, idx) => {
          const enumDef = lookupEnum(data.enumMap, col.type)
          const noteKey = `col:${data.label}.${col.name}`
          const enumKey = `enum:${data.label}.${col.name}`

          return (
            <div key={idx} className="px-3 py-1 flex items-center gap-2 text-xs relative">
              <Handle
                type="target"
                position={Position.Left}
                id={`${col.name}-target`}
                style={{ top: 'auto', left: -4, width: 8, height: 8, background: '#4b5563', border: '1px solid #6b7280' }}
              />

              <span className="flex-1 flex items-center gap-1 min-w-0">
                <span
                  className={`text-white/90 font-medium truncate ${
                    col.note ? 'underline decoration-dotted decoration-white/30 underline-offset-2' : ''
                  }`}
                >
                  {col.name}
                </span>
                {col.note && (
                  <button
                    className={`nodrag shrink-0 rounded text-white/35 hover:text-white transition-colors ${
                      data.pinnedKey === noteKey ? 'text-white' : ''
                    }`}
                    title="Column note"
                    {...infoProps({
                      key: noteKey,
                      kind: 'column',
                      title: `${data.label}.${col.name}`,
                      subtitle: col.type,
                      note: col.note,
                    })}
                  >
                    <Info className="w-3 h-3" />
                  </button>
                )}
              </span>

              {enumDef ? (
                <button
                  className={`nodrag flex items-center gap-0.5 px-1 rounded text-purple-300/90 bg-purple-400/10 hover:bg-purple-400/25 transition-colors ${
                    data.pinnedKey === enumKey ? 'bg-purple-400/30 text-purple-100' : ''
                  }`}
                  title={`Enum: ${enumDef.values.length} values`}
                  {...infoProps({
                    key: enumKey,
                    kind: 'enum',
                    title: enumDef.name,
                    subtitle: `${data.label}.${col.name}`,
                    values: enumDef.values,
                  })}
                >
                  {col.type}
                  <ChevronsUpDown className="w-2.5 h-2.5" />
                </button>
              ) : (
                <span className="text-white/40">{col.type}</span>
              )}

              {col.constraints.length > 0 && (
                <span className="text-[10px] text-yellow-400/70">
                  {col.constraints.includes('PK') ? '🔑' : ''}
                  {col.constraints.includes('NOT NULL') ? '•' : ''}
                </span>
              )}

              <Handle
                type="source"
                position={Position.Right}
                id={`${col.name}-source`}
                style={{ top: 'auto', right: -4, width: 8, height: 8, background: '#4b5563', border: '1px solid #6b7280' }}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default memo(TableNode)
