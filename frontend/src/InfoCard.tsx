import { useLayoutEffect, useRef, useState } from 'react'
import { X, Pin } from 'lucide-react'
import { InfoTarget } from './types'

interface Props {
  target: InfoTarget
  anchor: DOMRect
  pinned: boolean
  onClose: () => void
}

const KIND_LABEL: Record<InfoTarget['kind'], string> = {
  table: 'Table note',
  column: 'Column note',
  enum: 'Enum',
}

/**
 * Rendered in screen space (fixed) rather than inside the React Flow canvas, so notes
 * stay legible at any zoom level and never scale down with the diagram.
 */
export default function InfoCard({ target, anchor, pinned, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8

    let left = anchor.left
    if (left + width > window.innerWidth - margin) left = window.innerWidth - margin - width
    if (left < margin) left = margin

    let top = anchor.bottom + 6
    if (top + height > window.innerHeight - margin) {
      const above = anchor.top - 6 - height
      top = above >= margin ? above : Math.max(margin, window.innerHeight - margin - height)
    }

    setPos({ left, top })
  }, [anchor, target.key])

  return (
    <div
      ref={ref}
      style={{
        left: pos?.left ?? anchor.left,
        top: pos?.top ?? anchor.bottom + 6,
        visibility: pos ? 'visible' : 'hidden',
      }}
      className={`fixed z-50 w-[300px] max-h-[340px] overflow-auto rounded-lg border shadow-2xl bg-[#161b22] text-xs ${
        pinned ? 'border-blue-500/50' : 'border-white/15 pointer-events-none'
      }`}
    >
      {/* Header */}
      <div className="sticky top-0 flex items-start gap-2 px-3 py-2 bg-[#1c2129] border-b border-white/10">
        <div className="flex-1 min-w-0">
          <div className="text-[9px] uppercase tracking-wider text-white/35">{KIND_LABEL[target.kind]}</div>
          <div className="text-white/90 font-medium truncate">{target.title}</div>
          {target.subtitle && <div className="text-[10px] text-white/40 truncate">{target.subtitle}</div>}
        </div>
        {pinned ? (
          <button onClick={onClose} className="text-white/30 hover:text-white/80 shrink-0 mt-0.5" title="Close">
            <X className="w-3.5 h-3.5" />
          </button>
        ) : (
          <Pin className="w-3 h-3 text-white/20 shrink-0 mt-1" />
        )}
      </div>

      {/* Body */}
      <div className="px-3 py-2">
        {target.kind === 'enum' ? (
          target.values && target.values.length > 0 ? (
            <div className="space-y-1">
              {target.values.map(v => (
                <div key={v.name} className="flex items-baseline gap-2">
                  <span className="px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-200 font-mono text-[11px] shrink-0">
                    {v.name}
                  </span>
                  {v.note && <span className="text-white/45 text-[11px] leading-snug">{v.note}</span>}
                </div>
              ))}
            </div>
          ) : (
            <div className="text-white/30 italic">No values</div>
          )
        ) : (
          <div className="text-white/70 whitespace-pre-wrap leading-relaxed">{target.note}</div>
        )}
      </div>

      {!pinned && (
        <div className="px-3 pb-2 text-[10px] text-white/25">Click to pin</div>
      )}
    </div>
  )
}
