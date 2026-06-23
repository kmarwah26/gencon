import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, Link } from 'react-router-dom'
import {
  Database, Plus, MessageSquare, Sparkles, Network,
  User, ArrowLeft, ArrowRight, Pencil, Trash2, Loader2, FlaskConical,
  Zap, TrendingUp,
} from 'lucide-react'
import { api } from './api'
import type { CurrentUser } from './api'
import CatalogExplorer from './pages/CatalogExplorer'
import CreateRoom from './pages/CreateRoom'
import EditRoom from './pages/EditRoom'
import GenieRooms from './pages/GenieRooms'
import GenieChat from './pages/GenieChat'
import SupervisorChat from './pages/SupervisorChat'
import Services from './pages/Services'
import SampleDataGenerator from './pages/SampleDataGenerator'
const tiles = [
  { to: '/catalog', icon: Database, label: 'Explore Data', desc: 'See the customer and campaign data available to your team', color: 'from-[#325B6D] to-[#3F1F14]' },
  { to: '/sample-data', icon: FlaskConical, label: 'Demo Datasets', desc: 'Spin up realistic sample data for demos and trials', color: 'from-violet-500 to-fuchsia-600' },
  { to: '/create', icon: Plus, label: 'New Assistant', desc: 'Set up an AI assistant for a new dataset', color: 'from-[#D0A33C] to-[#E3BC21]' },
  { to: '/rooms', icon: MessageSquare, label: 'Ask Questions', desc: 'Chat with your data and get instant answers', color: 'from-[#959B7A] to-[#325B6D]' },
  { to: '/edit', icon: Pencil, label: 'Manage Assistants', desc: 'Update and fine-tune your assistants', color: 'from-[#D69E77] to-[#E98475]' },
  { to: '/supervisor', icon: Network, label: 'Ask Everything', desc: 'One question, answered across all your data', color: 'from-[#921A28] to-[#3F1F14]' },
]

export default function App() {
  const location = useLocation()
  const [user, setUser] = useState<CurrentUser | null>(null)

  useEffect(() => {
    api.getCurrentUser().then(setUser).catch(() => {})
  }, [])

  const isHome = location.pathname === '/'
  const isChat = location.pathname.startsWith('/rooms/') || location.pathname === '/supervisor'

  const initials = user?.display_name
    ? user.display_name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    : '?'

  return (
    <div className="h-screen overflow-hidden flex flex-col">
      {/* Top bar */}
      <header className="shrink-0 h-14 bg-[var(--bg-secondary)] border-b border-[var(--border)] flex items-center px-5 gap-4">
        <Link to="/" className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#D0A33C] to-[#3F1F14] flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-white" />
          </div>
          <h1 className="text-base font-bold tracking-tight text-[var(--text-primary)]">Genie-Force</h1>
        </Link>
        <span className="text-xs text-[var(--text-secondary)]">Self-Serve Data Intelligence</span>

        <div className="ml-auto flex items-center gap-3">
          <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)]">
            <div className="w-6 h-6 rounded-full bg-gradient-to-br from-[#D0A33C] to-[#3F1F14] flex items-center justify-center">
              {user ? (
                <span className="text-[9px] font-bold text-white">{initials}</span>
              ) : (
                <User className="w-3 h-3 text-white" />
              )}
            </div>
            {user ? (
              <div className="hidden sm:block">
                <p className="text-xs font-medium text-[var(--text-primary)] leading-tight">{user.display_name}</p>
                <p className="text-[10px] text-[var(--text-secondary)] leading-tight">{user.user_name}</p>
              </div>
            ) : (
              <span className="text-xs text-[var(--text-secondary)]">Loading...</span>
            )}
          </div>
        </div>
      </header>

      {/* Content */}
      <main className={`flex-1 overflow-hidden ${isChat ? '' : 'overflow-y-auto'}`}>
        {!isHome && !isChat && (
          <div className="px-8 pt-5 pb-0">
            <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
              <ArrowLeft className="w-4 h-4" /> Home
            </Link>
          </div>
        )}
        <Routes>
          <Route path="/" element={<Home user={user} />} />
          <Route path="/catalog" element={<CatalogExplorer />} />
          <Route path="/create" element={<CreateRoom />} />
          <Route path="/rooms" element={<GenieRooms />} />
          <Route path="/rooms/:roomId" element={<GenieChat />} />
          <Route path="/edit" element={<EditRoomPicker />} />
          <Route path="/edit/:roomId" element={<EditRoom />} />
          <Route path="/supervisor" element={<SupervisorChat />} />
          <Route path="/sample-data" element={<SampleDataGenerator />} />
          <Route path="/services" element={<Services />} />
        </Routes>
      </main>
    </div>
  )
}

function Home({ user }: { user: CurrentUser | null }) {
  const navigate = useNavigate()
  const firstName = user?.display_name?.split(' ')[0]

  const highlights = [
    { icon: MessageSquare, title: 'Answers in plain English', desc: 'Ask questions the way you’d ask a teammate — no SQL, no dashboards, no waiting on analysts.' },
    { icon: Zap, title: 'Insights in seconds', desc: 'Go from question to answer instantly, so you can act while it still matters.' },
    { icon: TrendingUp, title: 'Built for go-to-market', desc: 'Made for marketing and sales to explore customers, campaigns, and pipeline.' },
  ]

  return (
    <div className="max-w-6xl mx-auto px-8 py-12">
      {/* Hero */}
      <div className="mb-10">
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#D0A33C]/10 text-[#D0A33C] text-xs font-semibold mb-4">
          <Sparkles className="w-3.5 h-3.5" /> Your data, in plain language
        </span>
        <h2 className="text-4xl font-bold text-[var(--text-primary)] mb-3 tracking-tight">
          {firstName ? `Welcome back, ${firstName}` : 'Welcome to Genie-Force'}
        </h2>
        <p className="text-lg text-[var(--text-secondary)] max-w-2xl leading-relaxed">
          A self-serve workspace where marketing and sales teams ask questions about their
          customers and campaigns — and get clear answers in seconds.
        </p>
        <div className="flex flex-wrap gap-3 mt-6">
          <button
            onClick={() => navigate('/rooms')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-semibold transition-colors"
          >
            <MessageSquare className="w-4 h-4" /> Ask a question <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => navigate('/create')}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--text-secondary)] text-[var(--text-primary)] text-sm font-semibold transition-colors"
          >
            <Plus className="w-4 h-4" /> Create an assistant
          </button>
        </div>
      </div>

      {/* Value highlights */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-12">
        {highlights.map((h) => (
          <div key={h.title} className="p-5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
            <div className="w-10 h-10 rounded-lg bg-[#D0A33C]/10 flex items-center justify-center mb-3">
              <h.icon className="w-5 h-5 text-[#D0A33C]" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{h.title}</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{h.desc}</p>
          </div>
        ))}
      </div>

      {/* What you can do */}
      <h3 className="text-xs font-semibold text-[var(--text-secondary)] uppercase tracking-wider mb-4">What you can do</h3>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {tiles.map((tile) => (
          <button
            key={tile.to}
            onClick={() => navigate(tile.to)}
            className="group text-left p-5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-[var(--text-secondary)] hover:shadow-lg transition-all duration-200"
          >
            <div className={`w-11 h-11 rounded-lg bg-gradient-to-br ${tile.color} flex items-center justify-center mb-4 group-hover:scale-110 transition-transform`}>
              <tile.icon className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-1">{tile.label}</h3>
            <p className="text-xs text-[var(--text-secondary)] leading-relaxed">{tile.desc}</p>
          </button>
        ))}
      </div>
    </div>
  )
}

function EditRoomPicker() {
  const [rooms, setRooms] = useState<import('./api').GenieRoom[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<import('./api').GenieRoom | null>(null)
  const [deleting, setDeleting] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    api.cachedRooms()
      .then((r) => { setRooms(r.rooms); setLoading(false) })
      .catch(() => {
        api.listGenieRooms()
          .then((r) => { setRooms(r.rooms); setLoading(false) })
          .catch((e) => { setError(e.message); setLoading(false) })
      })
  }, [])

  return (
    <div className="px-12 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
            <Pencil className="w-5 h-5 text-white" />
          </div>
          <div>
            <h2 className="text-2xl font-bold text-[var(--text-primary)]">Edit Genie Room</h2>
            <p className="text-sm text-[var(--text-secondary)]">Select a room to modify its tables, instructions, and queries</p>
          </div>
        </div>
      </div>

      {loading && (
        <div className="flex items-center justify-center py-20 text-[var(--text-secondary)]">
          <Sparkles className="w-5 h-5 animate-spin mr-2" /> Loading rooms...
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
          <p className="text-sm mb-6">Create your first room to get started</p>
          <button onClick={() => navigate('/create')}
            className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors">
            Create Room
          </button>
        </div>
      )}

      <div className="grid gap-4">
        {rooms.map((room) => (
          <div key={room.id}
            onClick={() => navigate(`/edit/${room.id}`)}
            className="flex items-center gap-4 p-5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)] hover:border-amber-500/40 hover:bg-[var(--bg-tertiary)] transition-all text-left group cursor-pointer">
            <div className="w-11 h-11 rounded-lg bg-amber-500/15 flex items-center justify-center shrink-0">
              <Pencil className="w-5 h-5 text-amber-600" />
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-semibold text-[var(--text-primary)] truncate">{room.title}</h3>
              <p className="text-sm text-[var(--text-secondary)] mt-0.5">{room.description || 'No description'}</p>
            </div>
            <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(room) }}
              className="p-2 rounded-lg text-[var(--text-secondary)] hover:text-red-500 hover:bg-red-500/10 opacity-0 group-hover:opacity-100 transition-all shrink-0"
              title="Delete room">
              <Trash2 className="w-4 h-4" />
            </button>
            <span className="text-xs font-medium text-amber-600 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">Edit &rsaquo;</span>
          </div>
        ))}
      </div>

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Delete Genie Room</h3>
            <p className="text-sm text-[var(--text-secondary)] mb-1">
              Are you sure you want to delete <span className="font-semibold text-[var(--text-primary)]">{deleteTarget.title}</span>?
            </p>
            <p className="text-xs text-red-400 mb-6">This action cannot be undone. All conversations in this room will be lost.</p>
            <div className="flex gap-3">
              <button onClick={() => setDeleteTarget(null)} disabled={deleting}
                className="flex-1 py-2.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors">
                Cancel
              </button>
              <button
                onClick={async () => {
                  setDeleting(true)
                  try {
                    await api.deleteGenieRoom(deleteTarget.id)
                    setRooms((prev) => prev.filter((r) => r.id !== deleteTarget.id))
                    setDeleteTarget(null)
                  } catch (e: any) {
                    setError(e.message || 'Failed to delete room')
                    setDeleteTarget(null)
                  } finally { setDeleting(false) }
                }}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-lg bg-red-500 hover:bg-red-600 text-white font-semibold text-sm transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
                {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Deleting...</> : 'Delete Room'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
