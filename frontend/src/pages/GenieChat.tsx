import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Send,
  Loader2,
  Sparkles,
  User,
  Table2,
  Code,
  ChevronDown,
  ChevronRight,
  Bookmark,
  BarChart3,
  Check,
  MessageSquare,
  Trash2,
  Clock,
  Zap,
  BotMessageSquare,
  RotateCcw,
  Play,
  Database,
  Plus,
} from 'lucide-react'
import { api } from '../api'
import type { SavedQuestion, Warehouse, SemanticCacheStats } from '../api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sql?: string
  queryResult?: any
  description?: string
  status?: string
  userQuestion?: string
  cacheHit?: boolean
  cacheSimilarity?: number
}

export default function GenieChat() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const [roomTitle, setRoomTitle] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // Mode: 'genie' uses Genie API, 'semantic' executes saved SQL directly
  const [mode, setMode] = useState<'genie' | 'semantic'>('genie')
  const [warehouseId, setWarehouseId] = useState('')

  // Warehouses
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [whDropdownOpen, setWhDropdownOpen] = useState(false)
  const [startingWh, setStartingWh] = useState<string | null>(null)

  // Current user
  const [userId, setUserId] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Sidebar
  const [sidebarTab, setSidebarTab] = useState<'saved' | 'history' | 'cache'>('saved')
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestion[]>([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [dbAvailable, setDbAvailable] = useState(true)
  const [historyQuestions, setHistoryQuestions] = useState<string[]>([])

  // Room sample queries
  const [sampleQueries, setSampleQueries] = useState<{ question: string; sql: string }[]>([])

  // Semantic cache
  const [cacheStats, setCacheStats] = useState<SemanticCacheStats | null>(null)
  const [similarityThreshold, setSimilarityThreshold] = useState(0.80)
  // Query source notification
  const [queryNotification, setQueryNotification] = useState<{
    type: 'cache-hit' | 'cache-miss' | 'genie-api'
    similarity?: number
    threshold?: number
    message: string
  } | null>(null)
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotification = (notif: typeof queryNotification) => {
    if (notificationTimer.current) clearTimeout(notificationTimer.current)
    setQueryNotification(notif)
    notificationTimer.current = setTimeout(() => setQueryNotification(null), 6000)
  }

  // Load room details, warehouses, and current user
  useEffect(() => {
    if (roomId) {
      api.getGenieRoom(roomId).then((r) => {
        setRoomTitle(r.title || 'Genie Room')
        if (r.warehouse_id) setWarehouseId(r.warehouse_id)
        if (r.sample_queries?.length) setSampleQueries(r.sample_queries)
      }).catch(() => setRoomTitle('Genie Room'))
    }
    api.getCurrentUser().then((u) => setUserId(u.id)).catch(() => {})
    api.listWarehouses().then((r) => setWarehouses(r.warehouses || [])).catch(() => {})
  }, [roomId])

  // Load semantic cache stats
  const refreshCacheStats = useCallback(() => {
    if (!roomId) return
    api.semanticCacheStats(roomId).then(setCacheStats).catch(() => {})
  }, [roomId])

  useEffect(() => { refreshCacheStats() }, [refreshCacheStats])

  // Load chat history once we have roomId + userId
  useEffect(() => {
    if (!roomId || !userId || historyLoaded) return
    api.getChatHistory(roomId, userId).then((r) => {
      if (r.messages.length > 0) {
        setMessages(r.messages.map((m) => ({
          role: m.role,
          content: m.content,
          sql: m.sql || undefined,
          queryResult: m.queryResult || undefined,
          description: m.description || undefined,
          status: m.status || undefined,
          userQuestion: m.userQuestion || undefined,
        })))
        // Populate history questions from persisted messages
        const userQs = r.messages
          .filter((m) => m.role === 'user')
          .map((m) => m.content)
        setHistoryQuestions(userQs)
      }
      setHistoryLoaded(true)
    }).catch(() => setHistoryLoaded(true))
  }, [roomId, userId, historyLoaded])

  const loadSavedQuestions = useCallback(async () => {
    if (!roomId) return
    setSavedLoading(true)
    try {
      const r = await api.listSavedQuestions(roomId)
      setSavedQuestions(r.questions)
      setDbAvailable(r.db_available)
    } catch {
      setDbAvailable(false)
    }
    setSavedLoading(false)
  }, [roomId])

  useEffect(() => {
    loadSavedQuestions()
  }, [loadSavedQuestions])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const persistMsg = (msg: ChatMessage) => {
    if (!roomId || !userId) return
    api.saveChatMessage({
      room_id: roomId,
      user_id: userId,
      role: msg.role,
      content: msg.content,
      sql_text: msg.sql || undefined,
      query_result: msg.queryResult || undefined,
      description: msg.description || undefined,
      status: msg.status || undefined,
      user_question: msg.userQuestion || undefined,
    }).catch(() => {})
  }

  const sendMessage = async (overrideInput?: string) => {
    const msg = overrideInput ?? input.trim()
    if (!msg || loading || !roomId) return
    if (!overrideInput) setInput('')
    const userMsg: ChatMessage = { role: 'user', content: msg }
    setMessages((prev) => [...prev, userMsg])
    persistMsg(userMsg)
    setHistoryQuestions((prev) => prev.includes(msg) ? prev : [...prev, msg])
    setLoading(true)

    try {
      // Check semantic cache first
      let cacheResult: any = null
      try {
        cacheResult = await api.semanticCacheLookup(roomId, msg, similarityThreshold)
      } catch { /* cache miss or unavailable */ }

      if (cacheResult?.hit) {
        const assistantMsg: ChatMessage = {
          role: 'assistant',
          content: cacheResult.response,
          sql: cacheResult.metadata?.sql || '',
          queryResult: cacheResult.metadata?.query_result || null,
          description: cacheResult.metadata?.description || '',
          status: 'COMPLETED',
          userQuestion: msg,
          cacheHit: true,
          cacheSimilarity: cacheResult.similarity,
        }
        setMessages((prev) => [...prev, assistantMsg])
        persistMsg(assistantMsg)
        refreshCacheStats()
        showNotification({
          type: 'cache-hit',
          similarity: cacheResult.similarity,
          threshold: cacheResult.threshold,
          message: 'Answered from Lakebase semantic cache',
        })
        setLoading(false)
        inputRef.current?.focus()
        return
      }

      // Show near-miss info, then proceed to Genie API
      if (cacheResult && !cacheResult.hit && cacheResult.similarity > 0) {
        showNotification({
          type: 'cache-miss',
          similarity: cacheResult.similarity,
          threshold: cacheResult.threshold,
          message: 'Cache miss — querying Genie API',
        })
      } else {
        showNotification({
          type: 'genie-api',
          message: 'Querying Genie API',
        })
      }

      // Cache miss — call Genie API
      let result: any
      if (!conversationId) {
        result = await api.startConversation(roomId, msg)
        setConversationId(result.conversation_id)
      } else {
        result = await api.sendMessage(roomId, conversationId, msg)
      }

      const r = result.result || {}
      const assistantMsg: ChatMessage = {
        role: 'assistant',
        content: r.text || r.description || '',
        sql: r.query || '',
        queryResult: r.query_result || null,
        description: r.description || '',
        status: r.status || '',
        userQuestion: msg,
      }

      if (!assistantMsg.content && r.message) {
        const attachments = r.message.attachments || []
        for (const att of attachments) {
          if (att.text?.content) {
            assistantMsg.content = att.text.content
          }
        }
      }

      if (!assistantMsg.content && assistantMsg.sql) {
        assistantMsg.content = assistantMsg.description || 'Here are the results:'
      }

      if (!assistantMsg.content) {
        assistantMsg.content = r.status === 'FAILED'
          ? 'Sorry, I was unable to answer that question. Please try rephrasing.'
          : 'Processing complete.'
      }

      setMessages((prev) => [...prev, assistantMsg])
      persistMsg(assistantMsg)

      // Cache successful responses for future semantic matching
      if (assistantMsg.status !== 'FAILED' && assistantMsg.content) {
        api.semanticCacheSet(roomId, msg, assistantMsg.content, {
          sql: assistantMsg.sql || '',
          description: assistantMsg.description || '',
          query_result: assistantMsg.queryResult || null,
        }).then(() => {
          showNotification({
            type: 'genie-api',
            message: 'Response cached to Lakebase for future questions',
          })
          refreshCacheStats()
        }).catch(() => {})
      }
    } catch (e: any) {
      const errMsg: ChatMessage = { role: 'assistant', content: `Error: ${e.message}`, status: 'FAILED' }
      setMessages((prev) => [...prev, errMsg])
      persistMsg(errMsg)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  const handleSaveQuestion = async (question: string, sql: string) => {
    if (!roomId) return
    try {
      await api.saveQuestion({ room_id: roomId, question, sql })
      loadSavedQuestions()
    } catch { /* silent */ }
  }

  const handleAddSampleQuestion = async (question: string, sql: string) => {
    if (!roomId) return
    const updated = [...sampleQueries, { question, sql }]
    await api.updateGenieRoom(roomId, { sample_queries: updated })
    setSampleQueries(updated)
  }

  const handleDeleteSaved = async (id: string) => {
    try {
      await api.deleteSavedQuestion(id)
      setSavedQuestions((prev) => prev.filter((q) => q.id !== id))
    } catch { /* silent */ }
  }

  const executeSavedSql = async (question: string, sql: string) => {
    if (loading || !warehouseId) return
    const userMsg: ChatMessage = { role: 'user', content: question }
    setMessages((prev) => [...prev, userMsg])
    persistMsg(userMsg)
    setLoading(true)
    try {
      const data = await api.executeSql(warehouseId, sql)
      const state = data?.status?.state || ''
      if (state === 'SUCCEEDED') {
        const manifest = data?.manifest || {}
        const result = data?.result || {}
        const aMsg: ChatMessage = {
          role: 'assistant',
          content: 'Here are the results:',
          sql,
          queryResult: { manifest, result },
          status: 'COMPLETED',
          userQuestion: question,
        }
        setMessages((prev) => [...prev, aMsg])
        persistMsg(aMsg)
      } else {
        const errText = data?.status?.error?.message || 'Query execution failed'
        const aMsg: ChatMessage = { role: 'assistant', content: `Error: ${errText}`, sql, status: 'FAILED', userQuestion: question }
        setMessages((prev) => [...prev, aMsg])
        persistMsg(aMsg)
      }
    } catch (e: any) {
      const aMsg: ChatMessage = { role: 'assistant', content: `Error: ${e.message}`, status: 'FAILED' }
      setMessages((prev) => [...prev, aMsg])
      persistMsg(aMsg)
    } finally {
      setLoading(false)
      inputRef.current?.focus()
    }
  }

  // Deduplicated history (persisted + current session)
  const pastQuestions = historyQuestions

  return (
    <div className="flex h-full bg-gradient-to-b from-[#f2efe9] to-[#e8e3da]">
      {/* Sidebar */}
      <div className="w-72 shrink-0 bg-[var(--bg-secondary)] border-r border-[var(--border)] flex flex-col">
        {/* Sidebar header */}
        <div className="shrink-0 px-4 py-3 border-b border-[var(--border)]">
          <div className="flex items-center gap-2 mb-3">
            <button
              onClick={() => navigate('/rooms')}
              className="p-1 rounded-md hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-semibold text-[var(--text-primary)] truncate">{roomTitle}</h2>
              <p className="text-[10px] text-[var(--text-secondary)]">AI/BI Genie</p>
            </div>
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#D0A33C] to-[#3F1F14] flex items-center justify-center shrink-0">
              <Sparkles className="w-3.5 h-3.5 text-white" />
            </div>
          </div>

          {/* Warehouse selector */}
          <div className="relative mb-3">
            <button
              onClick={() => setWhDropdownOpen(!whDropdownOpen)}
              className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] hover:border-[var(--text-secondary)] transition-colors text-left"
            >
              <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                warehouses.find((w) => w.id === warehouseId)?.state === 'RUNNING'
                  ? 'bg-emerald-500' : 'bg-amber-500'
              }`} />
              <div className="flex-1 min-w-0">
                <p className="text-[10px] text-[var(--text-secondary)] leading-none mb-0.5">SQL Warehouse</p>
                <p className="text-xs font-medium text-[var(--text-primary)] truncate">
                  {warehouses.find((w) => w.id === warehouseId)?.name || warehouseId || 'Not set'}
                </p>
              </div>
              <ChevronDown className={`w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0 transition-transform ${whDropdownOpen ? 'rotate-180' : ''}`} />
            </button>
            {whDropdownOpen && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg shadow-lg overflow-hidden max-h-48 overflow-y-auto">
                {warehouses.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-[var(--text-secondary)]">No warehouses found</div>
                ) : (
                  warehouses.map((wh) => {
                    const isStopped = wh.state === 'STOPPED'
                    const isStarting = startingWh === wh.id || wh.state === 'STARTING'
                    return (
                      <div
                        key={wh.id}
                        className={`flex items-center gap-2 px-3 py-2 hover:bg-[var(--bg-hover)] transition-colors ${
                          wh.id === warehouseId ? 'bg-[#D0A33C]/10' : ''
                        }`}
                      >
                        <button
                          onClick={() => { setWarehouseId(wh.id); setWhDropdownOpen(false) }}
                          className="flex items-center gap-2 flex-1 min-w-0 text-left"
                        >
                          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                            wh.state === 'RUNNING' ? 'bg-emerald-500' : isStarting ? 'bg-amber-500 animate-pulse' : 'bg-gray-400'
                          }`} />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs font-medium text-[var(--text-primary)] truncate">{wh.name}</p>
                            <p className="text-[10px] text-[var(--text-secondary)]">
                              {isStarting ? 'Starting...' : wh.state} &middot; {wh.cluster_size}
                            </p>
                          </div>
                          {wh.id === warehouseId && <Check className="w-3.5 h-3.5 text-[#D0A33C] shrink-0" />}
                        </button>
                        {(isStopped && !isStarting) && (
                          <button
                            onClick={async (e) => {
                              e.stopPropagation()
                              setStartingWh(wh.id)
                              try {
                                await api.startWarehouse(wh.id)
                                setWarehouses((prev) =>
                                  prev.map((w) => w.id === wh.id ? { ...w, state: 'STARTING' } : w)
                                )
                              } catch { /* silent */ }
                              finally { setStartingWh(null) }
                            }}
                            className="p-1.5 rounded-md bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-600 transition-colors shrink-0"
                            title="Start warehouse"
                          >
                            <Play className="w-3 h-3" />
                          </button>
                        )}
                        {isStarting && (
                          <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin shrink-0" />
                        )}
                      </div>
                    )
                  })
                )}
              </div>
            )}
          </div>

          {/* Tabs */}
          <div className="flex bg-[var(--bg-tertiary)] rounded-lg p-0.5">
            <button
              onClick={() => setSidebarTab('saved')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                sidebarTab === 'saved'
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Bookmark className="w-3 h-3" /> Saved
            </button>
            <button
              onClick={() => setSidebarTab('history')}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                sidebarTab === 'history'
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Clock className="w-3 h-3" /> History
            </button>
            <button
              onClick={() => { setSidebarTab('cache'); refreshCacheStats() }}
              className={`flex-1 flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-xs font-medium transition-colors ${
                sidebarTab === 'cache'
                  ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Database className="w-3 h-3" /> Cache
            </button>
          </div>
        </div>

        {/* Sidebar content */}
        <div className="flex-1 overflow-y-auto">
          {sidebarTab === 'saved' && (
            <div className="p-3 space-y-1.5">
              {savedLoading ? (
                <div className="flex items-center justify-center py-10 text-[var(--text-secondary)]">
                  <Loader2 className="w-4 h-4 animate-spin" />
                </div>
              ) : !dbAvailable ? (
                <div className="text-center py-10 px-3">
                  <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-15" />
                  <p className="text-xs text-[var(--text-secondary)]">Database not connected. Saved questions will be available once Lakebase is configured.</p>
                </div>
              ) : savedQuestions.length === 0 ? (
                <div className="text-center py-10 px-3">
                  <Bookmark className="w-8 h-8 mx-auto mb-2 opacity-15" />
                  <p className="text-xs text-[var(--text-secondary)]">No saved questions yet.</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1">Click "Save question" on any response to save it here.</p>
                </div>
              ) : (
                savedQuestions.map((sq) => (
                  <div key={sq.id} className="group rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] hover:border-[#D0A33C]/30 transition-colors">
                    <button
                      onClick={() => mode === 'semantic' ? executeSavedSql(sq.question, sq.sql) : sendMessage(sq.question)}
                      className="w-full text-left p-3"
                    >
                      <p className="text-xs font-medium text-[var(--text-primary)] leading-snug mb-1 line-clamp-2">{sq.question}</p>
                      <p className="text-[10px] font-mono text-[#D0A33C]/70 truncate">{sq.sql.slice(0, 60)}...</p>
                    </button>
                    <div className="px-3 pb-2 flex items-center justify-between">
                      <span className="text-[9px] text-[var(--text-secondary)]">
                        {new Date(sq.created_at).toLocaleDateString()}
                      </span>
                      <button
                        onClick={() => handleDeleteSaved(sq.id)}
                        className="p-1 rounded text-[var(--text-secondary)] hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {sidebarTab === 'history' && (
            <div className="p-3 space-y-1">
              {pastQuestions.length === 0 ? (
                <div className="text-center py-10 px-3">
                  <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-15" />
                  <p className="text-xs text-[var(--text-secondary)]">No messages yet.</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1">Your questions will appear here.</p>
                </div>
              ) : (
                pastQuestions.map((q, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(q)}
                    className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    <p className="text-xs text-[var(--text-primary)] leading-snug line-clamp-2">{q}</p>
                  </button>
                ))
              )}
            </div>
          )}

          {sidebarTab === 'cache' && (
            <div className="p-3 space-y-3">
              {/* How it works */}
              <div className="rounded-lg bg-[#D0A33C]/5 border border-[#D0A33C]/15 p-3">
                <p className="text-[10px] font-semibold text-[var(--text-primary)] mb-1.5">How Semantic Cache works</p>
                <ol className="text-[10px] text-[var(--text-secondary)] space-y-1 list-decimal list-inside leading-relaxed">
                  <li>You ask a question in chat</li>
                  <li>The question is converted to a vector embedding</li>
                  <li>Lakebase searches for similar past questions using pgvector</li>
                  <li>If a match is found (above your similarity threshold), the cached answer is returned instantly</li>
                  <li>If no match, Genie answers and the response is cached for next time</li>
                </ol>
              </div>

              {/* Similarity threshold slider */}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] font-semibold text-[var(--text-primary)]">Similarity Threshold</p>
                  <span className="text-xs font-mono font-semibold text-[#D0A33C]">{Math.round(similarityThreshold * 100)}%</span>
                </div>
                <input
                  type="range"
                  min={50}
                  max={100}
                  step={1}
                  value={Math.round(similarityThreshold * 100)}
                  onChange={(e) => setSimilarityThreshold(Number(e.target.value) / 100)}
                  className="w-full h-1.5 rounded-full appearance-none cursor-pointer accent-[#D0A33C] bg-[var(--bg-tertiary)]"
                />
                <div className="flex justify-between mt-1">
                  <span className="text-[9px] text-[var(--text-secondary)]">50% (loose)</span>
                  <span className="text-[9px] text-[var(--text-secondary)]">100% (exact)</span>
                </div>
                <p className="text-[9px] text-[var(--text-secondary)] mt-1.5 leading-relaxed">
                  Lower values return more cache hits but may be less precise. Higher values require closer semantic matches.
                </p>
              </div>

              {/* Stats */}
              {cacheStats ? (
                <div className="space-y-2">
                  <p className="text-[10px] font-semibold text-[var(--text-primary)]">Room Cache Stats</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="rounded-lg bg-[var(--bg-tertiary)] p-2.5 text-center">
                      <p className="text-lg font-bold text-[var(--text-primary)]">{cacheStats.total_entries}</p>
                      <p className="text-[9px] text-[var(--text-secondary)]">Cached Responses</p>
                    </div>
                    <div className="rounded-lg bg-[var(--bg-tertiary)] p-2.5 text-center">
                      <p className="text-lg font-bold text-[#D0A33C]">{cacheStats.total_hits}</p>
                      <p className="text-[9px] text-[var(--text-secondary)]">Cache Hits</p>
                    </div>
                  </div>
                  {cacheStats.total_entries > 0 && (
                    <div className="rounded-lg bg-[var(--bg-tertiary)] p-2.5">
                      <div className="flex justify-between text-[10px]">
                        <span className="text-[var(--text-secondary)]">Avg hits per entry</span>
                        <span className="font-medium text-[var(--text-primary)]">{cacheStats.avg_hits_per_entry.toFixed(1)}</span>
                      </div>
                      {cacheStats.oldest_entry && (
                        <div className="flex justify-between text-[10px] mt-1">
                          <span className="text-[var(--text-secondary)]">First cached</span>
                          <span className="font-medium text-[var(--text-primary)]">{new Date(cacheStats.oldest_entry).toLocaleDateString()}</span>
                        </div>
                      )}
                      {cacheStats.most_recent_access && (
                        <div className="flex justify-between text-[10px] mt-1">
                          <span className="text-[var(--text-secondary)]">Last accessed</span>
                          <span className="font-medium text-[var(--text-primary)]">{new Date(cacheStats.most_recent_access).toLocaleDateString()}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-6">
                  <Database className="w-8 h-8 mx-auto mb-2 opacity-15" />
                  <p className="text-xs text-[var(--text-secondary)]">No cache data yet.</p>
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1">Ask questions and responses will be cached automatically.</p>
                </div>
              )}

              {/* Tech stack */}
              <div className="rounded-lg border border-[var(--border)] p-3">
                <p className="text-[10px] font-semibold text-[var(--text-primary)] mb-1.5">Powered by</p>
                <div className="space-y-1 text-[10px] text-[var(--text-secondary)]">
                  <p><span className="font-medium text-[var(--text-primary)]">Databricks Lakebase</span> — Managed PostgreSQL with pgvector</p>
                  <p><span className="font-medium text-[var(--text-primary)]">BGE-Large</span> — 1024-dim embeddings via Foundation Model API</p>
                  <p><span className="font-medium text-[var(--text-primary)]">Cosine Similarity</span> — IVFFlat index for fast vector search</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main chat area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-6">
          <div className="max-w-3xl mx-auto px-6 space-y-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-[var(--text-secondary)]">
                {mode === 'genie' ? (
                  <>
                    <Sparkles className="w-16 h-16 mb-4 opacity-15" />
                    <p className="text-xl font-medium text-[var(--text-primary)] opacity-60 mb-2">Ask anything about your data</p>
                    <p className="text-sm mb-5">Type a question below or try one of these</p>

                    {/* Sample questions */}
                    {sampleQueries.length > 0 && (
                      <div className="w-full max-w-lg space-y-2 mb-5">
                        {sampleQueries.slice(0, 5).map((sq, i) => (
                          <button
                            key={i}
                            onClick={() => sendMessage(sq.question)}
                            disabled={loading}
                            className="w-full text-left px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[#D0A33C]/40 hover:bg-[#D0A33C]/5 transition-all group"
                          >
                            <div className="flex items-start gap-3">
                              <MessageSquare className="w-4 h-4 text-[#D0A33C] shrink-0 mt-0.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                              <span className="text-sm text-[var(--text-primary)]">{sq.question}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    {/* Saved questions as suggestions if no sample queries */}
                    {sampleQueries.length === 0 && savedQuestions.length > 0 && (
                      <div className="w-full max-w-lg space-y-2 mb-5">
                        <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Saved questions</p>
                        {savedQuestions.slice(0, 4).map((sq) => (
                          <button
                            key={sq.id}
                            onClick={() => sendMessage(sq.question)}
                            disabled={loading}
                            className="w-full text-left px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[#D0A33C]/40 hover:bg-[#D0A33C]/5 transition-all group"
                          >
                            <div className="flex items-start gap-3">
                              <Bookmark className="w-4 h-4 text-[#D0A33C] shrink-0 mt-0.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                              <span className="text-sm text-[var(--text-primary)]">{sq.question}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-[#D0A33C]/5 border border-[#D0A33C]/15 text-[11px] text-[var(--text-secondary)]">
                      <Zap className="w-3.5 h-3.5 text-[#D0A33C]" />
                      Semantic Cache enabled — repeat questions are answered instantly from Lakebase
                    </div>
                  </>
                ) : (
                  <>
                    <Zap className="w-16 h-16 mb-4 opacity-15" />
                    <p className="text-xl font-medium text-[var(--text-primary)] opacity-60 mb-2">Semantic Mode</p>
                    <p className="text-sm">Click a saved question to execute its SQL directly</p>
                  </>
                )}
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#D0A33C] to-[#3F1F14] flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-[#3F1F14] text-white rounded-2xl rounded-br-md px-4 py-2.5'
                      : 'space-y-3'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <>
                      {msg.cacheHit && (
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[#D0A33C]/10 border border-[#D0A33C]/20">
                          <Zap className="w-3.5 h-3.5 text-[#D0A33C]" />
                          <div>
                            <p className="text-[11px] font-semibold text-[#D0A33C]">
                              Semantic Cache Hit — {Math.round((msg.cacheSimilarity || 0) * 100)}% match
                            </p>
                            <p className="text-[10px] text-[var(--text-secondary)]">
                              Retrieved from Lakebase cache. No Genie API call needed.
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                      {msg.sql && <SqlBlock sql={msg.sql} />}
                      {msg.queryResult && <QueryResultTable data={msg.queryResult} />}
                      {msg.userQuestion && msg.status !== 'FAILED' && (
                        <MessageActions
                          question={msg.userQuestion || ''}
                          sql={msg.sql || ''}
                          queryResult={msg.queryResult}
                          onSave={handleSaveQuestion}
                          onAddSample={handleAddSampleQuestion}
                          isSampleQuestion={sampleQueries.some((sq) => sq.question === msg.userQuestion)}
                        />
                      )}
                    </>
                  )}
                </div>
                {msg.role === 'user' && (
                  <div className="w-8 h-8 rounded-lg bg-white/60 border border-[var(--border)] flex items-center justify-center shrink-0 mt-0.5">
                    <User className="w-4 h-4 text-[var(--text-secondary)]" />
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex gap-3">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#D0A33C] to-[#3F1F14] flex items-center justify-center shrink-0">
                  <Sparkles className="w-4 h-4 text-white" />
                </div>
                <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-3">
                  <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                    <Loader2 className="w-4 h-4 animate-spin" /> Thinking...
                  </div>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>

        {/* Query source notification — floating side pop-up */}
        {queryNotification && (
          <div className="fixed top-20 right-6 z-50 animate-in slide-in-from-right">
            <div
              className={`w-72 rounded-xl border shadow-lg overflow-hidden transition-all ${
                queryNotification.type === 'cache-hit'
                  ? 'bg-emerald-500/10 border-emerald-500/30'
                  : queryNotification.type === 'cache-miss'
                    ? 'bg-amber-500/10 border-amber-500/30'
                    : 'bg-blue-500/10 border-blue-500/30'
              }`}
            >
              {/* Header */}
              <div className={`flex items-center justify-between px-3 py-2 ${
                queryNotification.type === 'cache-hit'
                  ? 'bg-emerald-500/10'
                  : queryNotification.type === 'cache-miss'
                    ? 'bg-amber-500/10'
                    : 'bg-blue-500/10'
              }`}>
                <div className="flex items-center gap-2">
                  {queryNotification.type === 'cache-hit' ? (
                    <Database className="w-3.5 h-3.5 text-emerald-600" />
                  ) : queryNotification.type === 'cache-miss' ? (
                    <Zap className="w-3.5 h-3.5 text-amber-600" />
                  ) : (
                    <Sparkles className="w-3.5 h-3.5 text-blue-600" />
                  )}
                  <span className={`text-[11px] font-semibold ${
                    queryNotification.type === 'cache-hit'
                      ? 'text-emerald-700'
                      : queryNotification.type === 'cache-miss'
                        ? 'text-amber-700'
                        : 'text-blue-700'
                  }`}>
                    {queryNotification.type === 'cache-hit' ? 'Lakebase Cache Hit'
                      : queryNotification.type === 'cache-miss' ? 'Cache Miss'
                        : 'Genie API'}
                  </span>
                </div>
                <button
                  onClick={() => setQueryNotification(null)}
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-0.5"
                >
                  <ChevronRight className="w-3 h-3" />
                </button>
              </div>

              {/* Body */}
              <div className="px-3 py-2.5 space-y-2">
                <p className="text-[11px] text-[var(--text-primary)]">{queryNotification.message}</p>

                {/* Similarity bar */}
                {queryNotification.similarity != null && queryNotification.similarity > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[9px] text-[var(--text-secondary)]">Semantic similarity</span>
                      <span className="text-[10px] font-mono font-semibold text-[var(--text-primary)]">
                        {Math.round(queryNotification.similarity * 100)}%
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          queryNotification.type === 'cache-hit' ? 'bg-emerald-500' : 'bg-amber-500'
                        }`}
                        style={{ width: `${Math.round(queryNotification.similarity * 100)}%` }}
                      />
                    </div>
                    {queryNotification.threshold != null && (
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-[9px] text-[var(--text-secondary)]">
                          Threshold: {Math.round(queryNotification.threshold * 100)}%
                        </span>
                        <span className={`text-[9px] font-medium ${
                          queryNotification.type === 'cache-hit' ? 'text-emerald-600' : 'text-amber-600'
                        }`}>
                          {queryNotification.type === 'cache-hit' ? 'Above threshold' : 'Below threshold'}
                        </span>
                      </div>
                    )}
                  </div>
                )}

                {/* Source indicator */}
                <div className="flex items-center gap-1.5 pt-1 border-t border-[var(--border)]">
                  <div className={`w-1.5 h-1.5 rounded-full ${
                    queryNotification.type === 'cache-hit' ? 'bg-emerald-500' : 'bg-blue-500'
                  }`} />
                  <span className="text-[9px] text-[var(--text-secondary)]">
                    {queryNotification.type === 'cache-hit'
                      ? 'Source: Lakebase (pgvector)'
                      : 'Source: Databricks Genie API'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Mode toggle + Input */}
        <div className="shrink-0 px-5 py-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-1 max-w-3xl mx-auto mb-2">
            <button
              onClick={() => setMode('genie')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'genie'
                  ? 'bg-gradient-to-r from-[#D0A33C] to-[#3F1F14] text-white shadow-sm'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <BotMessageSquare className="w-3.5 h-3.5" /> Genie
            </button>
            <button
              onClick={() => setMode('semantic')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mode === 'semantic'
                  ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white shadow-sm'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
              }`}
            >
              <Zap className="w-3.5 h-3.5" /> Semantic
            </button>
            {mode === 'semantic' && (
              <span className="ml-2 text-[10px] text-[var(--text-secondary)]">Click a saved question to run its SQL directly</span>
            )}
            {mode === 'genie' && cacheStats && cacheStats.total_entries > 0 && (
              <span className="flex items-center gap-1 ml-2 px-2 py-0.5 rounded-full bg-[#D0A33C]/10 text-[10px] font-medium text-[#D0A33C]">
                <Database className="w-2.5 h-2.5" />
                {cacheStats.total_entries} cached
              </span>
            )}
            {messages.length > 0 && (
              <button
                onClick={() => { setMessages([]); setConversationId(null) }}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> New chat
              </button>
            )}
          </div>
          <div className="flex gap-3 items-center max-w-3xl mx-auto">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder="Ask a question about your data..."
              disabled={loading}
              className="flex-1 px-4 py-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm disabled:opacity-50"
              autoFocus
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
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

function MessageActions({ question, sql, queryResult, onSave, onAddSample, isSampleQuestion }: {
  question: string
  sql: string
  queryResult?: any
  onSave: (question: string, sql: string) => Promise<void>
  onAddSample: (question: string, sql: string) => Promise<void>
  isSampleQuestion?: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [addingSample, setAddingSample] = useState(false)
  const [sampleAdded, setSampleAdded] = useState(isSampleQuestion || false)
  const [showChart, setShowChart] = useState(false)
  const [chartType, setChartType] = useState<'bar' | 'line'>('bar')

  const { columns, rows } = extractColumnsAndRows(queryResult)
  const canVisualize = columns.length >= 2 && rows.length > 0

  const handleSave = async () => {
    setSaving(true)
    setSaveError('')
    try {
      await onSave(question, sql)
      setSaved(true)
    } catch (e: any) {
      setSaveError(e.message || 'Failed to save')
    }
    finally { setSaving(false) }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={handleSave}
        disabled={saving || saved}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
          saved
            ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
            : saveError
              ? 'bg-red-500/10 text-red-500 border border-red-500/20'
              : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#D0A33C] hover:border-[#D0A33C]/30'
        }`}
      >
        {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : saved ? <Check className="w-3.5 h-3.5" /> : <Bookmark className="w-3.5 h-3.5" />}
        {saved ? 'Saved' : saveError ? 'Retry save' : 'Save question'}
      </button>

      {sql && (
        <button
          onClick={async () => {
            setAddingSample(true)
            try { await onAddSample(question, sql); setSampleAdded(true) }
            catch { /* silent */ }
            finally { setAddingSample(false) }
          }}
          disabled={addingSample || sampleAdded}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            sampleAdded
              ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
              : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#D0A33C] hover:border-[#D0A33C]/30'
          }`}
        >
          {addingSample ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sampleAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {sampleAdded ? 'Sample added' : 'Add as sample question'}
        </button>
      )}

      {canVisualize && (
        <button
          onClick={() => setShowChart(!showChart)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            showChart
              ? 'bg-[#325B6D]/10 text-[#325B6D] border border-[#325B6D]/20'
              : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#325B6D] hover:border-[#325B6D]/30'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {showChart ? 'Hide chart' : 'Visualize'}
        </button>
      )}

      {showChart && canVisualize && (
        <>
          <button onClick={() => setChartType('bar')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${chartType === 'bar' ? 'bg-[#325B6D] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}>
            Bar
          </button>
          <button onClick={() => setChartType('line')}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${chartType === 'line' ? 'bg-[#325B6D] text-white' : 'bg-[var(--bg-secondary)] text-[var(--text-secondary)]'}`}>
            Line
          </button>
        </>
      )}

      {showChart && canVisualize && (
        <div className="w-full mt-2">
          <SimpleChart columns={columns} rows={rows} type={chartType} />
        </div>
      )}
    </div>
  )
}

function SimpleChart({ columns, rows, type }: { columns: string[]; rows: any[][]; type: 'bar' | 'line' }) {
  const labelIdx = 0
  let valueIdx = -1
  for (let j = 1; j < columns.length; j++) {
    if (rows.some(r => r[j] !== null && !isNaN(Number(r[j])))) {
      valueIdx = j
      break
    }
  }
  if (valueIdx === -1) return <p className="text-xs text-[var(--text-secondary)]">No numeric column found to chart.</p>

  const data = rows.slice(0, 20).map(r => ({
    label: String(r[labelIdx] ?? ''),
    value: Number(r[valueIdx]) || 0,
  }))

  const maxVal = Math.max(...data.map(d => d.value), 1)

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] p-4 overflow-hidden">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-3.5 h-3.5 text-[#325B6D]" />
        <span className="text-xs font-medium text-[var(--text-secondary)]">{columns[labelIdx]} vs {columns[valueIdx]}</span>
        {data.length < rows.length && (
          <span className="text-[10px] text-[var(--text-secondary)]">(showing {data.length} of {rows.length})</span>
        )}
      </div>

      {type === 'bar' ? (
        <div className="space-y-1.5">
          {data.map((d, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-secondary)] w-24 truncate text-right shrink-0">{d.label}</span>
              <div className="flex-1 h-5 bg-[var(--bg-tertiary)] rounded overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-[#D0A33C] to-[#E3BC21] rounded transition-all"
                  style={{ width: `${(d.value / maxVal) * 100}%` }}
                />
              </div>
              <span className="text-[11px] font-mono text-[var(--text-primary)] w-16 text-right shrink-0">
                {d.value.toLocaleString(undefined, { maximumFractionDigits: 1 })}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <svg viewBox={`0 0 ${Math.max(data.length * 40, 200)} 120`} className="w-full h-32">
          {[0, 0.25, 0.5, 0.75, 1].map(f => (
            <line key={f} x1="0" x2={data.length * 40} y1={100 - f * 90} y2={100 - f * 90}
              stroke="var(--border)" strokeWidth="0.5" />
          ))}
          <polyline
            fill="none" stroke="url(#lineGrad)" strokeWidth="2" strokeLinejoin="round"
            points={data.map((d, i) => `${i * 40 + 20},${100 - (d.value / maxVal) * 90}`).join(' ')}
          />
          <polygon
            fill="url(#areaGrad)" opacity="0.2"
            points={`${20},${100} ${data.map((d, i) => `${i * 40 + 20},${100 - (d.value / maxVal) * 90}`).join(' ')} ${(data.length - 1) * 40 + 20},${100}`}
          />
          {data.map((d, i) => (
            <circle key={i} cx={i * 40 + 20} cy={100 - (d.value / maxVal) * 90} r="3"
              fill="var(--bg-secondary)" stroke="#D0A33C" strokeWidth="2" />
          ))}
          {data.map((d, i) => (
            <text key={`l${i}`} x={i * 40 + 20} y="115" textAnchor="middle"
              className="text-[8px] fill-[var(--text-secondary)]">{d.label.slice(0, 8)}</text>
          ))}
          <defs>
            <linearGradient id="lineGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="#D0A33C" /><stop offset="100%" stopColor="#E3BC21" />
            </linearGradient>
            <linearGradient id="areaGrad" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#D0A33C" /><stop offset="100%" stopColor="transparent" />
            </linearGradient>
          </defs>
        </svg>
      )}
    </div>
  )
}

function SqlBlock({ sql }: { sql: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
      >
        <Code className="w-3.5 h-3.5" />
        <span>Generated SQL</span>
        {open ? <ChevronDown className="w-3.5 h-3.5 ml-auto" /> : <ChevronRight className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <pre className="px-4 py-3 bg-[var(--bg-tertiary)] text-sm text-[#325B6D] overflow-x-auto font-mono">
          {sql}
        </pre>
      )}
    </div>
  )
}

function extractColumnsAndRows(data: any): { columns: string[]; rows: any[][] } {
  const columns: string[] =
    data?.manifest?.schema?.columns?.map((c: any) => c.name) || []
  const rows: any[][] =
    data?.result?.data_array ||
    data?.result?.result?.data_array ||
    []
  return { columns, rows }
}

function QueryResultTable({ data }: { data: any }) {
  const { columns, rows } = extractColumnsAndRows(data)

  if (columns.length === 0 || rows.length === 0) return null

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-[var(--bg-secondary)] text-xs text-[var(--text-secondary)]">
        <Table2 className="w-3.5 h-3.5" />
        <span>{rows.length} row{rows.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="overflow-x-auto max-h-80">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-secondary)]">
              {columns.map((col) => (
                <th key={col} className="text-left px-4 py-2 font-medium text-[var(--text-secondary)] whitespace-nowrap">
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} className={`border-t border-[var(--border)] ${i % 2 === 0 ? '' : 'bg-[var(--bg-secondary)]'}`}>
                {row.map((cell, j) => (
                  <td key={j} className="px-4 py-1.5 whitespace-nowrap">{cell ?? '—'}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
