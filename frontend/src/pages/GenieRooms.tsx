import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { MessageSquare, Plus, Loader2, ArrowRight, Sparkles, Search, Zap, RefreshCw, Pencil } from 'lucide-react'
import { api } from '../api'
import type { GenieRoom } from '../api'

export default function GenieRooms() {
  const [rooms, setRooms] = useState<GenieRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const navigate = useNavigate()

  const [source, setSource] = useState<'cache' | 'live' | ''>('')

  useEffect(() => {
    // Try cache first, fall back to live API
    api.cachedRooms()
      .then((cached) => {
        setRooms(cached.rooms)
        setSource('cache')
        setLoading(false)
      })
      .catch(() => {
        // Cache unavailable — use live API
        api.listGenieRooms()
          .then((roomsResp) => {
            setRooms(roomsResp.rooms)
            setSource('live')
            setLoading(false)
          })
          .catch((e) => { setError(e.message); setLoading(false) })
      })
  }, [])

  const filteredRooms = useMemo(() => {
    if (!search.trim()) return rooms
    const q = search.toLowerCase()
    return rooms.filter(
      (r) => r.title.toLowerCase().includes(q) || (r.description || '').toLowerCase().includes(q)
    )
  }, [rooms, search])

  return (
    <div className="px-12 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#D0A33C] to-[#3F1F14] flex items-center justify-center">
            <MessageSquare className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Genie Rooms</h2>
            <p className="text-sm text-[var(--text-secondary)]">
              Your AI-powered data rooms
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {source && (
            <span className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium ${
              source === 'cache'
                ? 'bg-emerald-500/10 text-emerald-600'
                : 'bg-amber-500/10 text-amber-600'
            }`}>
              {source === 'cache' ? <Zap className="w-3 h-3" /> : <RefreshCw className="w-3 h-3" />}
              {source === 'cache' ? 'Cached' : 'Live'}
            </span>
          )}
          <button
            onClick={() => navigate('/create')}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Room
          </button>
        </div>
      </div>

      {/* Search */}
      {!loading && rooms.length > 0 && (
        <div className="relative mb-6 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search rooms..."
            className="w-full pl-9 pr-4 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C]/50"
          />
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
          <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading rooms...
        </div>
      )}

      {error && (
        <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
          {error}
        </div>
      )}

      {!loading && !error && rooms.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-[var(--text-secondary)]">
          <Sparkles className="w-14 h-14 mb-4 opacity-20" />
          <p className="text-lg mb-2">No Genie Rooms yet</p>
          <p className="text-sm mb-6">Create your first room to start asking questions about your data</p>
          <button
            onClick={() => navigate('/create')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> Create Room
          </button>
        </div>
      )}

      {!loading && !error && rooms.length > 0 && filteredRooms.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-[var(--text-secondary)]">
          <Search className="w-10 h-10 mb-3 opacity-20" />
          <p className="text-base mb-1">No rooms match "{search}"</p>
          <p className="text-sm">Try a different search term</p>
        </div>
      )}

      <div className="grid gap-4">
        {filteredRooms.map((room) => (
          <button
            key={room.id}
            onClick={() => navigate(`/rooms/${room.id}`)}
            className="flex items-center gap-4 p-5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[#D0A33C]/40 hover:bg-[var(--bg-tertiary)] transition-all text-left group"
          >
            <div className="w-11 h-11 rounded-lg bg-[#D0A33C]/15 flex items-center justify-center shrink-0">
              <Sparkles className="w-5 h-5 text-[#D0A33C]" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">
                {room.title}
              </h3>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">
                {room.description || 'No description'}
              </p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); navigate(`/edit/${room.id}`) }}
              className="px-2.5 py-1.5 rounded-md bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors shrink-0 opacity-0 group-hover:opacity-100"
              title="Edit room">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <ArrowRight className="w-5 h-5 text-[var(--text-secondary)] group-hover:text-[#D0A33C] transition-colors shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
