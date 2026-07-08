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
  RotateCcw,
  Play,
  Plus,
  Lock,
  LayoutDashboard,
  ExternalLink,
  Share2,
} from 'lucide-react'
import { api } from '../api'
import type { SavedQuestion, Warehouse, FilterScope, RoomDashboard } from '../api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  sql?: string
  queryResult?: any
  description?: string
  status?: string
  userQuestion?: string
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

  const [warehouseId, setWarehouseId] = useState('')

  // Warehouses
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [whDropdownOpen, setWhDropdownOpen] = useState(false)
  const [startingWh, setStartingWh] = useState<string | null>(null)

  // Current user
  const [userId, setUserId] = useState('')
  const [historyLoaded, setHistoryLoaded] = useState(false)

  // Sidebar
  const [sidebarTab, setSidebarTab] = useState<'saved' | 'history'>('saved')
  const [savedQuestions, setSavedQuestions] = useState<SavedQuestion[]>([])
  const [savedLoading, setSavedLoading] = useState(true)
  const [dbAvailable, setDbAvailable] = useState(true)
  const [historyQuestions, setHistoryQuestions] = useState<string[]>([])

  // Room sample queries
  const [sampleQueries, setSampleQueries] = useState<{ question: string; sql: string }[]>([])
  // AI-suggested starter questions
  const [suggestedQs, setSuggestedQs] = useState<{ title: string; hint: string }[]>([])
  const [suggestedQsLoading, setSuggestedQsLoading] = useState(false)

  // Row-level filter scope
  const [filterScope, setFilterScope] = useState<FilterScope | null>(null)

  // Dashboards (multi)
  const [dashboards, setDashboards] = useState<RoomDashboard[]>([])
  const [shareTargetId, setShareTargetId] = useState<string | null>(null)
  const [shareEmails, setShareEmails] = useState('')
  const [sharing, setSharing] = useState(false)
  const [shareMsg, setShareMsg] = useState('')
  const [creatingDash, setCreatingDash] = useState(false)
  const [newDashName, setNewDashName] = useState('')
  // Main panel view: chat vs. embedded dashboard
  const [mainView, setMainView] = useState<'chat' | 'dashboard'>('chat')
  const [embedDashId, setEmbedDashId] = useState('')
  const [publishingEmbed, setPublishingEmbed] = useState(false)
  const publishedRef = useRef<Set<string>>(new Set())

  const [queryNotification, setQueryNotification] = useState<{
    type: 'genie-api'
    message: string
  } | null>(null)
  const notificationTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const showNotification = (notif: typeof queryNotification) => {
    if (notificationTimer.current) clearTimeout(notificationTimer.current)
    setQueryNotification(notif)
    notificationTimer.current = setTimeout(() => setQueryNotification(null), 4000)
  }

  // Load room details, warehouses, and current user
  useEffect(() => {
    if (roomId) {
      api.getGenieRoom(roomId).then((r) => {
        setRoomTitle(r.title || 'Genie Space')
        if (r.warehouse_id) setWarehouseId(r.warehouse_id)
        if (r.sample_queries?.length) setSampleQueries(r.sample_queries)
        // Kick off AI suggestion generation in the background based on the room's tables
        if (r.table_identifiers?.length) {
          setSuggestedQsLoading(true)
          api.suggestQuestions(r.table_identifiers)
            .then((s) => setSuggestedQs(s.questions || []))
            .catch(() => {})
            .finally(() => setSuggestedQsLoading(false))
        }
      }).catch(() => setRoomTitle('Genie Space'))
    }
    api.getCurrentUser().then((u) => setUserId(u.id)).catch(() => {})
    api.listWarehouses().then((r) => setWarehouses(r.warehouses || [])).catch(() => {})
    if (roomId) {
      api.getFilterScope(roomId).then(setFilterScope).catch(() => {})
      api.listRoomDashboards(roomId).then((r) => setDashboards(r.dashboards)).catch(() => {})
    }
  }, [roomId])

  const reloadDashboards = useCallback(async () => {
    if (!roomId) return
    try {
      const r = await api.listRoomDashboards(roomId)
      setDashboards(r.dashboards)
    } catch { /* ignore */ }
  }, [roomId])

  const handleSaveToDashboard = useCallback(async (
    name: string, sql: string, queryResult: any, chartHint?: any,
    target?: { dashboardId?: string; createNew?: boolean },
  ) => {
    if (!roomId) throw new Error('No room')
    // Resolve the target dashboard: an explicit existing one, a freshly created one, or
    // (default) let the backend pick the room's default.
    let dashboardId = target?.dashboardId
    if (target?.createNew) {
      const nd = await api.newDashboard({ room_id: roomId })
      dashboardId = nd.dashboard_id
    }
    const r = await api.saveWidgetToDashboard({ room_id: roomId, name, sql, query_result: queryResult, chart_hint: chartHint, dashboard_id: dashboardId })
    // Refresh list so a newly created default/dashboard appears in the panel
    if (r.created || target?.createNew) await reloadDashboards()
    // Show the result embedded in-app; drop the publish guard so the new widget appears.
    publishedRef.current.delete(r.dashboard_id)
    setEmbedDashId(r.dashboard_id)
    setMainView('dashboard')
    return r
  }, [roomId, reloadDashboards])

  const handleDeleteDashboard = useCallback(async (localId: string, name: string) => {
    if (!window.confirm(`Delete dashboard "${name}"? This removes it from Databricks too.`)) return
    try {
      await api.deleteDashboard(localId)
      await reloadDashboards()
    } catch (e: any) {
      alert(e.message || 'Failed to delete dashboard')
    }
  }, [reloadDashboards])

  const handleNewDashboard = useCallback(async () => {
    if (!roomId) return
    setCreatingDash(true)
    try {
      const r = await api.newDashboard({ room_id: roomId, name: newDashName.trim() || undefined })
      setNewDashName('')
      await reloadDashboards()
      // Jump to the embedded view of the dashboard we just created.
      publishedRef.current.delete(r.dashboard_id)
      setEmbedDashId(r.dashboard_id)
      setMainView('dashboard')
    } catch (e: any) {
      alert(e.message || 'Failed to create dashboard')
    } finally {
      setCreatingDash(false)
    }
  }, [roomId, newDashName, reloadDashboards])

  const handleSetDefault = useCallback(async (localId: string) => {
    try {
      await api.setDefaultDashboard(localId)
      await reloadDashboards()
    } catch (e: any) {
      alert(e.message || 'Failed to set default')
    }
  }, [reloadDashboards])

  const handleShare = useCallback(async () => {
    if (!shareTargetId) return
    const target = dashboards.find((d) => d.dashboard_id === shareTargetId)
    if (!target) return
    const emails = shareEmails.split(',').map((e) => e.trim()).filter((e) => e.includes('@'))
    if (emails.length === 0) {
      setShareMsg('Enter at least one email')
      return
    }
    setSharing(true)
    setShareMsg('')
    try {
      await api.shareDashboard(target.dashboard_id, emails)
      setShareMsg(`Shared with ${emails.length} user${emails.length > 1 ? 's' : ''}`)
      setShareEmails('')
      setTimeout(() => setShareTargetId(null), 1500)
    } catch (e: any) {
      setShareMsg(e.message || 'Share failed')
    } finally {
      setSharing(false)
    }
  }, [shareTargetId, dashboards, shareEmails])

  // Keep the embedded dashboard pointed at the default (or first) dashboard.
  useEffect(() => {
    if (dashboards.length === 0) { setEmbedDashId(''); return }
    setEmbedDashId((cur) =>
      cur && dashboards.some((d) => d.dashboard_id === cur)
        ? cur
        : (dashboards.find((d) => d.is_default) || dashboards[0]).dashboard_id
    )
  }, [dashboards])

  // Ensure the selected dashboard is published before embedding (once per id).
  useEffect(() => {
    if (mainView !== 'dashboard' || !embedDashId || publishedRef.current.has(embedDashId)) return
    publishedRef.current.add(embedDashId)
    setPublishingEmbed(true)
    api.publishDashboard(embedDashId).catch(() => {}).finally(() => setPublishingEmbed(false))
  }, [mainView, embedDashId])

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
    if (filterScope?.has_columns && filterScope?.blocked) return
    if (!overrideInput) setInput('')
    const userMsg: ChatMessage = { role: 'user', content: msg }
    setMessages((prev) => [...prev, userMsg])
    persistMsg(userMsg)
    setHistoryQuestions((prev) => prev.includes(msg) ? prev : [...prev, msg])
    setLoading(true)

    try {
      showNotification({ type: 'genie-api', message: 'Querying Genie API' })

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

  // Deduplicated history (persisted + current session)
  const pastQuestions = historyQuestions

  // Currently embedded dashboard
  const embedDash = dashboards.find((d) => d.dashboard_id === embedDashId)

  return (
    <div className="flex h-full bg-[var(--bg-primary)]">
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
            <div className="w-7 h-7 rounded-md bg-gradient-to-br from-[#6366F1] to-[#4338CA] flex items-center justify-center shrink-0">
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
                          wh.id === warehouseId ? 'bg-[#6366F1]/10' : ''
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
                          {wh.id === warehouseId && <Check className="w-3.5 h-3.5 text-[#6366F1] shrink-0" />}
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

          {/* Example questions — AI-suggested, always visible */}
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-[#3B82F6]" /> Example questions
              </p>
              {suggestedQsLoading && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-secondary)]" />}
            </div>
            {suggestedQsLoading && suggestedQs.length === 0 ? (
              <div className="space-y-1">
                {[0, 1, 2, 3, 4].map((i) => (
                  <div key={i} className="h-7 rounded bg-[var(--bg-tertiary)] animate-pulse" />
                ))}
              </div>
            ) : suggestedQs.length === 0 ? (
              <p className="text-[10px] text-[var(--text-secondary)] italic">No suggestions yet.</p>
            ) : (
              <div className="space-y-1">
                {suggestedQs.slice(0, 5).map((sq, i) => (
                  <button
                    key={i}
                    onClick={() => sendMessage(sq.title)}
                    disabled={loading || (filterScope?.has_columns === true && filterScope?.blocked === true)}
                    className="w-full text-left px-2 py-1.5 rounded bg-[var(--bg-primary)] border border-[var(--border)] hover:border-[#3B82F6]/40 hover:bg-[#3B82F6]/5 transition-colors disabled:opacity-40 disabled:cursor-not-allowed group"
                    title={sq.hint}
                  >
                    <p className="text-[11px] text-[var(--text-primary)] leading-snug line-clamp-2 group-hover:text-[#3B82F6]">{sq.title}</p>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Tabs — icon over label. Dashboards live in the main-area Dashboard tab. */}
          <div className="flex bg-[var(--bg-tertiary)] rounded-lg p-0.5 gap-0.5">
            {[
              { id: 'saved' as const, icon: Bookmark, label: 'Saved', onClick: () => setSidebarTab('saved') },
              { id: 'history' as const, icon: Clock, label: 'History', onClick: () => setSidebarTab('history') },
            ].map((t) => {
              const active = sidebarTab === t.id
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={t.onClick}
                  title={t.label}
                  className={`flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-1 py-1.5 rounded-md transition-colors ${
                    active
                      ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                      : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  <span className="text-[9px] font-medium leading-none">{t.label}</span>
                </button>
              )
            })}
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
                  <div key={sq.id} className="group rounded-lg border border-[var(--border)] bg-[var(--bg-primary)] hover:border-[#6366F1]/30 transition-colors">
                    <button
                      onClick={() => sendMessage(sq.question)}
                      className="w-full text-left p-3"
                    >
                      <p className="text-xs font-medium text-[var(--text-primary)] leading-snug mb-1 line-clamp-2">{sq.question}</p>
                      <p className="text-[10px] font-mono text-[#6366F1]/70 truncate">{sq.sql.slice(0, 60)}...</p>
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

        </div>
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* View tabs: Chat / Dashboard */}
        <div className="shrink-0 flex items-center gap-1 px-5 pt-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
          {[
            { id: 'chat' as const, icon: MessageSquare, label: 'Chat' },
            { id: 'dashboard' as const, icon: LayoutDashboard, label: 'Dashboard' },
          ].map((t) => {
            const active = mainView === t.id
            const Icon = t.icon
            return (
              <button
                key={t.id}
                onClick={() => setMainView(t.id)}
                className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 -mb-px transition-colors ${
                  active
                    ? 'border-[#6366F1] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" /> {t.label}
                {t.id === 'dashboard' && dashboards.length > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-semibold bg-[#6366F1]/15 text-[#6366F1]">{dashboards.length}</span>
                )}
              </button>
            )
          })}
        </div>

        {mainView === 'chat' && (<>
        {/* Filter scope banner */}
        {filterScope?.has_columns && (
          filterScope.blocked ? (
            <div className="shrink-0 px-5 py-3 bg-red-500/10 border-b border-red-500/30 flex items-start gap-2">
              <Lock className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
              <div className="text-xs">
                <p className="font-semibold text-red-500">No filter scope assigned</p>
                <p className="text-[var(--text-secondary)] mt-0.5">
                  This room requires a row-level filter scope ({filterScope.columns.map((c) => c.column_name).join(', ')}). Ask the room owner to grant you access.
                </p>
              </div>
            </div>
          ) : (
            <div className="shrink-0 px-5 py-2 bg-[#6366F1]/10 border-b border-[#6366F1]/20 flex items-center gap-2 flex-wrap">
              <Lock className="w-3.5 h-3.5 text-[#6366F1] shrink-0" />
              <span className="text-[11px] font-semibold text-[#6366F1]">Filter scope</span>
              {filterScope.columns.map((c) => {
                const vals = filterScope.values[c.column_name] || []
                return (
                  <span key={c.column_name} className="inline-flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                    <code className="text-[var(--text-primary)]">{c.column_name}</code>:
                    <span className="text-[var(--text-primary)]">{vals.length > 0 ? vals.join(', ') : '∅'}</span>
                  </span>
                )
              })}
            </div>
          )
        )}
        {/* Messages */}
        <div className="flex-1 overflow-y-auto py-6">
          <div className="max-w-3xl mx-auto px-6 space-y-6">
            {messages.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 text-[var(--text-secondary)]">
                <Sparkles className="w-16 h-16 mb-4 opacity-15" />
                <p className="text-xl font-medium text-[var(--text-primary)] opacity-60 mb-2">Ask anything about your data</p>
                <p className="text-sm mb-5">Type a question below or try one of these</p>

                  {/* Sample questions */}
                  {sampleQueries.length > 0 && (
                    <div className="w-full max-w-lg space-y-2 mb-5">
                      <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-1">Sample queries</p>
                      {sampleQueries.slice(0, 5).map((sq, i) => (
                        <button
                          key={i}
                          onClick={() => sendMessage(sq.question)}
                          disabled={loading}
                          className="w-full text-left px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[#6366F1]/40 hover:bg-[#6366F1]/5 transition-all group"
                        >
                          <div className="flex items-start gap-3">
                            <MessageSquare className="w-4 h-4 text-[#6366F1] shrink-0 mt-0.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                            <span className="text-sm text-[var(--text-primary)]">{sq.question}</span>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                    {/* AI-suggested starter questions based on the room's tables */}
                    {(suggestedQs.length > 0 || suggestedQsLoading) && (
                      <div className="w-full max-w-lg mb-5">
                        <div className="flex items-center gap-1.5 mb-2">
                          <Sparkles className="w-3 h-3 text-[#3B82F6]" />
                          <p className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Suggested for this room</p>
                          {suggestedQsLoading && <Loader2 className="w-3 h-3 animate-spin text-[var(--text-secondary)]" />}
                        </div>
                        {suggestedQsLoading && suggestedQs.length === 0 ? (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {[0, 1, 2, 3].map((i) => (
                              <div key={i} className="h-14 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] animate-pulse" />
                            ))}
                          </div>
                        ) : (
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {suggestedQs.map((sq, i) => (
                              <button
                                key={i}
                                onClick={() => sendMessage(sq.title)}
                                disabled={loading}
                                className="text-left px-3 py-2.5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[#3B82F6]/50 hover:bg-[#3B82F6]/5 transition-all group"
                              >
                                <p className="text-xs text-[var(--text-primary)] leading-snug mb-1 line-clamp-2">{sq.title}</p>
                                {sq.hint && (
                                  <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">{sq.hint}</p>
                                )}
                              </button>
                            ))}
                          </div>
                        )}
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
                            className="w-full text-left px-4 py-3 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[#6366F1]/40 hover:bg-[#6366F1]/5 transition-all group"
                          >
                            <div className="flex items-start gap-3">
                              <Bookmark className="w-4 h-4 text-[#6366F1] shrink-0 mt-0.5 opacity-60 group-hover:opacity-100 transition-opacity" />
                              <span className="text-sm text-[var(--text-primary)]">{sq.question}</span>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}

              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
                {msg.role === 'assistant' && (
                  <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366F1] to-[#4338CA] flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4 text-white" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] ${
                    msg.role === 'user'
                      ? 'bg-[#4338CA] text-white rounded-2xl rounded-br-md px-4 py-2.5'
                      : 'space-y-3'
                  }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-sm">{msg.content}</p>
                  ) : (
                    <>
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
                          onSaveToDashboard={handleSaveToDashboard}
                          dashboards={dashboards}
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
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#6366F1] to-[#4338CA] flex items-center justify-center shrink-0">
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

        {/* Query source notification — minimal pop-up */}
        {queryNotification && (
          <div className="fixed top-20 right-6 z-50">
            <div className="rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-2 shadow-lg flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-[11px] text-[var(--text-primary)]">{queryNotification.message}</span>
            </div>
          </div>
        )}

        {/* Input bar */}
        <div className="shrink-0 px-5 py-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          {messages.length > 0 && (
            <div className="flex items-center max-w-3xl mx-auto mb-2">
              <button
                onClick={() => { setMessages([]); setConversationId(null) }}
                className="ml-auto flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <RotateCcw className="w-3 h-3" /> New chat
              </button>
            </div>
          )}
          <div className="flex gap-3 items-center max-w-3xl mx-auto">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
              placeholder={
                filterScope?.has_columns && filterScope?.blocked
                  ? 'No filter scope assigned — ask the room owner for access'
                  : 'Ask a question about your data...'
              }
              disabled={loading || (filterScope?.has_columns === true && filterScope?.blocked === true)}
              className="flex-1 px-4 py-3 rounded-xl bg-[var(--bg-primary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] transition-colors text-sm disabled:opacity-50"
              autoFocus
            />
            <button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim() || (filterScope?.has_columns === true && filterScope?.blocked === true)}
              className="p-3 rounded-xl bg-[#6366F1] hover:bg-[#4F46E5] text-white transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
        </>)}

        {mainView === 'dashboard' && (
          <div className="flex-1 flex flex-col min-h-0">
            {dashboards.length === 0 ? (
              <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] px-6">
                <LayoutDashboard className="w-16 h-16 mb-4 opacity-15" />
                <p className="text-lg font-medium text-[var(--text-primary)] opacity-60 mb-1">No dashboards yet</p>
                <p className="text-sm mb-5">Save a chat answer to a dashboard, or create one here.</p>
                <div className="flex gap-2 w-full max-w-sm">
                  <input
                    type="text"
                    value={newDashName}
                    onChange={(e) => setNewDashName(e.target.value)}
                    placeholder="Optional name"
                    className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#6366F1]"
                  />
                  <button
                    onClick={handleNewDashboard}
                    disabled={creatingDash}
                    className="px-4 py-2 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white text-sm font-medium disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {creatingDash ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />} Create
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Dashboard toolbar: selector + open-in-Databricks */}
                <div className="shrink-0 flex items-center gap-2 px-5 py-2.5 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                  <LayoutDashboard className="w-4 h-4 text-[#6366F1] shrink-0" />
                  <select
                    value={embedDashId}
                    onChange={(e) => setEmbedDashId(e.target.value)}
                    className="min-w-0 max-w-xs px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#6366F1]"
                  >
                    {dashboards.map((d) => (
                      <option key={d.id} value={d.dashboard_id}>{d.name}{d.is_default ? ' (default)' : ''}</option>
                    ))}
                  </select>
                  {publishingEmbed && (
                    <span className="flex items-center gap-1 text-[11px] text-[var(--text-secondary)]">
                      <Loader2 className="w-3 h-3 animate-spin" /> Publishing…
                    </span>
                  )}
                  {embedDash && (
                    <div className="ml-auto flex items-center gap-2">
                      {!embedDash.is_default && (
                        <button
                          onClick={() => handleSetDefault(embedDash.id)}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[#6366F1]/20 text-[#6366F1] text-[11px] font-medium"
                          title="Set as the room's default dashboard"
                        >
                          ★ Set default
                        </button>
                      )}
                      <button
                        onClick={() => { setShareTargetId(embedDash.dashboard_id); setShareMsg(''); setShareEmails('') }}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-[11px] font-medium"
                      >
                        <Share2 className="w-3 h-3" /> Share
                      </button>
                      <a
                        href={embedDash.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] text-[11px] font-medium"
                      >
                        <ExternalLink className="w-3 h-3" /> Open in Databricks
                      </a>
                      <button
                        onClick={() => handleDeleteDashboard(embedDash.id, embedDash.name)}
                        className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-red-500/15 text-[var(--text-secondary)] hover:text-red-500 text-[11px] font-medium"
                        title="Delete this dashboard (also removes it from Databricks)"
                      >
                        <Trash2 className="w-3 h-3" /> Delete
                      </button>
                    </div>
                  )}
                </div>
                {/* Embedded dashboard */}
                <div className="flex-1 min-h-0 bg-[var(--bg-primary)]">
                  {embedDash && (
                    <iframe
                      key={embedDash.dashboard_id}
                      src={embedDash.embed_url}
                      title={embedDash.name}
                      className="w-full h-full border-0"
                    />
                  )}
                </div>
                <p className="shrink-0 px-5 py-1.5 text-[10px] text-[var(--text-secondary)] border-t border-[var(--border)] bg-[var(--bg-secondary)]">
                  If the dashboard doesn't render, a workspace admin may need to add this app's domain to the AI/BI dashboard embedding approved domains. Use "Open in Databricks" in the meantime.
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {/* Share dashboard dialog */}
      {shareTargetId && (() => {
        const target = dashboards.find((d) => d.dashboard_id === shareTargetId)
        if (!target) return null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <div className="flex items-center gap-2 mb-1">
                <Share2 className="w-5 h-5 text-[#6366F1]" />
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">Share dashboard</h3>
              </div>
              <p className="text-xs text-[var(--text-secondary)] mb-4">
                Grant view access to <span className="font-semibold text-[var(--text-primary)]">{target.name}</span>.
              </p>
              <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Emails (comma-separated)</label>
              <textarea
                value={shareEmails}
                onChange={(e) => setShareEmails(e.target.value)}
                placeholder="alice@databricks.com, bob@databricks.com"
                rows={3}
                className="w-full px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] resize-none mb-2"
              />
              {shareMsg && (
                <p className={`text-xs mb-2 ${shareMsg.toLowerCase().includes('shared') ? 'text-emerald-500' : 'text-red-500'}`}>{shareMsg}</p>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  onClick={() => setShareTargetId(null)}
                  disabled={sharing}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors"
                >
                  Close
                </button>
                <button
                  onClick={handleShare}
                  disabled={sharing || !shareEmails.trim()}
                  className="flex-1 py-2.5 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {sharing ? <><Loader2 className="w-4 h-4 animate-spin" /> Sharing...</> : <><Share2 className="w-4 h-4" /> Share</>}
                </button>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

function MessageActions({ question, sql, queryResult, onSave, onAddSample, onSaveToDashboard, dashboards, isSampleQuestion }: {
  question: string
  sql: string
  queryResult?: any
  onSave: (question: string, sql: string) => Promise<void>
  onAddSample: (question: string, sql: string) => Promise<void>
  onSaveToDashboard: (name: string, sql: string, queryResult: any, chartHint?: any, target?: { dashboardId?: string; createNew?: boolean }) => Promise<{ url: string; created: boolean }>
  dashboards: RoomDashboard[]
  isSampleQuestion?: boolean
}) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [addingSample, setAddingSample] = useState(false)
  const [sampleAdded, setSampleAdded] = useState(isSampleQuestion || false)
  const [showChart, setShowChart] = useState(false)
  const [dashSaving, setDashSaving] = useState(false)
  const [dashSaved, setDashSaved] = useState<{ url: string; created: boolean } | null>(null)
  const [dashError, setDashError] = useState('')
  const [tblSaving, setTblSaving] = useState(false)
  const [tblSaved, setTblSaved] = useState<{ url: string; created: boolean } | null>(null)
  const [tblError, setTblError] = useState('')
  const [chartType, setChartType] = useState<ChartType>('barV')
  // Save target: '' = room default, a dashboard_id = existing, '__new__' = new dashboard
  const [dashTarget, setDashTarget] = useState<string>('')
  const buildTarget = (): { dashboardId?: string; createNew?: boolean } | undefined =>
    dashTarget === '__new__' ? { createNew: true } : dashTarget ? { dashboardId: dashTarget } : undefined

  const { columns, types, rows } = extractColumnsAndRows(queryResult)
  const canVisualize = columns.length >= 2 && rows.length > 0

  // Default series = all numeric columns (excluding label)
  const numericFlagsForActions = columns.map((_, j) => {
    if (isNumericType(types[j] || '')) return true
    const sample = rows.slice(0, 20).filter((r) => r[j] !== null && r[j] !== '')
    return sample.length > 0 && sample.every((r) => !isNaN(Number(r[j])))
  })
  const labelIdxForActions = numericFlagsForActions.findIndex((n) => !n)
  const defaultSeries = columns.map((_, j) => j).filter((j) => numericFlagsForActions[j] && j !== labelIdxForActions).slice(0, 4)
  const [activeSeries, setActiveSeries] = useState<number[]>(defaultSeries)

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

  // "Save to dashboard" (chart). Extracted so it can render either in the action row
  // or, once a chart is produced, right next to the chart in the visualization header.
  const dashSaveButton = (
    <button
      onClick={async () => {
        setDashSaving(true)
        setDashError('')
        try {
          // Always adds the VISUAL (chart) — uses the selected chart type + default series
          // even if the Visualize panel was never opened. Falls back to a table only when
          // there's nothing numeric to plot.
          const chartHint = canVisualize && activeSeries.length > 0 ? {
            widget_type: chartType,
            label_column: labelIdxForActions >= 0 ? columns[labelIdxForActions] : null,
            value_columns: activeSeries.map((j) => columns[j]),
          } : null
          const r = await onSaveToDashboard(question, sql, queryResult, chartHint, buildTarget())
          setDashSaved({ url: r.url, created: r.created })
        } catch (e: any) {
          setDashError(e.message || 'Failed to save to dashboard')
        } finally { setDashSaving(false) }
      }}
      disabled={dashSaving}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
        dashSaved
          ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
          : dashError
            ? 'bg-red-500/10 text-red-500 border border-red-500/20'
            : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#6366F1] hover:border-[#6366F1]/30'
      }`}
      title={dashError || (dashSaved ? `Added to dashboard (${dashSaved.created ? 'created' : 'appended'})` : 'Recreate this exact visual on the room dashboard')}
    >
      {dashSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : dashSaved ? <Check className="w-3.5 h-3.5" /> : <LayoutDashboard className="w-3.5 h-3.5" />}
      {dashSaved ? (
        <a href={dashSaved.url} target="_blank" rel="noopener noreferrer" className="underline">
          Open dashboard
        </a>
      ) : dashError ? 'Retry' : 'Add visual to dashboard'}
    </button>
  )

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
              : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#6366F1] hover:border-[#6366F1]/30'
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
              : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#6366F1] hover:border-[#6366F1]/30'
          }`}
        >
          {addingSample ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : sampleAdded ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
          {sampleAdded ? 'Sample added' : 'Add as sample question'}
        </button>
      )}

      {sql && dashboards.length > 0 && (
        <select
          value={dashTarget}
          onChange={(e) => setDashTarget(e.target.value)}
          title="Choose which dashboard to add to"
          className="px-2 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] text-xs text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] max-w-[12rem]"
        >
          <option value="">Default dashboard</option>
          {dashboards.map((d) => (
            <option key={d.id} value={d.dashboard_id}>{d.name}{d.is_default ? ' (default)' : ''}</option>
          ))}
          <option value="__new__">＋ New dashboard</option>
        </select>
      )}

      {sql && (
        <>
          {/* Chart save lives here only until a chart is produced; once the Visualize
              panel is open it moves next to the chart (see VisualizationPanel action). */}
          {!showChart && dashSaveButton}

          {/* Separate option: add the raw table (all columns) as its own widget. */}
          <button
            onClick={async () => {
              setTblSaving(true)
              setTblError('')
              try {
                // chart_hint=null forces the backend to build a table widget.
                const r = await onSaveToDashboard(question, sql, queryResult, null, buildTarget())
                setTblSaved({ url: r.url, created: r.created })
              } catch (e: any) {
                setTblError(e.message || 'Failed to add table to dashboard')
              } finally { setTblSaving(false) }
            }}
            disabled={tblSaving}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tblSaved
                ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                : tblError
                  ? 'bg-red-500/10 text-red-500 border border-red-500/20'
                  : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#6366F1] hover:border-[#6366F1]/30'
            }`}
            title={tblError || (tblSaved ? `Table added to dashboard (${tblSaved.created ? 'created' : 'appended'})` : 'Add this query as a table widget on the room dashboard')}
          >
            {tblSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : tblSaved ? <Check className="w-3.5 h-3.5" /> : <Table2 className="w-3.5 h-3.5" />}
            {tblSaved ? (
              <a href={tblSaved.url} target="_blank" rel="noopener noreferrer" className="underline">
                Open dashboard
              </a>
            ) : tblError ? 'Retry' : 'Add table to dashboard'}
          </button>
          {(dashError || tblError) && (
            <p className="w-full text-[10px] text-red-500 mt-1 break-words">{dashError || tblError}</p>
          )}
        </>
      )}

      {canVisualize && (
        <button
          onClick={() => setShowChart(!showChart)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            showChart
              ? 'bg-[#3B82F6]/10 text-[#3B82F6] border border-[#3B82F6]/20'
              : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-secondary)] hover:text-[#3B82F6] hover:border-[#3B82F6]/30'
          }`}
        >
          <BarChart3 className="w-3.5 h-3.5" />
          {showChart ? 'Hide chart' : 'Visualize'}
        </button>
      )}

      {showChart && canVisualize && (
        <div className="w-full mt-2">
          <VisualizationPanel
            columns={columns}
            types={types}
            rows={rows}
            chartType={chartType}
            setChartType={setChartType}
            activeSeries={activeSeries}
            setActiveSeries={setActiveSeries}
            action={dashSaveButton}
          />
        </div>
      )}
    </div>
  )
}

function shortNum(n: number): string {
  if (!isFinite(n)) return '0'
  const abs = Math.abs(n)
  if (abs >= 1e12) return (n / 1e12).toFixed(abs >= 1e13 ? 0 : 1) + 'T'
  if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + 'B'
  if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + 'M'
  if (abs >= 1e3) return (n / 1e3).toFixed(abs >= 1e4 ? 0 : 1) + 'k'
  if (Number.isInteger(n)) return n.toLocaleString('en-US')
  return n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

type ChartType = 'barV' | 'barH' | 'line' | 'area' | 'pie' | 'scatter' | 'stacked'

const PALETTE = ['#6366F1', '#3B82F6', '#EC4899', '#22D3EE', '#F472B6', '#A855F7', '#4338CA', '#60A5FA']

const CHART_TYPE_META: { id: ChartType; label: string }[] = [
  { id: 'barV', label: 'Bar' },
  { id: 'barH', label: 'Bar (H)' },
  { id: 'line', label: 'Line' },
  { id: 'area', label: 'Area' },
  { id: 'stacked', label: 'Stacked' },
  { id: 'pie', label: 'Pie' },
  { id: 'scatter', label: 'Scatter' },
]

function VisualizationPanel({ columns, types, rows, chartType, setChartType, activeSeries, setActiveSeries, action }: {
  columns: string[]
  types: string[]
  rows: any[][]
  chartType: ChartType
  setChartType: (t: ChartType) => void
  activeSeries: number[]
  setActiveSeries: (s: number[]) => void
  action?: React.ReactNode
}) {
  // Detect numeric columns
  const numericFlags = columns.map((_, j) => {
    if (isNumericType(types[j] || '')) return true
    const sample = rows.slice(0, 20).filter((r) => r[j] !== null && r[j] !== '')
    return sample.length > 0 && sample.every((r) => !isNaN(Number(r[j])))
  })

  const labelIdx = numericFlags.findIndex((n) => !n)
  const valueIndices = columns.map((_, j) => j).filter((j) => numericFlags[j] && j !== labelIdx)

  if (valueIndices.length === 0) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-secondary)] p-4">
        <p className="text-xs text-[var(--text-secondary)]">No numeric column found to chart.</p>
      </div>
    )
  }

  // Build canonical data
  const labelCol = labelIdx >= 0 ? columns[labelIdx] : '(index)'
  const data = rows.slice(0, 40).map((r, i) => ({
    label: labelIdx >= 0 ? String(r[labelIdx] ?? '') : `#${i + 1}`,
    values: activeSeries.map((j) => Number(r[j]) || 0),
  }))

  const availTypes: ChartType[] = ['barV', 'barH', 'line', 'area', 'pie', 'scatter', 'stacked'].filter((t) => {
    if (t === 'pie') return activeSeries.length === 1 && data.length <= 10
    if (t === 'scatter') return labelIdx < 0 || (valueIndices.length >= 2)
    if (t === 'stacked') return activeSeries.length >= 2
    return true
  }) as ChartType[]

  // Effective chart type — if user-picked is not allowed for current series, fallback
  const effectiveType = availTypes.includes(chartType) ? chartType : availTypes[0]

  const seriesNames = activeSeries.map((j) => columns[j])

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-primary)] p-4 shadow-sm space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <BarChart3 className="w-4 h-4 text-[#3B82F6] shrink-0" />
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-[var(--text-primary)] uppercase tracking-wider truncate">
              {seriesNames.length > 1 ? `${seriesNames.length} series` : seriesNames[0]}
            </p>
            <p className="text-[10px] text-[var(--text-secondary)] truncate">by {labelCol}</p>
          </div>
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>

      {/* Chart-type tabs */}
      <div className="flex flex-wrap gap-1">
        {CHART_TYPE_META.filter((c) => availTypes.includes(c.id)).map((c) => (
          <button
            key={c.id}
            onClick={() => setChartType(c.id)}
            className={`px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              effectiveType === c.id
                ? 'bg-[#3B82F6] text-white'
                : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* Series selector (only when multiple numeric cols available) */}
      {valueIndices.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {valueIndices.map((j) => {
            const on = activeSeries.includes(j)
            const seriesPos = activeSeries.indexOf(j)
            const color = on ? PALETTE[seriesPos % PALETTE.length] : 'transparent'
            return (
              <button
                key={j}
                onClick={() => setActiveSeries(on
                  ? activeSeries.filter((x) => x !== j)
                  : [...activeSeries, j].slice(0, PALETTE.length))}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] transition-colors ${
                  on ? 'border-[var(--border)] bg-[var(--bg-secondary)] text-[var(--text-primary)]'
                     : 'border-[var(--border)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                <span className="w-2 h-2 rounded-full border border-[var(--border)]" style={{ background: color }} />
                {columns[j]}
              </button>
            )
          })}
        </div>
      )}

      {/* Chart body */}
      <ChartRenderer type={effectiveType} data={data} seriesNames={seriesNames} />

      {data.length < rows.length && (
        <p className="text-[10px] text-[var(--text-secondary)] text-center">Showing {data.length} of {rows.length} rows</p>
      )}
    </div>
  )
}


type ChartData = { label: string; values: number[] }[]

function ChartRenderer({ type, data, seriesNames }: { type: ChartType; data: ChartData; seriesNames: string[] }) {
  if (data.length === 0) return <p className="text-xs text-[var(--text-secondary)]">No data.</p>

  if (type === 'barH') {
    const flat = data.flatMap((d) => d.values)
    const maxV = Math.max(...flat, 1)
    const minV = Math.min(...flat, 0)
    return (
      <div className="space-y-2">
        {data.map((d, i) => (
          <div key={i}>
            <div className="flex items-center gap-3 mb-1">
              <span className="text-[11px] text-[var(--text-secondary)] w-28 truncate text-right shrink-0">{d.label}</span>
              <div className="flex-1 flex gap-0.5 items-center h-6">
                {d.values.map((v, k) => {
                  const pct = ((v - minV) / (maxV - minV || 1)) * 100
                  return (
                    <div key={k} className="relative flex-1 h-full bg-[var(--bg-tertiary)] rounded overflow-hidden" title={`${seriesNames[k]}: ${v.toLocaleString()}`}>
                      <div className="h-full rounded transition-all duration-500" style={{ width: `${Math.max(pct, 1)}%`, background: PALETTE[k % PALETTE.length] }} />
                    </div>
                  )
                })}
              </div>
              <span className="text-[11px] font-mono font-semibold text-[var(--text-primary)] w-20 text-right shrink-0 tabular-nums">
                {shortNum(d.values.reduce((a, b) => a + b, 0))}
              </span>
            </div>
          </div>
        ))}
        <Legend seriesNames={seriesNames} />
      </div>
    )
  }

  // SVG-based charts
  const W = Math.max(data.length * 50, 360)
  const H = 220
  const PAD_L = 50, PAD_R = 16, PAD_T = 16, PAD_B = 40
  const plotW = W - PAD_L - PAD_R
  const plotH = H - PAD_T - PAD_B

  if (type === 'pie') {
    const total = data.reduce((sum, d) => sum + (d.values[0] || 0), 0) || 1
    const cx = W / 2, cy = H / 2, r = Math.min(W, H) / 2 - 24
    let angle = -Math.PI / 2
    const slices = data.map((d, i) => {
      const v = d.values[0] || 0
      const sliceAngle = (v / total) * Math.PI * 2
      const x1 = cx + Math.cos(angle) * r
      const y1 = cy + Math.sin(angle) * r
      const a2 = angle + sliceAngle
      const x2 = cx + Math.cos(a2) * r
      const y2 = cy + Math.sin(a2) * r
      const large = sliceAngle > Math.PI ? 1 : 0
      const path = `M ${cx},${cy} L ${x1},${y1} A ${r},${r} 0 ${large} 1 ${x2},${y2} Z`
      const labelAngle = angle + sliceAngle / 2
      const labelR = r * 0.6
      const lx = cx + Math.cos(labelAngle) * labelR
      const ly = cy + Math.sin(labelAngle) * labelR
      angle = a2
      return { path, label: d.label, value: v, pct: (v / total) * 100, lx, ly, color: PALETTE[i % PALETTE.length] }
    })
    return (
      <div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
          {slices.map((s, i) => (
            <g key={i}>
              <path d={s.path} fill={s.color} stroke="var(--bg-primary)" strokeWidth="2">
                <title>{`${s.label}: ${s.value.toLocaleString()} (${s.pct.toFixed(1)}%)`}</title>
              </path>
              {s.pct > 5 && (
                <text x={s.lx} y={s.ly} textAnchor="middle" fontSize="10" fontWeight="600" fill="white">{s.pct.toFixed(0)}%</text>
              )}
            </g>
          ))}
        </svg>
        <div className="grid grid-cols-2 gap-1 mt-2">
          {slices.map((s, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[10px]">
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: s.color }} />
              <span className="text-[var(--text-primary)] truncate flex-1">{s.label}</span>
              <span className="text-[var(--text-secondary)] font-mono">{shortNum(s.value)}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (type === 'scatter') {
    // Use first two series as X/Y; if only one, use index as X
    const xs = data.map((_, i) => i)
    const ys = data.map((d) => d.values[0] || 0)
    const yMin = Math.min(...ys, 0), yMax = Math.max(...ys, 1)
    const xMin = 0, xMax = data.length - 1 || 1
    const xFor = (x: number) => PAD_L + ((x - xMin) / (xMax - xMin || 1)) * plotW
    const yFor = (y: number) => PAD_T + plotH - ((y - yMin) / (yMax - yMin || 1)) * plotH
    return (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <YGridAndAxes minV={yMin} maxV={yMax} W={W} H={H} PAD_L={PAD_L} PAD_R={PAD_R} PAD_T={PAD_T} PAD_B={PAD_B} />
        {xs.map((x, i) => (
          <circle key={i} cx={xFor(x)} cy={yFor(ys[i])} r="4" fill={PALETTE[0]} fillOpacity="0.6" stroke={PALETTE[0]} strokeWidth="1">
            <title>{`${data[i].label}: ${ys[i].toLocaleString()}`}</title>
          </circle>
        ))}
      </svg>
    )
  }

  // Bar (vertical), line, area, stacked
  const isStacked = type === 'stacked'
  const valsPerRow = data.map((d) => isStacked ? d.values.reduce((a, b) => a + b, 0) : Math.max(...d.values))
  const minV = Math.min(...(isStacked ? valsPerRow : data.flatMap((d) => d.values)), 0)
  const maxV = Math.max(...valsPerRow, 1)
  const range = maxV - minV || 1

  const yFor = (v: number) => PAD_T + plotH - ((v - minV) / range) * plotH
  const xStep = data.length > 1 ? plotW / data.length : plotW
  const xFor = (i: number) => PAD_L + i * xStep + xStep / 2

  const yTicks = 4
  const tickValues = Array.from({ length: yTicks + 1 }, (_, k) => minV + (range * k) / yTicks)
  const maxLabels = Math.floor(plotW / 60)
  const labelStep = Math.max(1, Math.ceil(data.length / Math.max(maxLabels, 1)))

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" preserveAspectRatio="xMidYMid meet">
        <defs>
          {seriesNames.map((_, k) => (
            <linearGradient key={k} id={`grad-${k}`} x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor={PALETTE[k % PALETTE.length]} stopOpacity={type === 'area' ? '0.4' : '1'} />
              <stop offset="100%" stopColor={PALETTE[k % PALETTE.length]} stopOpacity={type === 'area' ? '0' : '1'} />
            </linearGradient>
          ))}
        </defs>

        <YGridAndAxes minV={minV} maxV={maxV} W={W} H={H} PAD_L={PAD_L} PAD_R={PAD_R} PAD_T={PAD_T} PAD_B={PAD_B} />

        {/* Render based on type */}
        {type === 'barV' && data.map((d, i) => {
          const barW = Math.max((xStep - 6) / seriesNames.length, 4)
          return seriesNames.map((_, k) => {
            const v = d.values[k] || 0
            const y = yFor(v)
            const h = yFor(0) - y
            const x = PAD_L + i * xStep + 3 + k * barW
            return (
              <rect key={`${i}-${k}`} x={x} y={Math.min(y, yFor(0))} width={barW - 1} height={Math.abs(h)} fill={PALETTE[k % PALETTE.length]} rx="2">
                <title>{`${d.label} · ${seriesNames[k]}: ${v.toLocaleString()}`}</title>
              </rect>
            )
          })
        })}

        {type === 'stacked' && data.map((d, i) => {
          const barW = Math.max(xStep - 6, 8)
          let cumulative = 0
          return d.values.map((v, k) => {
            const y0 = yFor(cumulative)
            cumulative += v
            const y1 = yFor(cumulative)
            const x = PAD_L + i * xStep + 3
            return (
              <rect key={`${i}-${k}`} x={x} y={Math.min(y0, y1)} width={barW - 1} height={Math.abs(y0 - y1)} fill={PALETTE[k % PALETTE.length]}>
                <title>{`${d.label} · ${seriesNames[k]}: ${v.toLocaleString()}`}</title>
              </rect>
            )
          })
        })}

        {(type === 'line' || type === 'area') && seriesNames.map((_, k) => (
          <g key={k}>
            {type === 'area' && (
              <polygon
                fill={PALETTE[k % PALETTE.length]}
                fillOpacity="0.2"
                points={`${xFor(0)},${H - PAD_B} ${data.map((d, i) => `${xFor(i)},${yFor(d.values[k] || 0)}`).join(' ')} ${xFor(data.length - 1)},${H - PAD_B}`}
              />
            )}
            <polyline
              fill="none"
              stroke={PALETTE[k % PALETTE.length]}
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              points={data.map((d, i) => `${xFor(i)},${yFor(d.values[k] || 0)}`).join(' ')}
            />
            {data.map((d, i) => (
              <circle key={i} cx={xFor(i)} cy={yFor(d.values[k] || 0)} r="3" fill="var(--bg-primary)" stroke={PALETTE[k % PALETTE.length]} strokeWidth="2">
                <title>{`${d.label} · ${seriesNames[k]}: ${(d.values[k] || 0).toLocaleString()}`}</title>
              </circle>
            ))}
          </g>
        ))}

        {/* X-axis labels */}
        {data.map((d, i) => i % labelStep === 0 ? (
          <text key={`xl${i}`} x={xFor(i)} y={H - PAD_B + 16} textAnchor="middle" fontSize="10" fill="var(--text-secondary)">
            {d.label.length > 10 ? d.label.slice(0, 10) + '…' : d.label}
          </text>
        ) : null)}
      </svg>
      {seriesNames.length > 1 && <Legend seriesNames={seriesNames} />}
    </div>
  )

  // Unused tickValues kept for future custom-axis features
  void tickValues
}


function Legend({ seriesNames }: { seriesNames: string[] }) {
  return (
    <div className="flex flex-wrap gap-3 mt-2 justify-center">
      {seriesNames.map((name, k) => (
        <div key={k} className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: PALETTE[k % PALETTE.length] }} />
          <span className="text-[10px] text-[var(--text-primary)]">{name}</span>
        </div>
      ))}
    </div>
  )
}


function YGridAndAxes({ minV, maxV, W, H, PAD_L, PAD_R, PAD_T, PAD_B }: {
  minV: number; maxV: number; W: number; H: number; PAD_L: number; PAD_R: number; PAD_T: number; PAD_B: number;
}) {
  const range = maxV - minV || 1
  const plotH = H - PAD_T - PAD_B
  const yFor = (v: number) => PAD_T + plotH - ((v - minV) / range) * plotH
  const yTicks = 4
  const tickValues = Array.from({ length: yTicks + 1 }, (_, k) => minV + (range * k) / yTicks)
  return (
    <>
      {tickValues.map((v, k) => {
        const y = yFor(v)
        return (
          <g key={k}>
            <line x1={PAD_L} x2={W - PAD_R} y1={y} y2={y} stroke="var(--border)" strokeWidth="0.5" strokeDasharray="2 3" />
            <text x={PAD_L - 6} y={y + 3} textAnchor="end" fontSize="10" fill="var(--text-secondary)" fontFamily="ui-monospace, monospace">
              {shortNum(v)}
            </text>
          </g>
        )
      })}
      <line x1={PAD_L} x2={W - PAD_R} y1={H - PAD_B} y2={H - PAD_B} stroke="var(--border)" strokeWidth="1" />
    </>
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
        <pre className="px-4 py-3 bg-[var(--bg-tertiary)] text-sm text-[#3B82F6] overflow-x-auto font-mono">
          {sql}
        </pre>
      )}
    </div>
  )
}

function extractColumnsAndRows(data: any): { columns: string[]; types: string[]; rows: any[][] } {
  const colMeta: any[] = data?.manifest?.schema?.columns || []
  const columns: string[] = colMeta.map((c: any) => c.name)
  const types: string[] = colMeta.map((c: any) => (c.type_text || c.type_name || c.type || '').toLowerCase())
  const rows: any[][] =
    data?.result?.data_array ||
    data?.result?.result?.data_array ||
    []
  return { columns, types, rows }
}

const NUMERIC_TYPES = ['int', 'long', 'bigint', 'smallint', 'double', 'float', 'decimal', 'numeric', 'short', 'byte']
const isNumericType = (t: string) => NUMERIC_TYPES.some((nt) => t.includes(nt))

// Match common ISO/SQL date-time strings so we can strip the time portion
const ISO_DATETIME_RE = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/

function formatCell(value: any, type: string): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'number' || (isNumericType(type) && !isNaN(Number(value)))) {
    const n = Number(value)
    if (!isFinite(n)) return String(value)
    if (Number.isInteger(n) || type.includes('int') || type.includes('long')) {
      return n.toLocaleString('en-US')
    }
    return n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })
  }
  const s = String(value)
  if (type.includes('date') || type.includes('timestamp')) {
    // Show date only — strip the time portion
    const m = s.match(ISO_DATETIME_RE)
    if (m) return m[1]
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
    return s
  }
  // Heuristic: any value that looks like an ISO datetime — drop the time
  const m = s.match(ISO_DATETIME_RE)
  if (m) return m[1]
  return s
}

function QueryResultTable({ data }: { data: any }) {
  const { columns, types, rows } = extractColumnsAndRows(data)
  if (columns.length === 0 || rows.length === 0) return null

  const numericCols = columns.map((_, j) => isNumericType(types[j] || '') ||
    rows.slice(0, 10).every((r) => r[j] === null || r[j] === '' || !isNaN(Number(r[j]))))

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden bg-white">
      <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
        <div className="flex items-center gap-2">
          <Table2 className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <span className="text-[10px] font-semibold text-[var(--text-primary)] uppercase tracking-[0.08em]">Query result</span>
        </div>
        <span className="text-[10px] text-[var(--text-secondary)] tabular-nums">
          {rows.length.toLocaleString()} row{rows.length !== 1 ? 's' : ''} · {columns.length} col{columns.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="overflow-x-auto max-h-96">
        <table className="w-full text-[13px] border-collapse">
          <thead className="sticky top-0 z-10 bg-white">
            <tr>
              {columns.map((col, j) => (
                <th
                  key={col}
                  className={`px-4 py-2.5 font-semibold text-[10px] uppercase tracking-[0.06em] text-[var(--text-secondary)] whitespace-nowrap border-b border-[var(--border)] bg-white ${
                    numericCols[j] ? 'text-right' : 'text-left'
                  }`}
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
                className="border-b border-[var(--border)]/60 last:border-0 hover:bg-[var(--bg-secondary)] transition-colors"
              >
                {row.map((cell, j) => (
                  <td
                    key={j}
                    className={`px-4 py-2 whitespace-nowrap text-[var(--text-primary)] ${
                      numericCols[j] ? 'text-right font-mono tabular-nums tracking-tight' : 'text-left'
                    } ${cell === null || cell === undefined ? 'text-[var(--text-secondary)] italic' : ''}`}
                  >
                    {formatCell(cell, types[j] || '')}
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
