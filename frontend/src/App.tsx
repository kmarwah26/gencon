import { useState, useEffect } from 'react'
import { Routes, Route, useNavigate, useLocation, Link } from 'react-router-dom'
import {
  Database, Plus, MessageSquare, Sparkles, Network, Server,
  User, ArrowLeft, Pencil, Trash2, Loader2, FlaskConical,
  CheckCircle2, XCircle, AlertTriangle, Warehouse, Cpu, Layers,
} from 'lucide-react'
import { api } from './api'
import type { CurrentUser, ServiceStatus } from './api'
import CatalogExplorer from './pages/CatalogExplorer'
import CreateRoom from './pages/CreateRoom'
import EditRoom from './pages/EditRoom'
import GenieRooms from './pages/GenieRooms'
import GenieChat from './pages/GenieChat'
import SupervisorChat from './pages/SupervisorChat'
import Services from './pages/Services'
import SampleDataGenerator from './pages/SampleDataGenerator'
const tiles = [
  { to: '/catalog', icon: Database, label: 'Catalog Explorer', desc: 'Browse Unity Catalog tables', color: 'from-[#325B6D] to-[#3F1F14]' },
  { to: '/sample-data', icon: FlaskConical, label: 'Sample Data', desc: 'Generate industry datasets', color: 'from-violet-500 to-fuchsia-600' },
  { to: '/create', icon: Plus, label: 'Create Room', desc: 'Build a new Genie room', color: 'from-[#D0A33C] to-[#E3BC21]' },
  { to: '/rooms', icon: MessageSquare, label: 'Chat', desc: 'Chat with existing rooms', color: 'from-[#959B7A] to-[#325B6D]' },
  { to: '/edit', icon: Pencil, label: 'Edit Rooms', desc: 'Modify tables & instructions', color: 'from-[#D69E77] to-[#E98475]' },
  { to: '/supervisor', icon: Network, label: 'Supervisor Agent', desc: 'Multi-room question routing', color: 'from-[#921A28] to-[#3F1F14]' },
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
        <span className="text-xs text-[var(--text-secondary)]">AI/BI Genie Room Manager</span>

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

const svcTypeIcons: Record<string, typeof Database> = {
  workspace: Server, catalog: Layers, warehouse: Warehouse,
  genie: MessageSquare, database: Database, llm: Cpu,
}

function Home({ user }: { user: CurrentUser | null }) {
  const navigate = useNavigate()
  const [services, setServices] = useState<ServiceStatus[]>([])
  const [loadingSvc, setLoadingSvc] = useState(true)

  useEffect(() => {
    api.getServices()
      .then((r) => setServices(r.services))
      .catch(() => {})
      .finally(() => setLoadingSvc(false))
  }, [])

  const connected = services.filter((s) => s.status === 'connected').length
  const total = services.length

  return (
    <div className="flex gap-8 px-8 py-12">
      {/* Left: Services panel */}
      <div className="w-[240px] shrink-0 space-y-4">
        <div className="flex items-center gap-2 mb-1">
          <Server className="w-4 h-4 text-[var(--text-secondary)]" />
          <h3 className="text-sm font-semibold text-[var(--text-primary)]">Services</h3>
        </div>

        {loadingSvc ? (
          <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)] py-4">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking...
          </div>
        ) : (
          <>
            {/* Summary bar */}
            <div className="flex items-center gap-2 mb-2">
              <div className={`w-2 h-2 rounded-full ${connected === total ? 'bg-emerald-500' : connected > 0 ? 'bg-amber-500' : 'bg-red-500'}`} />
              <span className="text-xs text-[var(--text-secondary)]">
                {connected}/{total} connected
              </span>
              <div className="flex-1 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${connected === total ? 'bg-emerald-500' : 'bg-amber-500'}`}
                  style={{ width: `${total ? (connected / total) * 100 : 0}%` }}
                />
              </div>
            </div>

            {/* Service list */}
            <div className="space-y-1.5">
              {services.map((svc) => {
                const Icon = svcTypeIcons[svc.type] || Server
                return (
                  <div
                    key={svc.name}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border ${
                      svc.status === 'connected'
                        ? 'bg-emerald-500/5 border-emerald-500/15'
                        : svc.status === 'error'
                          ? 'bg-red-500/5 border-red-500/15'
                          : 'bg-amber-500/5 border-amber-500/15'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                    <span className="text-xs text-[var(--text-primary)] font-medium flex-1 truncate">{svc.name}</span>
                    {svc.status === 'connected' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                    ) : svc.status === 'error' ? (
                      <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                    )}
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => navigate('/services')}
              className="w-full text-center text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors pt-1"
            >
              View details &rsaquo;
            </button>
          </>
        )}
      </div>

      {/* Right: Main content */}
      <div className="flex-1 min-w-0">
        {/* Welcome */}
        <div className="mb-8">
          <h2 className="text-3xl font-bold text-[var(--text-primary)] mb-2">
            {user ? `Welcome, ${user.display_name.split(' ')[0]}` : 'Welcome to Genie-Force'}
          </h2>
          <p className="text-[var(--text-secondary)]">
            Systematically create, configure, and manage AI/BI Genie Rooms across your workspace.
          </p>
        </div>

        {/* App description */}
        <div className="mb-8 p-5 rounded-xl bg-gradient-to-br from-[#D0A33C]/5 to-[#3F1F14]/5 border border-[#D0A33C]/15">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-2">What is Genie-Force?</h3>
          <ul className="space-y-1.5 text-sm text-[var(--text-secondary)] leading-relaxed">
            <li><span className="text-[#D0A33C] mr-1.5">&#x2022;</span>Create and edit Genie Rooms with full control over tables, instructions, sample queries, and warehouse selection</li>
            <li><span className="text-[#D0A33C] mr-1.5">&#x2022;</span>Chat with any Genie Room directly, or route questions across multiple rooms via the Supervisor Agent</li>
            <li><span className="text-[#D0A33C] mr-1.5">&#x2022;</span>Semantic Cache powered by Databricks Lakebase stores frequently asked questions per room, so your team's best Q&amp;A are always at hand</li>
            <li><span className="text-[#D0A33C] mr-1.5">&#x2022;</span>Explore your Unity Catalog, validate table descriptions, and run exploratory data analysis before building rooms</li>
          </ul>
        </div>

        {/* Tiles */}
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

        {/* Quick actions */}
        <div className="mt-8 p-5 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border)]">
          <h3 className="text-sm font-semibold text-[var(--text-primary)] mb-3">Quick Actions</h3>
          <div className="flex flex-wrap gap-2">
            <QuickAction label="Browse samples.nyctaxi" onClick={() => navigate('/catalog')} />
            <QuickAction label="Generate sample data" onClick={() => navigate('/sample-data')} />
            <QuickAction label="Create a Genie Room" onClick={() => navigate('/create')} />
          </div>
        </div>
      </div>
    </div>
  )
}

function QuickAction({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button onClick={onClick}
      className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] transition-colors">
      {label}
    </button>
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
