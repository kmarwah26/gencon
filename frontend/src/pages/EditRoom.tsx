import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  Pencil, X, Loader2, Warehouse, Search, Save,
  ChevronRight, ChevronDown, Database, Layers, Table2, Check,
  AlertTriangle, CheckCircle2, Code, Plus, Trash2, Upload,
  FolderOpen, Folder, FileText, ArrowLeft,
} from 'lucide-react'
import { api } from '../api'
import type {
  Warehouse as WarehouseType, Catalog, Schema, Table,
  CatalogSearchResult, GenieRoomDetail, WorkspaceItem,
} from '../api'

interface SampleQuery {
  question: string
  sql: string
}

export default function EditRoom() {
  const { roomId } = useParams<{ roomId: string }>()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [_room, setRoom] = useState<GenieRoomDetail | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Editable fields
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [instructions, setInstructions] = useState('')
  const [sampleQueries, setSampleQueries] = useState<SampleQuery[]>([])
  const [selectedTables, setSelectedTables] = useState<string[]>([])
  const [originalTables, setOriginalTables] = useState<Set<string>>(new Set())
  const [warehouseId, setWarehouseId] = useState('')
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([])

  // Catalog picker
  const [pickerOpen, setPickerOpen] = useState(false)
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [catalogsLoading, setCatalogsLoading] = useState(false)
  const [expandedCatalogs, setExpandedCatalogs] = useState<Set<string>>(new Set())
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [schemas, setSchemas] = useState<Record<string, Schema[]>>({})
  const [tables, setTables] = useState<Record<string, Table[]>>({})
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set())
  const [pickerSearch, setPickerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  // Load room data
  useEffect(() => {
    if (!roomId) return
    setLoading(true)
    Promise.all([
      api.getGenieRoom(roomId),
      api.listWarehouses(),
    ]).then(([roomData, whData]) => {
      setRoom(roomData)
      setTitle(roomData.title)
      const tables = roomData.table_identifiers || []
      setSelectedTables(tables)
      setOriginalTables(new Set(tables))
      setWarehouseId(roomData.warehouse_id || '')
      setWarehouses(whData.warehouses)

      // Use structured fields from API (instructions & sample_queries come from serialized_space)
      setDescription(roomData.description || '')
      setInstructions(roomData.instructions || '')
      setSampleQueries(roomData.sample_queries || [])
    }).catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [roomId])

  // Search
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current)
    const q = pickerSearch.trim()
    if (!q || q.length < 2) { setSearchResults([]); setSearching(false); return }
    setSearching(true)
    searchTimer.current = setTimeout(() => {
      api.searchCatalog(q)
        .then((r) => { setSearchResults(r.results); setSearching(false) })
        .catch(() => { setSearchResults([]); setSearching(false) })
    }, 300)
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current) }
  }, [pickerSearch])

  const openPicker = useCallback(() => {
    setPickerOpen(true)
    if (catalogs.length === 0) {
      setCatalogsLoading(true)
      api.listCatalogs().then((r) => { setCatalogs(r.catalogs); setCatalogsLoading(false) })
        .catch(() => setCatalogsLoading(false))
    }
  }, [catalogs.length])

  const toggleCatalog = async (name: string) => {
    if (expandedCatalogs.has(name)) {
      setExpandedCatalogs((s) => { const n = new Set(s); n.delete(name); return n })
    } else {
      setExpandedCatalogs((s) => new Set(s).add(name))
      if (!schemas[name]) {
        setLoadingNodes((s) => new Set(s).add(name))
        try { const r = await api.listSchemas(name); setSchemas((s) => ({ ...s, [name]: r.schemas })) } catch {}
        setLoadingNodes((s) => { const n = new Set(s); n.delete(name); return n })
      }
    }
  }

  const toggleSchema = async (catalog: string, schema: string) => {
    const key = `${catalog}.${schema}`
    if (expandedSchemas.has(key)) {
      setExpandedSchemas((s) => { const n = new Set(s); n.delete(key); return n })
    } else {
      setExpandedSchemas((s) => new Set(s).add(key))
      if (!tables[key]) {
        setLoadingNodes((s) => new Set(s).add(key))
        try { const r = await api.listTables(catalog, schema); setTables((s) => ({ ...s, [key]: r.tables })) } catch {}
        setLoadingNodes((s) => { const n = new Set(s); n.delete(key); return n })
      }
    }
  }

  const toggleTable = (fullName: string) => {
    setSelectedTables((prev) =>
      prev.includes(fullName) ? prev.filter((t) => t !== fullName) : [...prev, fullName]
    )
  }

  const handleSave = async () => {
    if (!roomId) return
    setSaving(true); setError(''); setSuccess('')
    try {
      const filteredQueries = sampleQueries.filter((sq) => sq.question || sq.sql)
      await api.updateGenieRoom(roomId, {
        title: title.trim(),
        description: description.trim(),
        table_identifiers: selectedTables,
        warehouse_id: warehouseId || undefined,
        instructions: instructions.trim() || undefined,
        sample_queries: filteredQueries.length > 0 ? filteredQueries : undefined,
      })
      navigate('/')
    } catch (e: any) { setError(e.message || 'Failed to update room') }
    finally { setSaving(false) }
  }

  const [visibleCount, setVisibleCount] = useState(50)
  const q = pickerSearch.toLowerCase()
  const filteredCatalogs = q ? catalogs.filter((c) => c.name.toLowerCase().includes(q)) : catalogs
  const visibleCatalogs = filteredCatalogs.slice(0, visibleCount)

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-8 flex flex-col items-center justify-center py-20 text-[var(--text-secondary)]">
        <Loader2 className="w-8 h-8 animate-spin mb-3" />
        <p className="text-sm">Loading room configuration...</p>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto px-8 py-8 pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-amber-500 to-orange-600 flex items-center justify-center">
          <Pencil className="w-5 h-5 text-white" />
        </div>
        <div className="flex-1">
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">Edit Genie Room</h2>
          <p className="text-sm text-[var(--text-secondary)]">Modify tables, instructions, and queries</p>
        </div>
        <button onClick={() => navigate(`/rooms/${roomId}`)}
          className="px-3 py-1.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors">
          Open Chat
        </button>
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-sm flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0" />{error}
          <button onClick={() => setError('')} className="ml-auto"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}
      {success && (
        <div className="mb-6 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 text-sm flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 shrink-0" />{success}
        </div>
      )}

      <div className="space-y-8">
        {/* Room Name */}
        <section>
          <label className="block text-sm font-semibold text-[var(--text-primary)] mb-2">Room Name</label>
          <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C] transition-colors" />
        </section>

        {/* Description */}
        <section>
          <label className="block text-sm font-semibold text-[var(--text-primary)] mb-2">Description</label>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe what this room is for..."
            rows={5}
            className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors resize-none" />
        </section>

        {/* Warehouse */}
        <section>
          <label className="flex items-center gap-2 text-sm font-semibold text-[var(--text-primary)] mb-2">
            <Warehouse className="w-4 h-4 text-[var(--text-secondary)]" /> SQL Warehouse
          </label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
            className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[#D0A33C] transition-colors">
            <option value="">Auto-select</option>
            {warehouses.map((wh) => (<option key={wh.id} value={wh.id}>{wh.name} ({wh.state.replace('STATE_', '')})</option>))}
          </select>
        </section>

        {/* Tables */}
        <section>
          <div className="flex items-center justify-between mb-2">
            <label className="text-sm font-semibold text-[var(--text-primary)]">Tables ({selectedTables.length})</label>
            {!pickerOpen && (
              <button onClick={openPicker} className="flex items-center gap-1 text-xs text-[#D0A33C] hover:text-[#D0A33C] font-medium">
                <Plus className="w-3 h-3" /> Add tables
              </button>
            )}
          </div>

          {/* Current tables */}
          {selectedTables.length > 0 && (
            <div className="space-y-1.5 mb-3">
              {selectedTables.map((table) => {
                const isOriginal = originalTables.has(table)
                return (
                  <div key={table} className={`flex items-center justify-between px-4 py-2.5 rounded-lg border ${isOriginal ? 'bg-[var(--bg-secondary)] border-[var(--border)]' : 'bg-emerald-500/5 border-emerald-500/20'}`}>
                    <div className="flex items-center gap-2 min-w-0">
                      <Table2 className={`w-3.5 h-3.5 shrink-0 ${isOriginal ? 'text-emerald-500' : 'text-emerald-600'}`} />
                      <span className="text-sm font-mono text-[var(--text-primary)] truncate">{table}</span>
                      {!isOriginal && (
                        <span className="shrink-0 text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 font-medium">new</span>
                      )}
                    </div>
                    <button onClick={() => setSelectedTables((prev) => prev.filter((t) => t !== table))}
                      className="text-[var(--text-secondary)] hover:text-red-400 transition-colors shrink-0 ml-2"><X className="w-4 h-4" /></button>
                  </div>
                )
              })}
            </div>
          )}

          {selectedTables.length === 0 && !pickerOpen && (
            <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-600 flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" /> At least one table is required.
            </div>
          )}

          {/* Catalog picker */}
          {pickerOpen && (
            <CatalogPicker pickerSearch={pickerSearch} setPickerSearch={(v: string) => { setPickerSearch(v); setVisibleCount(50) }}
              searching={searching} searchResults={searchResults} catalogsLoading={catalogsLoading}
              visibleCatalogs={visibleCatalogs} filteredCatalogs={filteredCatalogs} visibleCount={visibleCount}
              setVisibleCount={setVisibleCount} expandedCatalogs={expandedCatalogs} expandedSchemas={expandedSchemas}
              schemas={schemas} tables={tables} loadingNodes={loadingNodes} selectedTables={selectedTables}
              toggleCatalog={toggleCatalog} toggleSchema={toggleSchema} toggleTable={toggleTable}
              onClose={() => setPickerOpen(false)} />
          )}
        </section>

        {/* Instructions */}
        <section>
          <label className="block text-sm font-semibold text-[var(--text-primary)] mb-1">General Instructions</label>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Guidance for how Genie should answer questions</p>
          <textarea value={instructions} onChange={(e) => setInstructions(e.target.value)}
            placeholder="e.g., Always filter by active status. Use fiscal year dates..."
            rows={4}
            className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors resize-none text-sm" />
        </section>

        {/* SQL Queries & Functions */}
        <section>
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-[var(--text-primary)]">SQL Queries &amp; Functions</h3>
            <button onClick={() => setSampleQueries([...sampleQueries, { question: '', sql: '' }])}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#D0A33C]/10 text-[#D0A33C] text-xs font-medium hover:bg-[#D0A33C]/20 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Query
            </button>
          </div>
          <p className="text-xs text-[var(--text-secondary)] mb-3">Teach Genie how to answer specific questions. Import from files or write manually.</p>

          {/* Import from files */}
          <div className="mb-4">
            <SqlFileUploader
              onAddToInstructions={(content) => setInstructions((prev) => prev ? `${prev}\n\n${content}` : content)}
              onAddAsQuery={(filename, content) => setSampleQueries((prev) => [...prev, { question: filename.replace(/\.sql$/i, '').replace(/[_-]/g, ' '), sql: content }])}
            />
          </div>

          {sampleQueries.length === 0 && (
            <button onClick={() => setSampleQueries([{ question: '', sql: '' }])}
              className="w-full py-6 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[#D0A33C]/50 text-[var(--text-secondary)] hover:text-[#D0A33C] transition-colors flex flex-col items-center gap-2">
              <Code className="w-5 h-5" />
              <span className="text-sm">Add a SQL query manually</span>
            </button>
          )}

          <div className="space-y-3">
            {sampleQueries.map((sq, idx) => (
              <div key={idx} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
                <div className="px-4 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center justify-between">
                  <span className="text-xs font-medium text-[var(--text-secondary)]">Query {idx + 1}</span>
                  <button onClick={() => setSampleQueries(sampleQueries.filter((_, i) => i !== idx))}
                    className="text-[var(--text-secondary)] hover:text-red-400 transition-colors"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Question</label>
                    <input type="text" value={sq.question}
                      onChange={(e) => { const u = [...sampleQueries]; u[idx] = { ...u[idx], question: e.target.value }; setSampleQueries(u) }}
                      placeholder="e.g., What are the top 10 customers by revenue?"
                      className="w-full px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">SQL</label>
                    <textarea value={sq.sql}
                      onChange={(e) => { const u = [...sampleQueries]; u[idx] = { ...u[idx], sql: e.target.value }; setSampleQueries(u) }}
                      placeholder="SELECT ..."
                      rows={4}
                      className="w-full px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm font-mono resize-none" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Save / Delete */}
        <div className="flex gap-3 pt-4 border-t border-[var(--border)]">
          <button onClick={() => navigate('/edit')}
            className="px-5 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center gap-2">
            <ArrowLeft className="w-4 h-4" /> Back to Rooms
          </button>
          <button onClick={handleSave} disabled={saving || !title.trim() || selectedTables.length === 0}
            className="flex-1 py-3 rounded-lg bg-gradient-to-r from-[#D0A33C] to-[#3F1F14] hover:from-[#b88d2e] hover:to-[#3F1F14] text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Saving...</> : <><Save className="w-4 h-4" /> Save Changes</>}
          </button>
          <button onClick={() => setShowDeleteConfirm(true)} disabled={deleting}
            className="px-5 py-3 rounded-lg border border-red-500/30 text-red-500 hover:bg-red-500/10 font-medium text-sm transition-colors flex items-center gap-2 disabled:opacity-50">
            <Trash2 className="w-4 h-4" /> Delete
          </button>
        </div>

        {/* Delete confirmation modal */}
        {showDeleteConfirm && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
              <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">Delete Genie Room</h3>
              <p className="text-sm text-[var(--text-secondary)] mb-1">
                Are you sure you want to delete <span className="font-semibold text-[var(--text-primary)]">{title}</span>?
              </p>
              <p className="text-xs text-red-400 mb-6">This action cannot be undone. All conversations in this room will be lost.</p>
              <div className="flex gap-3">
                <button onClick={() => setShowDeleteConfirm(false)} disabled={deleting}
                  className="flex-1 py-2.5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors">
                  Cancel
                </button>
                <button
                  onClick={async () => {
                    if (!roomId) return
                    setDeleting(true)
                    try {
                      await api.deleteGenieRoom(roomId)
                      navigate('/')
                    } catch (e: any) {
                      setError(e.message || 'Failed to delete room')
                      setShowDeleteConfirm(false)
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
    </div>
  )
}


// ── Catalog Picker (shared with CreateRoom — simplified copy) ──

function CatalogPicker({ pickerSearch, setPickerSearch, searching, searchResults, catalogsLoading,
  visibleCatalogs, filteredCatalogs, visibleCount, setVisibleCount, expandedCatalogs, expandedSchemas,
  schemas, tables, loadingNodes, selectedTables, toggleCatalog, toggleSchema, toggleTable, onClose }: any) {
  const q = pickerSearch.trim()
  const hasActiveSearch = q.length >= 2
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
      <div className="px-3 py-2.5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <input type="text" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)}
            placeholder="Search tables (e.g. trips or catalog.schema.table)..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm"
            autoFocus />
          {pickerSearch && <button onClick={() => setPickerSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {hasActiveSearch && (
          <>
            {searching && <div className="flex items-center justify-center py-8 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching...</div>}
            {!searching && searchResults.length > 0 && searchResults.map((r: CatalogSearchResult) => {
              if (r.type === 'table') {
                const isSelected = selectedTables.includes(r.full_name)
                return (
                  <button key={r.full_name} onClick={() => toggleTable(r.full_name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                    <div className={`shrink-0 rounded border flex items-center justify-center ${isSelected ? 'bg-[#D0A33C] border-[#D0A33C]' : 'border-[var(--border)]'}`} style={{ width: 18, height: 18 }}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <Table2 className="w-3.5 h-3.5 text-emerald-500" />
                    <div className="flex flex-col min-w-0 flex-1 text-left">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="text-[11px] text-[var(--text-secondary)] truncate">{r.catalog}.{r.schema}</span>
                    </div>
                  </button>
                )
              }
              return (
                <button key={r.full_name} onClick={() => {
                  if (r.type === 'catalog') setPickerSearch(`${r.name}.`)
                  else if (r.type === 'schema' && r.catalog) setPickerSearch(`${r.catalog}.${r.name}.`)
                }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                  {r.type === 'catalog' ? <Database className="w-3.5 h-3.5 text-[#D0A33C]" /> : <Layers className="w-3.5 h-3.5 text-[#325B6D]" />}
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">{r.type} &rsaquo;</span>
                </button>
              )
            })}
            {!searching && searchResults.length === 0 && <p className="text-center py-6 text-sm text-[var(--text-secondary)]">No results</p>}
          </>
        )}
        {!hasActiveSearch && (
          <>
            {catalogsLoading && <div className="flex items-center justify-center py-8 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading catalogs...</div>}
            {visibleCatalogs.map((cat: Catalog) => (
              <div key={cat.name}>
                <button onClick={() => toggleCatalog(cat.name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                  {loadingNodes.has(cat.name) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" /> : expandedCatalogs.has(cat.name) ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                  <Database className="w-3.5 h-3.5 text-[#D0A33C]" /><span className="font-medium">{cat.name}</span>
                </button>
                {expandedCatalogs.has(cat.name) && schemas[cat.name]?.map((sch: Schema) => {
                  const sk = `${cat.name}.${sch.name}`
                  return (
                    <div key={sch.name} className="ml-4">
                      <button onClick={() => toggleSchema(cat.name, sch.name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                        {loadingNodes.has(sk) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" /> : expandedSchemas.has(sk) ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                        <Layers className="w-3.5 h-3.5 text-[#325B6D]" /><span>{sch.name}</span>
                      </button>
                      {expandedSchemas.has(sk) && tables[sk]?.map((tbl: Table) => {
                        const isSel = selectedTables.includes(tbl.full_name)
                        return (
                          <button key={tbl.name} onClick={() => toggleTable(tbl.full_name)} className="w-full ml-4 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                            <div className={`shrink-0 rounded border flex items-center justify-center ${isSel ? 'bg-[#D0A33C] border-[#D0A33C]' : 'border-[var(--border)]'}`} style={{ width: 18, height: 18 }}>
                              {isSel && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <Table2 className="w-3.5 h-3.5 text-emerald-500" /><span className="truncate">{tbl.name}</span>
                          </button>
                        )
                      })}
                    </div>
                  )
                })}
              </div>
            ))}
            {visibleCount < filteredCatalogs.length && (
              <button onClick={() => setVisibleCount((c: number) => c + 50)} className="w-full py-2 text-xs text-[#D0A33C] font-medium">Show more ({filteredCatalogs.length - visibleCount})</button>
            )}
          </>
        )}
      </div>
      <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-tertiary)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">{selectedTables.length} selected</span>
        <button onClick={onClose} className="text-xs font-medium text-[#D0A33C] hover:text-[#D0A33C]">Done</button>
      </div>
    </div>
  )
}


// ── SQL File Uploader ──

function SqlFileUploader({ onAddAsQuery }: {
  onAddToInstructions: (content: string) => void
  onAddAsQuery: (filename: string, content: string) => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [showWorkspaceBrowser, setShowWorkspaceBrowser] = useState(false)
  const [wsPath, setWsPath] = useState('/')
  const [wsItems, setWsItems] = useState<WorkspaceItem[]>([])
  const [wsLoading, setWsLoading] = useState(false)
  const [wsReadingFile, setWsReadingFile] = useState('')
  const [addedFiles, setAddedFiles] = useState<{ name: string; target: 'instructions' | 'query' }[]>([])

  const addFile = (name: string, content: string) => {
    onAddAsQuery(name, content)
    setAddedFiles((prev) => [...prev, { name, target: 'query' }])
  }

  const handleLocalFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files
    if (!fileList) return
    Array.from(fileList).forEach((file) => {
      const reader = new FileReader()
      reader.onload = () => {
        const content = (reader.result as string).trim()
        if (content) addFile(file.name, content)
      }
      reader.readAsText(file)
    })
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const browseWorkspace = async (path: string) => {
    setWsLoading(true); setWsPath(path)
    try { const r = await api.listWorkspacePath(path); setWsItems(r.items) } catch { setWsItems([]) }
    setWsLoading(false)
  }

  const [importError, setImportError] = useState('')

  const importWorkspaceFile = async (item: WorkspaceItem) => {
    if (addedFiles.some((f) => f.name === item.name)) return
    setWsReadingFile(item.path)
    setImportError('')
    try {
      const r = await api.readWorkspaceFile(item.path)
      if (r.content.trim()) {
        addFile(item.name, r.content.trim())
      } else {
        setImportError(`File "${item.name}" is empty`)
      }
    } catch (e: any) {
      setImportError(`Failed to import "${item.name}": ${e.message || 'Unknown error'}`)
    }
    setWsReadingFile('')
  }

  const parentPath = wsPath === '/' ? null : wsPath.replace(/\/[^/]+$/, '') || '/'
  const addedNames = new Set(addedFiles.map((f) => f.name))

  return (
    <div className="space-y-3">
      <input ref={fileInputRef} type="file" accept=".sql,.txt" multiple onChange={handleLocalFiles} className="hidden" />

      {/* Source buttons */}
      <div className="flex gap-2">
        <button onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[#D0A33C] hover:border-[#D0A33C]/30 transition-colors">
          <Upload className="w-3.5 h-3.5" /> Upload from computer
        </button>
        <button onClick={() => { setShowWorkspaceBrowser(true); browseWorkspace(wsPath === '/' ? '/' : wsPath) }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[#325B6D] hover:border-[#325B6D]/30 transition-colors">
          <FolderOpen className="w-3.5 h-3.5" /> Browse workspace
        </button>
      </div>

      {/* Workspace browser */}
      {showWorkspaceBrowser && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="px-3 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-[#325B6D]" />
            <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 truncate">{wsPath}</span>
            <button onClick={() => setShowWorkspaceBrowser(false)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
            {wsLoading ? <div className="flex items-center justify-center py-6 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...</div> : (
              <>
                {parentPath !== null && (
                  <button onClick={() => browseWorkspace(parentPath)} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors text-[var(--text-secondary)]">
                    <ArrowLeft className="w-3.5 h-3.5" /> ..
                  </button>
                )}
                {wsItems.map((item) => {
                  const isDir = item.type === 'DIRECTORY'
                  const alreadyAdded = addedNames.has(item.name)
                  return (
                    <button key={item.path}
                      onClick={() => isDir ? browseWorkspace(item.path) : !alreadyAdded && importWorkspaceFile(item)}
                      disabled={(!isDir && alreadyAdded) || wsReadingFile === item.path}
                      className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ${alreadyAdded && !isDir ? 'bg-emerald-500/5' : 'hover:bg-[var(--bg-hover)]'} disabled:opacity-60`}>
                      {isDir ? <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <FileText className={`w-3.5 h-3.5 shrink-0 ${alreadyAdded ? 'text-emerald-500' : item.is_sql ? 'text-[#D0A33C]' : 'text-[var(--text-secondary)]'}`} />}
                      <span className={`flex-1 text-left truncate ${alreadyAdded ? 'text-emerald-600' : item.is_sql ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{item.name}</span>
                      {wsReadingFile === item.path && <Loader2 className="w-3 h-3 animate-spin text-[#D0A33C]" />}
                      {!isDir && alreadyAdded && <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium"><CheckCircle2 className="w-3 h-3" /> Added as query</span>}
                      {!isDir && item.is_sql && !alreadyAdded && wsReadingFile !== item.path && <span className="text-[10px] text-[#D0A33C] font-medium">Import</span>}
                      {isDir && <ChevronRight className="w-3 h-3 text-[var(--text-secondary)]" />}
                    </button>
                  )
                })}
                {wsItems.length === 0 && <p className="text-center py-4 text-xs text-[var(--text-secondary)]">Empty directory</p>}
              </>
            )}
          </div>
          {importError && (
            <div className="px-3 py-2 border-t border-red-500/20 bg-red-500/5 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 shrink-0" />{importError}
              <button onClick={() => setImportError('')} className="ml-auto"><X className="w-3 h-3" /></button>
            </div>
          )}
        </div>
      )}

      {/* Added files summary */}
      {addedFiles.length > 0 && (
        <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-3">
          <p className="text-xs font-semibold text-emerald-600 mb-2">
            <CheckCircle2 className="w-3.5 h-3.5 inline mr-1" />{addedFiles.length} file{addedFiles.length > 1 ? 's' : ''} added as sample queries
          </p>
          <div className="space-y-1">
            {addedFiles.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-emerald-700">
                <FileText className="w-3 h-3" />
                <span className="truncate">{f.name}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
