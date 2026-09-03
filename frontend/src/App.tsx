import { useState, useCallback, useMemo, useRef, useEffect } from 'react'
import ReactFlow, {
  Node,
  Edge,
  useNodesState,
  useEdgesState,
  Background,
  Controls,
  MiniMap,
  NodeTypes,
  NodeChange,
  NodePositionChange,
  SelectionMode,
} from 'reactflow'
import 'reactflow/dist/style.css'
import Editor from '@monaco-editor/react'
import { parseDBML } from './parser'
import TableNode from './TableNode'
import InfoCard from './InfoCard'
import { buildEnumMap } from './enums'
import { DBSchema, InfoTarget } from './types'
import { Plus, X, Save, List, ChevronRight, ChevronDown } from 'lucide-react'

const nodeTypes: NodeTypes = { table: TableNode }

interface DiagramData {
  id?: number
  name: string
  dbml: string
  positions: Record<string, { x: number; y: number }>
}

interface EdgeVisibility {
  hideIncoming: boolean
  hideOutgoing: boolean
}

interface InfoState {
  target: InfoTarget
  anchor: DOMRect
}

const DEFAULT_DBML = `// Paste your DBML here
Enum post_status {
  draft [note: 'Only visible to the author']
  published
  archived [note: 'Hidden from listings, kept for history']
}

Table users [headercolor: #3498db] {
  id int [pk, increment]
  email varchar [unique, not null, note: 'Lowercased on write; used as the login identifier']
  name varchar

  Note: 'Every human account. Service accounts live in a separate table.'
}

Table posts [headercolor: #e74c3c] {
  id int [pk, increment]
  user_id int [ref: > users.id, not null]
  title varchar [not null]
  status post_status [note: 'Drives visibility in the public feed']
  content text
}
`

function schemaToFlow(schema: DBSchema, positions: Record<string, { x: number; y: number }>): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = []
  const edges: Edge[] = []

  const cols = Math.max(Math.ceil(Math.sqrt(schema.tables.length)), 1)
  const xSpacing = 320
  const ySpacing = 300
  const enumMap = buildEnumMap(schema.enums)

  schema.tables.forEach((table, idx) => {
    const savedPos = positions[table.name]
    const col = idx % cols
    const row = Math.floor(idx / cols)

    nodes.push({
      id: table.name,
      type: 'table',
      position: savedPos || { x: col * xSpacing, y: row * ySpacing },
      data: {
        label: table.name,
        columns: table.columns,
        headerColor: table.headerColor,
        note: table.note,
        enumMap,
        isHighlighted: false,
        isDimmed: false,
        hideIncoming: false,
        hideOutgoing: false,
      },
    })
  })

  schema.refs.forEach((ref, idx) => {
    edges.push({
      id: `e-${idx}`,
      source: ref.fromTable,
      target: ref.toTable,
      sourceHandle: `${ref.fromColumn}-source`,
      targetHandle: `${ref.toColumn}-target`,
      style: { stroke: '#4b5563', strokeWidth: 1.5 },
      animated: false,
    })
  })

  return { nodes, edges }
}

function App() {
  const [diagrams, setDiagrams] = useState<DiagramData[]>([])
  const [activeIdx, setActiveIdx] = useState(0)
  const [nodes, setNodes, onNodesChange] = useNodesState([])
  const [edges, setEdges, onEdgesChange] = useEdgesState([])
  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [hoveredTable, setHoveredTable] = useState<string | null>(null)
  const [panelWidth, setPanelWidth] = useState(400)
  const [schema, setSchema] = useState<DBSchema | null>(null)
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [edgeVisibility, setEdgeVisibility] = useState<Record<string, EdgeVisibility>>({})
  const [hoverInfo, setHoverInfo] = useState<InfoState | null>(null)
  const [pinnedInfo, setPinnedInfo] = useState<InfoState | null>(null)
  const [showEnums, setShowEnums] = useState(false)
  const [expandedEnums, setExpandedEnums] = useState<Record<string, boolean>>({})
  const resizing = useRef(false)
  const parseTimeout = useRef<ReturnType<typeof setTimeout>>()
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({})
  const saveTimeout = useRef<ReturnType<typeof setTimeout>>()
  // Always-current refs so debounced callbacks don't close over stale state
  const diagramsRef = useRef(diagrams)
  const activeIdxRef = useRef(activeIdx)

  // Keep refs in sync with the latest render values
  diagramsRef.current = diagrams
  activeIdxRef.current = activeIdx

  const activeDiagram = diagrams[activeIdx] || { name: 'Untitled', dbml: DEFAULT_DBML, positions: {} }

  // Toggle edge visibility for a table
  const toggleIncoming = useCallback((tableId: string) => {
    setEdgeVisibility(prev => ({
      ...prev,
      [tableId]: {
        hideIncoming: !prev[tableId]?.hideIncoming,
        hideOutgoing: prev[tableId]?.hideOutgoing || false,
      }
    }))
  }, [])

  const toggleOutgoing = useCallback((tableId: string) => {
    setEdgeVisibility(prev => ({
      ...prev,
      [tableId]: {
        hideIncoming: prev[tableId]?.hideIncoming || false,
        hideOutgoing: !prev[tableId]?.hideOutgoing,
      }
    }))
  }, [])

  // Info card: hover previews, click pins (a pinned card wins over any hover preview)
  const handleInfoEnter = useCallback((target: InfoTarget, anchor: DOMRect) => {
    setHoverInfo({ target, anchor })
  }, [])

  const handleInfoLeave = useCallback(() => setHoverInfo(null), [])

  const handleInfoClick = useCallback((target: InfoTarget, anchor: DOMRect) => {
    setPinnedInfo(prev => (prev?.target.key === target.key ? null : { target, anchor }))
  }, [])

  // Esc dismisses the pinned card
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setPinnedInfo(null); setShowEnums(false) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // Load diagrams from API
  useEffect(() => {
    fetch('/api/diagrams')
      .then(r => r.json())
      .then((data: Array<{ id: number; name: string; dbml: string; positions: string }>) => {
        if (data.length === 0) {
          const def: DiagramData = { name: 'Untitled', dbml: DEFAULT_DBML, positions: {} }
          setDiagrams([def])
          saveDiagram(def)
        } else {
          const loaded = data.map(d => ({
            id: d.id,
            name: d.name,
            dbml: d.dbml,
            positions: JSON.parse(d.positions || '{}'),
          }))
          setDiagrams(loaded)
        }
        setLoaded(true)
      })
      .catch(() => {
        setDiagrams([{ name: 'Untitled', dbml: DEFAULT_DBML, positions: {} }])
        setLoaded(true)
      })
  }, [])

  // Render diagram when active tab changes or on load
  useEffect(() => {
    if (!loaded) return
    const d = diagrams[activeIdx]
    if (d) {
      positionsRef.current = { ...d.positions }
      updateDiagram(d.dbml, d.positions)
      setEdgeVisibility({}) // Reset visibility on tab change
      setPinnedInfo(null)
      setHoverInfo(null)
    }
  }, [activeIdx, loaded]) // eslint-disable-line

  const updateDiagram = useCallback((text: string, positions?: Record<string, { x: number; y: number }>) => {
    try {
      const parsed = parseDBML(text)
      setSchema(parsed)
      const pos = positions || positionsRef.current
      const { nodes: newNodes, edges: newEdges } = schemaToFlow(parsed, pos)
      setNodes(newNodes)
      setEdges(newEdges)
    } catch (e) {
      console.error('Parse error:', e)
    }
  }, [setNodes, setEdges])

  const handleEditorChange = useCallback((value: string | undefined) => {
    const text = value || ''
    setDiagrams(prev => {
      const next = [...prev]
      if (next[activeIdx]) {
        next[activeIdx] = { ...next[activeIdx], dbml: text }
      }
      return next
    })
    if (parseTimeout.current) clearTimeout(parseTimeout.current)
    parseTimeout.current = setTimeout(() => {
      updateDiagram(text, positionsRef.current)
      autoSave()
    }, 500)
  }, [activeIdx, updateDiagram]) // eslint-disable-line

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    onNodesChange(changes)
    let posChanged = false
    for (const change of changes) {
      if (change.type === 'position' && (change as NodePositionChange).position) {
        const pc = change as NodePositionChange
        if (pc.position) {
          positionsRef.current[pc.id] = { x: pc.position.x, y: pc.position.y }
          posChanged = true
        }
      }
    }
    if (posChanged) {
      setDiagrams(prev => {
        const next = [...prev]
        if (next[activeIdx]) {
          next[activeIdx] = { ...next[activeIdx], positions: { ...positionsRef.current } }
        }
        return next
      })
      autoSave()
    }
  }, [activeIdx, onNodesChange])

  const autoSave = useCallback(() => {
    if (saveTimeout.current) clearTimeout(saveTimeout.current)
    saveTimeout.current = setTimeout(() => {
      // Use refs so this always reads the current diagram, even when called from
      // stale closures in handleEditorChange / handleNodesChange
      const d = diagramsRef.current[activeIdxRef.current]
      if (d) saveDiagram({ ...d, positions: positionsRef.current })
    }, 2000)
  }, []) // eslint-disable-line

  const saveDiagram = async (d: DiagramData) => {
    setSaving(true)
    const body = { ...d, positions: JSON.stringify(d.positions) }
    try {
      if (d.id) {
        const res = await fetch('/api/diagrams', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const updated = await res.json()
        setDiagrams(prev => prev.map(x => x.id === d.id ? { ...x, id: updated.id } : x))
      } else {
        const res = await fetch('/api/diagrams', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
        const created = await res.json()
        setDiagrams(prev => prev.map((x, i) => i === activeIdx ? { ...x, id: created.id } : x))
      }
    } catch (e) {
      console.error('Save failed:', e)
    }
    setSaving(false)
  }

  const addTab = async () => {
    const newIdx = diagrams.length
    const newDiagram: DiagramData = { name: `Diagram ${newIdx + 1}`, dbml: '', positions: {} }
    setDiagrams(prev => [...prev, newDiagram])
    setActiveIdx(newIdx)
    // Inline POST so we can map the returned id back to the correct index
    try {
      const res = await fetch('/api/diagrams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newDiagram, positions: '{}' }),
      })
      const created = await res.json()
      setDiagrams(prev => prev.map((x, i) => i === newIdx ? { ...x, id: created.id } : x))
    } catch (e) {
      console.error('Save failed:', e)
    }
  }

  const closeTab = (idx: number) => {
    const d = diagrams[idx]
    if (d?.id) {
      fetch('/api/diagrams', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id }) })
    }
    const newDiagrams = diagrams.filter((_, i) => i !== idx)
    const newActiveIdx = activeIdx > idx ? activeIdx - 1 : Math.min(activeIdx, newDiagrams.length - 1)
    setDiagrams(newDiagrams)
    if (newActiveIdx !== activeIdx) {
      setActiveIdx(newActiveIdx)
    } else {
      // activeIdx is unchanged but the diagram at that index changed — the tab-change
      // effect won't fire, so manually refresh the diagram view.
      const next = newDiagrams[newActiveIdx]
      if (next) {
        positionsRef.current = { ...next.positions }
        updateDiagram(next.dbml, next.positions)
        setEdgeVisibility({})
      }
    }
  }

  const renameTab = (idx: number) => {
    const name = prompt('Rename diagram:', diagrams[idx]?.name)
    if (name) {
      setDiagrams(prev => {
        const next = [...prev]
        next[idx] = { ...next[idx], name }
        return next
      })
      setTimeout(() => {
        const d = diagrams[idx]
        if (d) saveDiagram({ ...d, name })
      }, 100)
    }
  }

  const activeTable = hoveredTable || selectedTable

  // Filter edges based on visibility settings
  const visibleEdges = useMemo(() => {
    return edges.filter(e => {
      const sourceVis = edgeVisibility[e.source]
      const targetVis = edgeVisibility[e.target]
      // Hide if source table has outgoing hidden OR target table has incoming hidden
      if (sourceVis?.hideOutgoing) return false
      if (targetVis?.hideIncoming) return false
      return true
    })
  }, [edges, edgeVisibility])

  const styledEdges = useMemo(() => {
    if (!activeTable) {
      return visibleEdges.map(e => ({ ...e, style: { stroke: '#4b5563', strokeWidth: 1.5 }, animated: false }))
    }
    return visibleEdges.map(e => {
      if (e.source === activeTable) return { ...e, style: { stroke: '#f97316', strokeWidth: 2.5 }, animated: true, zIndex: 10 }
      if (e.target === activeTable) return { ...e, style: { stroke: '#3b82f6', strokeWidth: 2.5 }, animated: true, zIndex: 10 }
      return { ...e, style: { stroke: '#4b5563', strokeWidth: 1, opacity: 0.2 }, animated: false }
    })
  }, [visibleEdges, activeTable])

  // Add toggle callbacks and visibility state to nodes
  const styledNodes = useMemo(() => {
    const connected = new Set<string>()
    if (activeTable) {
      connected.add(activeTable)
      visibleEdges.forEach(e => {
        if (e.source === activeTable) connected.add(e.target)
        if (e.target === activeTable) connected.add(e.source)
      })
    }

    return nodes.map(n => ({
      ...n,
      data: {
        ...n.data,
        isHighlighted: n.id === activeTable,
        isDimmed: activeTable ? !connected.has(n.id) : false,
        hideIncoming: edgeVisibility[n.id]?.hideIncoming || false,
        hideOutgoing: edgeVisibility[n.id]?.hideOutgoing || false,
        onToggleIncoming: () => toggleIncoming(n.id),
        onToggleOutgoing: () => toggleOutgoing(n.id),
        onInfoEnter: handleInfoEnter,
        onInfoLeave: handleInfoLeave,
        onInfoClick: handleInfoClick,
        pinnedKey: pinnedInfo?.target.key ?? null,
      }
    }))
  }, [nodes, activeTable, visibleEdges, edgeVisibility, toggleIncoming, toggleOutgoing,
      handleInfoEnter, handleInfoLeave, handleInfoClick, pinnedInfo])

  const handleMouseDown = useCallback(() => {
    resizing.current = true
    const move = (e: MouseEvent) => { if (resizing.current) setPanelWidth(Math.max(250, Math.min(800, e.clientX))) }
    const up = () => { resizing.current = false; window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up) }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }, [])

  const handleManualSave = () => {
    const d = diagrams[activeIdx]
    if (d) saveDiagram({ ...d, positions: positionsRef.current, dbml: d.dbml })
  }

  // Count hidden edges
  const hiddenEdgeCount = edges.length - visibleEdges.length

  // A pinned card takes precedence over a transient hover preview
  const displayedInfo = pinnedInfo || hoverInfo

  return (
    <div className="h-screen w-screen flex flex-col bg-[#0d1117] overflow-hidden">
      {/* Tabs */}
      <div className="h-9 flex items-center bg-[#161b22] border-b border-white/10 px-1 gap-0.5 overflow-x-auto shrink-0">
        {diagrams.map((d, idx) => (
          <div
            key={d.id || idx}
            className={`flex items-center gap-1 px-3 h-7 rounded-t text-xs cursor-pointer shrink-0 ${
              idx === activeIdx ? 'bg-[#0d1117] text-white' : 'text-white/50 hover:text-white/70 hover:bg-white/5'
            }`}
            onClick={() => setActiveIdx(idx)}
            onDoubleClick={() => renameTab(idx)}
          >
            <span className="truncate max-w-[120px]">{d.name}</span>
            {diagrams.length > 1 && (
              <button onClick={e => { e.stopPropagation(); closeTab(idx) }} className="ml-1 text-white/30 hover:text-white/70">
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        ))}
        <button onClick={addTab} className="h-7 px-2 text-white/40 hover:text-white/70 text-xs flex items-center">
          <Plus className="w-3.5 h-3.5" />
        </button>
        <div className="flex-1" />
        <button onClick={handleManualSave} className="h-7 px-2 text-white/40 hover:text-white/70 text-xs flex items-center gap-1" title="Save">
          <Save className="w-3.5 h-3.5" />
          {saving && <span className="text-[10px]">saving...</span>}
        </button>
        {schema && schema.enums.length > 0 && (
          <button
            onClick={() => setShowEnums(v => !v)}
            className={`h-7 px-2 text-xs flex items-center gap-1 rounded ${
              showEnums ? 'text-purple-200 bg-purple-400/20' : 'text-white/40 hover:text-white/70'
            }`}
            title="Browse enums"
          >
            <List className="w-3.5 h-3.5" />
            <span className="text-[10px]">{schema.enums.length}</span>
          </button>
        )}
        {schema && (
          <span className="text-[10px] text-white/30 px-2">
            {schema.tables.length}T {visibleEdges.length}R
            {hiddenEdgeCount > 0 && <span className="text-yellow-500/70"> ({hiddenEdgeCount} hidden)</span>}
          </span>
        )}
      </div>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor Panel */}
        <div style={{ width: panelWidth }} className="flex flex-col shrink-0">
          <div className="flex-1">
            <Editor
              key={diagrams[activeIdx]?.id ?? `new-${activeIdx}`}
              defaultLanguage="plaintext"
              value={activeDiagram.dbml}
              onChange={handleEditorChange}
              theme="vs-dark"
              options={{
                fontSize: 13,
                minimap: { enabled: false },
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                padding: { top: 8 },
              }}
            />
          </div>
        </div>

        {/* Resize handle */}
        <div className="w-1 cursor-col-resize bg-white/5 hover:bg-blue-500/50 transition-colors shrink-0" onMouseDown={handleMouseDown} />

        {/* Diagram Panel */}
        <div className="flex-1 relative">
          <ReactFlow
            nodes={styledNodes}
            edges={styledEdges}
            onNodesChange={handleNodesChange}
            onEdgesChange={onEdgesChange}
            nodeTypes={nodeTypes}
            onNodeClick={(e, node) => {
              // Don't toggle highlight if shift/cmd is held (multi-select)
              if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
                setSelectedTable(node.id === selectedTable ? null : node.id)
              }
            }}
            onNodeMouseEnter={(_, node) => setHoveredTable(node.id)}
            onNodeMouseLeave={() => setHoveredTable(null)}
            onPaneClick={() => { setSelectedTable(null); setPinnedInfo(null); setShowEnums(false) }}
            selectionOnDrag
            selectionMode={SelectionMode.Partial}
            selectNodesOnDrag={false}
            panOnDrag={[1, 2]}
            panOnScroll
            zoomOnScroll={false}
            zoomOnPinch
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.05}
            maxZoom={2}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#1e293b" gap={24} size={1} />
            <Controls className="!bg-[#1c1f26] !border-white/10 !shadow-xl [&>button]:!bg-[#1c1f26] [&>button]:!border-white/10 [&>button]:!text-white/70 [&>button:hover]:!bg-white/10" />
            <MiniMap
              style={{ background: '#1c1f26', border: '1px solid rgba(255,255,255,0.1)' }}
              nodeColor={(n) => n.data?.headerColor || '#374151'}
              maskColor="rgba(0,0,0,0.5)"
            />
          </ReactFlow>

          {/* Enum index — reachable even when no enum-typed column is on screen */}
          {showEnums && schema && (
            <div className="absolute top-3 right-3 w-[280px] max-h-[70%] overflow-auto bg-[#161b22] border border-white/15 rounded-lg shadow-2xl text-xs z-40">
              <div className="sticky top-0 flex items-center px-3 py-2 bg-[#1c2129] border-b border-white/10">
                <span className="flex-1 text-white/70 font-medium">Enums</span>
                <button onClick={() => setShowEnums(false)} className="text-white/30 hover:text-white/80">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="divide-y divide-white/5">
                {schema.enums.map(en => {
                  const open = expandedEnums[en.name]
                  return (
                    <div key={en.name}>
                      <button
                        onClick={() => setExpandedEnums(p => ({ ...p, [en.name]: !p[en.name] }))}
                        className="w-full px-3 py-1.5 flex items-center gap-1.5 hover:bg-white/5 text-left"
                      >
                        {open ? <ChevronDown className="w-3 h-3 text-white/40 shrink-0" /> : <ChevronRight className="w-3 h-3 text-white/40 shrink-0" />}
                        <span className="flex-1 text-purple-200/90 font-mono truncate">{en.name}</span>
                        <span className="text-white/25 text-[10px]">{en.values.length}</span>
                      </button>
                      {open && (
                        <div className="px-3 pb-2 pl-7 space-y-1">
                          {en.values.map(v => (
                            <div key={v.name} className="flex items-baseline gap-2">
                              <span className="px-1.5 py-0.5 rounded bg-purple-400/15 text-purple-200 font-mono text-[11px] shrink-0">{v.name}</span>
                              {v.note && <span className="text-white/45 text-[11px] leading-snug">{v.note}</span>}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {activeTable && (
            <div className="absolute bottom-4 right-4 bg-[#1c1f26] border border-white/10 rounded-lg px-3 py-2 text-xs space-y-1">
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-orange-500" /><span className="text-white/60">Out</span></div>
              <div className="flex items-center gap-2"><div className="w-4 h-0.5 bg-blue-500" /><span className="text-white/60">In</span></div>
            </div>
          )}
        </div>
      </div>

      {/* Floating note / enum card, in screen space so it stays legible at any zoom */}
      {displayedInfo && (
        <InfoCard
          key={displayedInfo.target.key}
          target={displayedInfo.target}
          anchor={displayedInfo.anchor}
          pinned={!!pinnedInfo && pinnedInfo.target.key === displayedInfo.target.key}
          onClose={() => setPinnedInfo(null)}
        />
      )}
    </div>
  )
}

export default App
