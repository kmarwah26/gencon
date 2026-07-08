import { useState, useEffect, useRef } from 'react'
import {
  Send,
  Loader2,
  User,
  Network,
  ChevronRight,
  Check,
  Save,
  Settings,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import { api } from '../api'

interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  question?: string
  endpoint?: string
}

export default function SupervisorChat() {
  const [endpoints, setEndpoints] = useState<{ name: string; state: string }[]>([])
  const [loadingEndpoints, setLoadingEndpoints] = useState(true)
  const [endpointsError, setEndpointsError] = useState('')
  const [selectedEndpoint, setSelectedEndpoint] = useState<string>('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [panelCollapsed, setPanelCollapsed] = useState(false)
  const [instructions, setInstructions] = useState('')
  const [savingConfig, setSavingConfig] = useState(false)
  const [configSaved, setConfigSaved] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const loadEndpoints = () => {
    setLoadingEndpoints(true)
    setEndpointsError('')
    api.listSupervisorEndpoints()
      .then((r) => setEndpoints(r.endpoints))
      .catch((e) => setEndpointsError(e.message || 'Failed to load serving endpoints'))
      .finally(() => setLoadingEndpoints(false))
  }

  useEffect(loadEndpoints, [])

  // Load the saved setup (chosen endpoint + instructions) once.
  useEffect(() => {
    api.getSupervisorConfig()
      .then((c) => {
        if (c.endpoint_name) setSelectedEndpoint(c.endpoint_name)
        if (c.instructions) setInstructions(c.instructions)
      })
      .catch(() => {})
  }, [])

  const saveConfig = async () => {
    setSavingConfig(true)
    setConfigSaved(false)
    try {
      await api.saveSupervisorConfig({ endpoint_name: selectedEndpoint || null, instructions })
      setConfigSaved(true)
      setTimeout(() => setConfigSaved(false), 2000)
    } catch (e: any) {
      alert(e.message || 'Failed to save setup')
    } finally {
      setSavingConfig(false)
    }
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  const sendMessage = async () => {
    if (!input.trim() || loading || !selectedEndpoint) return
    const question = input.trim()
    setInput('')
    setMessages((prev) => [...prev, { role: 'user', content: question }])
    setLoading(true)

    try {
      const result = await api.supervisorAsk({
        question,
        endpoint_name: selectedEndpoint,
        instructions,
      })
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: result.answer, question, endpoint: result.endpoint_name },
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

  const hasSelection = !!selectedEndpoint

  return (
    <div className="flex h-full">
      {/* Setup panel */}
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
          </button>
        ) : (
          <>
            <div className="p-3 border-b border-[var(--border)] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Network className="w-4 h-4 text-[#6366F1]" />
                <span className="text-sm font-semibold text-[var(--text-primary)]">Supervisor</span>
              </div>
              <button
                onClick={() => setPanelCollapsed(true)}
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                title="Collapse panel"
              >
                <ChevronRight className="w-4 h-4 rotate-180" />
              </button>
            </div>

            {/* Endpoint picker */}
            <div className="p-3 border-b border-[var(--border)]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Agent Bricks Supervisor
                </span>
                <button
                  onClick={loadEndpoints}
                  className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                  title="Refresh endpoints"
                >
                  <RefreshCw className={`w-3 h-3 ${loadingEndpoints ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {loadingEndpoints ? (
                <div className="flex items-center gap-2 text-[11px] text-[var(--text-secondary)] py-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading endpoints…
                </div>
              ) : endpointsError ? (
                <p className="text-[11px] text-red-500">{endpointsError}</p>
              ) : endpoints.length === 0 ? (
                <div className="text-[11px] text-[var(--text-secondary)] leading-snug space-y-2">
                  <p>No serving endpoints found.</p>
                  <p>
                    Create a <span className="font-medium text-[var(--text-primary)]">Multi-Agent
                    Supervisor</span> in Agent Bricks (add your Genie spaces as subagents), then
                    refresh and select it here.
                  </p>
                  <a
                    href="https://docs.databricks.com/aws/en/generative-ai/agent-bricks/multi-agent-supervisor"
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[#6366F1] hover:underline"
                  >
                    Agent Bricks docs <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              ) : (
                <select
                  value={selectedEndpoint}
                  onChange={(e) => setSelectedEndpoint(e.target.value)}
                  className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] focus:outline-none focus:border-[#6366F1]"
                >
                  <option value="">Select a supervisor endpoint…</option>
                  {endpoints.map((e) => (
                    <option key={e.name} value={e.name}>{e.name}</option>
                  ))}
                </select>
              )}
              <p className="text-[9px] text-[var(--text-secondary)] mt-1.5 leading-snug">
                Pick the serving endpoint of your Agent Bricks Multi-Agent Supervisor. It routes your
                question across its Genie subagents using your own data access.
              </p>
            </div>

            {/* Instructions + save setup */}
            <div className="p-3 border-t border-[var(--border)]">
              <div className="flex items-center gap-1.5 mb-1.5">
                <Settings className="w-3.5 h-3.5 text-[#6366F1]" />
                <span className="text-[10px] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">
                  Context (optional)
                </span>
              </div>
              <textarea
                value={instructions}
                onChange={(e) => setInstructions(e.target.value)}
                placeholder="Context prepended to each question — e.g. 'Report figures in USD and call out YoY changes.'"
                rows={3}
                className="w-full px-2 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] resize-none"
              />
              <button
                onClick={saveConfig}
                disabled={savingConfig}
                className="mt-1.5 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white text-[11px] font-medium disabled:opacity-50"
              >
                {savingConfig ? <Loader2 className="w-3 h-3 animate-spin" /> : configSaved ? <Check className="w-3 h-3" /> : <Save className="w-3 h-3" />}
                {configSaved ? 'Saved' : 'Save setup'}
              </button>
              <p className="text-[9px] text-[var(--text-secondary)] mt-1 leading-snug">
                Saves your chosen endpoint + context so this is ready next time.
              </p>
            </div>
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
              Ask Everything
            </h2>
            <p className="text-[11px] text-[var(--text-secondary)]">
              {selectedEndpoint
                ? `Routing via ${selectedEndpoint}`
                : 'Powered by an Agent Bricks Multi-Agent Supervisor'}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-5 py-6 space-y-6">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)]">
              <Network className="w-16 h-16 mb-4 opacity-15" />
              <p className="text-xl font-medium text-[var(--text-primary)] opacity-60 mb-2">
                Ask across all your data
              </p>
              <p className="text-sm mb-4 text-center max-w-md">
                Select your Agent Bricks supervisor endpoint in the panel, then ask a question. It
                routes across its Genie subagents and answers using your own data access.
              </p>
              {!hasSelection && (
                <div className="flex items-center gap-2 text-xs bg-amber-500/10 text-amber-600 px-3 py-2 rounded-lg">
                  <ChevronRight className="w-3.5 h-3.5" />
                  Select a supervisor endpoint to get started
                </div>
              )}
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
                  <Network className="w-4 h-4 text-white" />
                </div>
              )}
              <div className={`max-w-[75%] ${msg.role === 'user' ? 'order-first' : ''}`}>
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-[#6366F1] text-white rounded-tr-sm'
                      : 'bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] rounded-tl-sm'
                  }`}
                >
                  {msg.content}
                </div>
                {msg.role === 'assistant' && msg.endpoint && (
                  <p className="text-[10px] text-[var(--text-secondary)] mt-1 ml-1">via {msg.endpoint}</p>
                )}
              </div>
              {msg.role === 'user' && (
                <div className="w-8 h-8 rounded-full bg-gradient-to-br from-[#6366F1] to-[#4338CA] flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-white" />
                </div>
              )}
            </div>
          ))}

          {loading && (
            <div className="flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center shrink-0">
                <Network className="w-4 h-4 text-white" />
              </div>
              <div className="px-4 py-2.5 rounded-2xl rounded-tl-sm bg-[var(--bg-secondary)] border border-[var(--border)] flex items-center gap-2 text-sm text-[var(--text-secondary)]">
                <Loader2 className="w-4 h-4 animate-spin" /> Thinking…
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="shrink-0 px-5 py-4 border-t border-[var(--border)] bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={hasSelection ? 'Ask a question about your data…' : 'Select a supervisor endpoint first'}
              disabled={!hasSelection || loading}
              className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] disabled:opacity-50"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || loading || !hasSelection}
              className="p-2.5 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white disabled:opacity-40 transition-colors"
            >
              {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Send className="w-5 h-5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
