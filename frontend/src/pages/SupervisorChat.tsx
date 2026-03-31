import { useState, useEffect, useRef } from 'react'
import {
  Send,
  Loader2,
  Sparkles,
  User,
  Table2,
  Code,
  ChevronDown,
  ChevronRight,
  Check,
  Network,
  MessageSquare,
  ArrowRight,
  Database,
} from 'lucide-react'
import { api } from '../api'
import type { GenieRoom } from '../api'

interface RoomResult {
  room_id: string
  room_title: string
  status: string
  text: string
  query: string
  description: string
  query_result: any
}

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  question?: string
  routedTo?: RoomResult[]
  allRooms?: { id: string; title: string }[]
}

export default function SupervisorChat() {
  const [rooms, setRooms] = useState<GenieRoom[]>([])
  const [loadingRooms, setLoadingRooms] = useState(true)
  const [selectedRooms, setSelectedRooms] = useState<Set<string>>(new Set())
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationState, setConversationState] = useState<Record<string, string>>({})
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    // Try cache first, fall back to live API
    api.cachedRooms()
      .then((r) => { setRooms(r.rooms); setLoadingRooms(false) })
      .catch(() => {
        api.listGenieRooms()
          .then((r) => { setRooms(r.rooms); setLoadingRooms(false) })
          .catch(() => setLoadingRooms(false))
      })
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const toggleRoom = (id: string) => {
    setSelectedRooms((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selectedRoomDescriptions = rooms
    .filter((r) => selectedRooms.has(r.id))
    .map((r) => ({ id: r.id, title: r.title, description: r.description }))

  const sendMessage = async () => {
    if (!input.trim() || loading || selectedRooms.size === 0) return
    const question = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setLoading(true)

    const currentRooms = selectedRoomDescriptions.map((r) => ({ id: r.id, title: r.title }))

    try {
      const result = await api.supervisorAsk({
        question,
        room_ids: Array.from(selectedRooms),
        room_descriptions: selectedRoomDescriptions,
        conversation_state: conversationState,
      })

      setConversationState(result.conversation_state)
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: result.answer,
          question,
          routedTo: result.routed_to,
          allRooms: currentRooms,
        },
      ])
    } catch (e: any) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: `Error: ${e.message}` },
      ])
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const hasSelection = selectedRooms.size > 0

  return (
    <div className="flex h-full">
      {/* Room selection panel */}
      <div
        className={`shrink-0 border-r border-[var(--border)] flex flex-col transition-all duration-200 ${
          panelCollapsed ? 'w-12' : 'w-[300px]'
        }`}
      >
        {panelCollapsed ? (
          <button
            onClick={() => setPanelCollapsed(false)}
            className="flex flex-col items-center gap-2 py-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="Expand panel"
          >
            <ChevronRight className="w-4 h-4" />
            <Network className="w-5 h-5" />
            <span
              className="text-[10px] font-medium"
              style={{ writingMode: 'vertical-rl' }}
            >
              {selectedRooms.size} rooms
            </span>
          </button>
        ) : (
          <>
            <div className="p-4 border-b border-[var(--border)]">
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <Network className="w-4 h-4 text-[#D0A33C]" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">
                    Select Rooms
                  </h3>
                </div>
                <button
                  onClick={() => setPanelCollapsed(true)}
                  className="p-1 rounded hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
                >
                  <ChevronDown className="w-4 h-4 rotate-90" />
                </button>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                The supervisor will route questions to the best room(s)
              </p>
            </div>

            <div className="flex-1 overflow-y-auto p-2">
              {loadingRooms ? (
                <div className="flex items-center justify-center py-12 text-[var(--text-secondary)] text-sm">
                  <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading rooms...
                </div>
              ) : rooms.length === 0 ? (
                <div className="text-center py-12 text-[var(--text-secondary)] text-sm">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-20" />
                  <p>No Genie Rooms found</p>
                  <p className="text-xs mt-1">Create rooms first</p>
                </div>
              ) : (
                rooms.map((room) => {
                  const isSelected = selectedRooms.has(room.id)
                  return (
                    <button
                      key={room.id}
                      onClick={() => toggleRoom(room.id)}
                      className={`w-full flex items-start gap-3 p-3 rounded-lg text-left transition-all mb-1 ${
                        isSelected
                          ? 'bg-[#D0A33C]/10 border border-[#D0A33C]/30'
                          : 'hover:bg-[var(--bg-hover)] border border-transparent'
                      }`}
                    >
                      <div
                        className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center mt-0.5 transition-all ${
                          isSelected
                            ? 'bg-[#D0A33C] border-[#D0A33C]'
                            : 'border-[var(--border)] hover:border-[#D0A33C]'
                        }`}
                      >
                        {isSelected && <Check className="w-3 h-3 text-white" />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-[var(--text-primary)] truncate">
                          {room.title}
                        </p>
                        {room.description && (
                          <p className="text-[11px] text-[var(--text-secondary)] mt-0.5 line-clamp-2">
                            {room.description}
                          </p>
                        )}
                      </div>
                    </button>
                  )
                })
              )}
            </div>

            {selectedRooms.size > 0 && (
              <div className="p-3 border-t border-[var(--border)] bg-[var(--bg-tertiary)]">
                <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                  <div className="flex -space-x-1">
                    {Array.from(selectedRooms)
                      .slice(0, 3)
                      .map((id) => (
                        <div
                          key={id}
                          className="w-5 h-5 rounded-full bg-[#D0A33C]/20 border-2 border-[var(--bg-tertiary)] flex items-center justify-center"
                        >
                          <Sparkles className="w-2.5 h-2.5 text-[#D0A33C]" />
                        </div>
                      ))}
                    {selectedRooms.size > 3 && (
                      <div className="w-5 h-5 rounded-full bg-[var(--bg-hover)] border-2 border-[var(--bg-tertiary)] flex items-center justify-center text-[9px] font-medium">
                        +{selectedRooms.size - 3}
                      </div>
                    )}
                  </div>
                  <span>{selectedRooms.size} room{selectedRooms.size !== 1 ? 's' : ''} selected</span>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="shrink-0 px-5 py-4 border-b border-[var(--border)] bg-[var(--bg-secondary)] flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Network className="w-4 h-4 text-white" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-[var(--text-primary)]">
              Supervisor Agent
            </h2>
            <p className="text-[11px] text-[var(--text-secondary)]">
              Routes questions to the best Genie room(s) automatically
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)]">
              <Network className="w-16 h-16 mb-4 opacity-15" />
              <p className="text-xl font-medium text-[var(--text-primary)] opacity-60 mb-2">
                Multi-Room Supervisor
              </p>
              <p className="text-sm mb-4 text-center max-w-md">
                Select Genie rooms from the panel, then ask a question. The supervisor
                will analyze your question and route it to the most relevant room(s).
              </p>
              {!hasSelection && (
                <div className="flex items-center gap-2 text-xs bg-amber-500/10 text-amber-600 px-3 py-2 rounded-lg">
                  <ArrowRight className="w-3.5 h-3.5" />
                  Select at least one room to get started
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div
              key={i}
              className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}
            >
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0 mt-0.5">
                  <Network className="w-4 h-4 text-white" />
                </div>
              )}
              <div
                className={`max-w-[75%] ${
                  msg.role === 'user'
                    ? 'bg-[#3F1F14] text-white rounded-2xl rounded-br-md px-4 py-2.5'
                    : 'space-y-3'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm">{msg.content}</p>
                ) : (
                  <>
                    {/* Routing flow visualization */}
                    {msg.routedTo && msg.routedTo.length > 0 && msg.allRooms && (
                      <RoutingFlowChart
                        question={msg.question || ''}
                        allRooms={msg.allRooms}
                        routedTo={msg.routedTo}
                      />
                    )}

                    <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3">
                      <p className="text-sm leading-relaxed whitespace-pre-wrap">
                        {msg.content}
                      </p>
                    </div>

                    {/* Routing details accordion */}
                    {msg.routedTo && msg.routedTo.length > 0 && (
                      <RoutingDetails results={msg.routedTo} />
                    )}
                  </>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-lg bg-[var(--bg-tertiary)] flex items-center justify-center shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-[var(--text-secondary)]" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
                <Network className="w-4 h-4 text-white" />
              </div>
              <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3">
                <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Routing & querying rooms...
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-5 py-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex gap-3 items-center max-w-3xl mx-auto">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={
                hasSelection
                  ? 'Ask a question across your selected rooms...'
                  : 'Select rooms from the panel first...'
              }
              disabled={loading || !hasSelection}
              className="flex-1 px-4 py-3 rounded-xl bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm disabled:opacity-50"
              autoFocus
            />
            <button
              onClick={sendMessage}
              disabled={loading || !input.trim() || !hasSelection}
              className="p-3 rounded-xl bg-[#D0A33C] hover:bg-[#b88d2e] text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── Routing flow visualization ──

function RoutingFlowChart({
  question,
  allRooms,
  routedTo,
}: {
  question: string
  allRooms: { id: string; title: string }[]
  routedTo: RoomResult[]
}) {
  const routedIds = new Set(routedTo.map((r) => r.room_id))

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
        <Network className="w-3.5 h-3.5 text-amber-500" />
        <span className="text-xs font-medium text-[var(--text-primary)]">Routing Decision</span>
      </div>

      <div className="p-3 space-y-3">
        {/* Step 1: Question */}
        <div className="flex items-start gap-2.5">
          <div className="shrink-0 w-6 h-6 rounded-full bg-[#3F1F14] flex items-center justify-center text-[10px] font-bold text-white">1</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-0.5">Question received</p>
            <p className="text-xs text-[var(--text-primary)] leading-snug">&ldquo;{question.length > 80 ? question.slice(0, 79) + '...' : question}&rdquo;</p>
          </div>
        </div>

        {/* Connector */}
        <div className="ml-3 border-l-2 border-dashed border-[#D0A33C]/30 h-2" />

        {/* Step 2: Supervisor analyzes */}
        <div className="flex items-start gap-2.5">
          <div className="shrink-0 w-6 h-6 rounded-full bg-[#D0A33C] flex items-center justify-center text-[10px] font-bold text-white">2</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-0.5">Supervisor analyzed {allRooms.length} rooms</p>
            <p className="text-[10px] text-[var(--text-secondary)]">
              Selected <span className="font-semibold text-[#D0A33C]">{routedTo.length}</span> room{routedTo.length !== 1 ? 's' : ''} to answer
            </p>
          </div>
        </div>

        {/* Connector */}
        <div className="ml-3 border-l-2 border-dashed border-[#D0A33C]/30 h-2" />

        {/* Step 3: Room cards */}
        <div className="flex items-start gap-2.5">
          <div className="shrink-0 w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-[10px] font-bold text-white">3</div>
          <div className="flex-1 min-w-0">
            <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Routed to</p>
            <div className="flex flex-wrap gap-1.5">
              {allRooms.map((room) => {
                const isRouted = routedIds.has(room.id)
                const result = routedTo.find((r) => r.room_id === room.id)
                return (
                  <div
                    key={room.id}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium transition-all ${
                      isRouted
                        ? result?.status === 'COMPLETED'
                          ? 'bg-emerald-500/15 text-emerald-700 border border-emerald-500/30'
                          : result?.status === 'FAILED'
                            ? 'bg-red-500/10 text-red-600 border border-red-500/20'
                            : 'bg-[#D0A33C]/10 text-[#D0A33C] border border-[#D0A33C]/30'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-transparent opacity-40 line-through'
                    }`}
                  >
                    {isRouted ? (
                      result?.status === 'COMPLETED' ? <Check className="w-3 h-3" /> : <Loader2 className="w-3 h-3" />
                    ) : (
                      <span className="w-3 h-3 text-center leading-3">&mdash;</span>
                    )}
                    {room.title}
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}


// ── Routing details accordion ──

function RoutingDetails({ results }: { results: RoomResult[] }) {
  const [open, setOpen] = useState(false)

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Network className="w-3.5 h-3.5" />
        <span>
          Routed to {results.length} room{results.length !== 1 ? 's' : ''}
        </span>
        <div className="flex items-center gap-1 ml-1">
          {results.map((r) => (
            <span
              key={r.room_id}
              className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium ${
                r.status === 'COMPLETED'
                  ? 'bg-emerald-500/10 text-emerald-600'
                  : r.status === 'FAILED'
                    ? 'bg-red-500/10 text-red-500'
                    : 'bg-amber-500/10 text-amber-600'
              }`}
            >
              {r.room_title}
            </span>
          ))}
        </div>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        )}
      </button>
      {open && (
        <div className="divide-y divide-[var(--border)]">
          {results.map((r) => (
            <div key={r.room_id} className="px-4 py-3">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-3.5 h-3.5 text-[#D0A33C]" />
                <span className="text-sm font-medium text-[var(--text-primary)]">
                  {r.room_title}
                </span>
                <span
                  className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                    r.status === 'COMPLETED'
                      ? 'bg-emerald-500/10 text-emerald-600'
                      : r.status === 'FAILED'
                        ? 'bg-red-500/10 text-red-500'
                        : 'bg-amber-500/10 text-amber-600'
                  }`}
                >
                  {r.status}
                </span>
              </div>
              {r.text && (
                <p className="text-xs text-[var(--text-secondary)] mb-2">
                  {r.text}
                </p>
              )}
              {r.query && <SqlBlock sql={r.query} />}
              {r.query_result && <QueryResultTable data={r.query_result} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Shared components ──

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden mt-2">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Code className="w-3.5 h-3.5" />
        <span>Generated SQL</span>
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 ml-auto" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 ml-auto" />
        )}
      </button>
      {open && (
        <pre className="px-4 py-3 bg-[var(--bg-tertiary)] text-sm text-[#325B6D] overflow-x-auto font-mono">
          {sql}
        </pre>
      )}
    </div>
  )
}

function QueryResultTable({ data }: { data: any }) {
  const columns: string[] =
    data?.manifest?.schema?.columns?.map((c: any) => c.name) || []
  const rows: any[][] = data?.result?.data_array || []

  if (columns.length === 0 || rows.length === 0) return null

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden mt-2">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)]">
        <Table2 className="w-3.5 h-3.5" />
        <span>
          {rows.length} row{rows.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="overflow-x-auto max-h-60">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-secondary)]">
              {columns.map((col) => (
                <th
                  key={col}
                  className="text-left px-4 py-2 font-medium text-[var(--text-secondary)] whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                className={`border-t border-[var(--border)] ${
                  i % 2 === 0 ? '' : 'bg-[var(--bg-secondary)]'
                }`}
              >
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-1.5 whitespace-nowrap">
                    {cell ?? '\u2014'}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
