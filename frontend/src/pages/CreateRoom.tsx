import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Plus, Minus, X, Loader2, Sparkles, Warehouse, Search,
  ChevronRight, ChevronDown, Database, Layers, Table2, Check,
  AlertTriangle, CheckCircle2, FileText, BarChart3, ArrowRight, ArrowLeft,
  Pencil, Save, Code, Trash2, Wand2, Clock, Hash, MessageSquarePlus, SkipForward,
  Upload, FolderOpen, Folder, Lock, Users as UsersIcon, Play,
} from 'lucide-react'
import { api } from '../api'
import type {
  Warehouse as WarehouseType, Catalog, Schema, Table,
  CatalogSearchResult, DescriptionValidation,
  SummaryStatsResult, TimeRangesResult, WorkspaceItem,
  AvailableColumn, Principal,
} from '../api'
import { useAppStore } from '../store'
import { PrincipalPicker } from './EditRoom'

const STEPS = [
  { num: 1, label: 'Setup', icon: Database },
  { num: 2, label: 'Descriptions', icon: FileText },
  { num: 3, label: 'Analysis', icon: BarChart3, optional: true },
  { num: 4, label: 'SQL Instructions', icon: Code },
  { num: 5, label: 'Create', icon: Sparkles },
]

interface SampleQuery {
  question: string
  sql: string
}

export default function CreateRoom() {
  const { selectedTables, toggleTable, removeTable, clearTables, addTables, removeTables } = useAppStore()
  const [step, setStep] = useState(1)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [warehouses, setWarehouses] = useState<WarehouseType[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [warehouseError, setWarehouseError] = useState('')
  const [startingWarehouse, setStartingWarehouse] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  // Step 2
  const [descValidation, setDescValidation] = useState<DescriptionValidation | null>(null)
  const [validating, setValidating] = useState(false)
  const [generatingDesc, setGeneratingDesc] = useState(false)
  // Bulk metadata generation across all selected tables
  const [bulkGen, setBulkGen] = useState<Record<string, { table_description: string; columns: Record<string, string> }>>({})
  const [bulkGenLoading, setBulkGenLoading] = useState(false)
  const [bulkGenProgress, setBulkGenProgress] = useState('')
  const [bulkSaveLoading, setBulkSaveLoading] = useState(false)
  const [bulkSaveProgress, setBulkSaveProgress] = useState('')
  const [bulkError, setBulkError] = useState('')

  // Step 3 — optional analysis
  const [statsResult, setStatsResult] = useState<SummaryStatsResult | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [timeResult, setTimeResult] = useState<TimeRangesResult | null>(null)
  const [timeLoading, setTimeLoading] = useState(false)
  const [datasetDesc, setDatasetDesc] = useState('')
  const [datasetDescLoading, setDatasetDescLoading] = useState(false)

  // Step 4 - SQL Instructions
  const [sampleQueries, setSampleQueries] = useState<SampleQuery[]>([])
  const [instructions, setInstructions] = useState('')

  // Step 5 - Filter config (saved to new room after creation)
  const [filterColumns, setFilterColumns] = useState<{ column_name: string; label?: string }[]>([])
  const [filterUsers, setFilterUsers] = useState<{
    user_email: string
    principal_type: 'user' | 'group'
    display_name: string
    values: Record<string, string[]>
  }[]>([])
  const [newFilterCol, setNewFilterCol] = useState('')
  const [newFilterColLabel, setNewFilterColLabel] = useState('')
  const [availableFilterCols, setAvailableFilterCols] = useState<AvailableColumn[]>([])
  const [availableColsLoading, setAvailableColsLoading] = useState(false)

  // Picker state
  const [pickerOpen, setPickerOpen] = useState(false)
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [catalogsLoading, setCatalogsLoading] = useState(false)
  const [expandedCatalogs, setExpandedCatalogs] = useState<Set<string>>(new Set())
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [schemas, setSchemas] = useState<Record<string, Schema[]>>({})
  const [tables, setTables] = useState<Record<string, Table[]>>({})
  const [nodeErrors, setNodeErrors] = useState<Record<string, string>>({})
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set())
  const [pickerSearch, setPickerSearch] = useState('')
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

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

  const loadWarehouses = useCallback(async (autoSelectRunning = false) => {
    try {
      const r = await api.listWarehouses()
      setWarehouses(r.warehouses)
      setWarehouseError('')
      if (autoSelectRunning) {
        const running = r.warehouses.find((w) => w.state.includes('RUNNING'))
        if (running) setWarehouseId(running.id)
      }
      return r.warehouses
    } catch (e: any) {
      setWarehouseError(e.message || 'Failed to load SQL warehouses')
      return []
    }
  }, [])

  useEffect(() => { loadWarehouses(true) }, [loadWarehouses])

  // Start the selected warehouse and poll until it reports RUNNING, so the dropdown
  // label reflects the new state without the user leaving the page.
  const startSelectedWarehouse = async () => {
    if (!warehouseId || startingWarehouse) return
    setStartingWarehouse(true)
    setWarehouseError('')
    try {
      await api.startWarehouse(warehouseId)
      for (let i = 0; i < 40; i++) {
        await new Promise((res) => setTimeout(res, 3000))
        const list = await loadWarehouses()
        const wh = list.find((w) => w.id === warehouseId)
        if (wh && wh.state.includes('RUNNING')) break
        if (wh && wh.state.includes('STOPPED')) { setWarehouseError('Warehouse stopped before it finished starting.'); break }
      }
    } catch (e: any) {
      setWarehouseError(e.message || 'Failed to start warehouse')
    } finally {
      setStartingWarehouse(false)
    }
  }

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
        try {
          const r = await api.listSchemas(name)
          setSchemas((s) => ({ ...s, [name]: r.schemas }))
          setNodeErrors((e) => { const n = { ...e }; delete n[name]; return n })
        } catch (err: any) {
          setNodeErrors((e) => ({ ...e, [name]: err.message || 'Failed to load schemas' }))
        }
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
        try {
          const r = await api.listTables(catalog, schema)
          setTables((s) => ({ ...s, [key]: r.tables }))
          setNodeErrors((e) => { const n = { ...e }; delete n[key]; return n })
        } catch (err: any) {
          setNodeErrors((e) => ({ ...e, [key]: err.message || 'Failed to load tables' }))
        }
        setLoadingNodes((s) => { const n = new Set(s); n.delete(key); return n })
      }
    }
  }

  const selectAllInSchema = async (catalog: string, schema: string) => {
    const key = `${catalog}.${schema}`
    let schemaTables = tables[key]
    if (!schemaTables) {
      setLoadingNodes((s) => new Set(s).add(key))
      try {
        const r = await api.listTables(catalog, schema)
        schemaTables = r.tables
        setTables((s) => ({ ...s, [key]: r.tables }))
      } catch {
        setLoadingNodes((s) => { const n = new Set(s); n.delete(key); return n })
        return
      }
      setLoadingNodes((s) => { const n = new Set(s); n.delete(key); return n })
    }
    const names = schemaTables.map((t) => t.full_name)
    if (names.length === 0) return
    const selectedSet = new Set(selectedTables)
    const allSelected = names.every((n) => selectedSet.has(n))
    if (allSelected) removeTables(names)
    else addTables(names)
  }

  const canProceedStep1 = title.trim().length > 0 && selectedTables.length > 0

  const goToStep = async (target: number) => {
    setError('')
    if (target === 2 && step === 1) {
      if (!canProceedStep1) { setError('Please enter a room name and select at least one table'); return }
      setStep(2)
      if (!descValidation) {
        setValidating(true)
        try { const r = await api.validateDescriptions(selectedTables); setDescValidation(r) } catch (e: any) { setError(e.message) }
        setValidating(false)
      }
    } else if (target === 3 && step === 2) {
      setStep(3)
      // Don't auto-run analysis — step 3 is optional and on-demand
    } else if (target === 4 && (step === 2 || step === 3)) {
      // Allow skipping analysis (step 3) from step 2
      setStep(4)
    } else if (target === 5 && step === 4) {
      setStep(5)
      // Kick off column lookup for the filter picker
      if (selectedTables.length > 0) {
        setAvailableColsLoading(true)
        api.columnsFromTables(selectedTables)
          .then((r) => setAvailableFilterCols(r.columns))
          .catch(() => {})
          .finally(() => setAvailableColsLoading(false))
      }
    } else if (target < step) {
      setStep(target)
    }
  }

  const handleCreate = async () => {
    setCreating(true); setError('')
    try {
      // Filter out empty sample queries before sending
      const validQueries = sampleQueries.filter(sq => sq.question.trim() || sq.sql.trim())
      const result = await api.createGenieRoom({
        title: title.trim(),
        description: description.trim(),
        table_identifiers: selectedTables,
        warehouse_id: warehouseId || undefined,
        sample_queries: validQueries.length > 0 ? validQueries : undefined,
        instructions: instructions.trim() || undefined,
      })
      const roomId = result.space_id || result.id

      // Persist row-level filter config if any was set up
      if (roomId && filterColumns.length > 0) {
        try {
          for (const col of filterColumns) {
            await api.addFilterColumn(roomId, col)
          }
          for (const u of filterUsers) {
            for (const col of filterColumns) {
              await api.setUserFilter(roomId, u.user_email, {
                column_name: col.column_name,
                allowed_values: u.values[col.column_name] || [],
                principal_type: u.principal_type,
                display_name: u.display_name,
              })
            }
          }
        } catch (filterErr: any) {
          // Don't fail room creation if filter setup fails — surface as warning
          console.error('Filter setup failed:', filterErr)
          setError(`Room created, but filter setup failed: ${filterErr.message || 'unknown error'}. You can configure filters in Edit Room.`)
        }
      }

      clearTables()
      navigate(roomId ? `/rooms/${roomId}` : '/rooms')
    } catch (e: any) { setError(e.message || 'Failed to create room') }
    finally { setCreating(false) }
  }

  // Refresh description validation after edits
  const refreshValidation = async () => {
    setValidating(true)
    try { const r = await api.validateDescriptions(selectedTables); setDescValidation(r) } catch {}
    setValidating(false)
  }

  const generateAllMetadata = async () => {
    if (!descValidation) return
    setBulkGenLoading(true); setBulkError('')
    const tables = descValidation.tables.filter((t) => !t.error)
    const results: typeof bulkGen = { ...bulkGen }
    let failures = 0
    for (let i = 0; i < tables.length; i++) {
      const t = tables[i]
      const label = t.table_name || t.full_name.split('.').pop() || t.full_name
      setBulkGenProgress(`${i + 1}/${tables.length}: ${label}`)
      try {
        const r = await api.generateDescriptions({
          full_name: t.full_name,
          table_name: t.table_name || t.full_name.split('.').pop() || '',
          columns: (t.columns || []).map((c) => ({ name: c.name, type: c.type, comment: c.comment })),
          existing_comment: t.table_comment || '',
        })
        results[t.full_name] = { table_description: r.table_description || '', columns: r.columns || {} }
        setBulkGen({ ...results })
      } catch (e: any) {
        failures++
        console.warn(`[bulk-gen] ${t.full_name}:`, e?.message || e)
      }
    }
    setBulkGenProgress('')
    setBulkGenLoading(false)
    if (failures > 0) setBulkError(`${failures} of ${tables.length} tables failed to generate — see console for details.`)
  }

  const saveAllBulkToUC = async () => {
    if (!warehouseId) { setBulkError('Select a warehouse in Step 1 first'); return }
    setBulkSaveLoading(true); setBulkError('')
    const entries = Object.entries(bulkGen)
    let totalOps = 0
    for (const [, gen] of entries) {
      if (gen.table_description) totalOps++
      totalOps += Object.values(gen.columns).filter(Boolean).length
    }
    let saved = 0
    try {
      for (const [fullName, gen] of entries) {
        if (gen.table_description) {
          setBulkSaveProgress(`Saving ${saved + 1}/${totalOps}: ${fullName} (table)`)
          await api.updateTableDescription(fullName, gen.table_description, warehouseId)
          saved++
        }
        for (const [col, desc] of Object.entries(gen.columns)) {
          if (!desc) continue
          setBulkSaveProgress(`Saving ${saved + 1}/${totalOps}: ${fullName}.${col}`)
          await api.updateColumnDescription(fullName, col, desc, warehouseId)
          saved++
        }
      }
      setBulkGen({})
      setBulkSaveProgress('')
      await refreshValidation()
    } catch (e: any) {
      setBulkError(`Saved ${saved}/${totalOps} — ${e.message || 'some updates failed'}`)
    }
    setBulkSaveLoading(false)
  }

  const discardAllBulk = () => {
    setBulkGen({})
    setBulkError('')
  }

  const bulkCount = Object.keys(bulkGen).length

  const [visibleCount, setVisibleCount] = useState(50)
  const q = pickerSearch.toLowerCase()
  const filteredCatalogs = q ? catalogs.filter((c) => c.name.toLowerCase().includes(q)) : catalogs
  const visibleCatalogs = filteredCatalogs.slice(0, visibleCount)

  return (
    <div className="max-w-3xl mx-auto p-8 pb-16">
      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-[#6366F1] to-[#4338CA] flex items-center justify-center">
          <Plus className="w-5 h-5 text-white" />
        </div>
        <div>
          <h2 className="text-2xl font-bold text-[var(--text-primary)]">Create Genie Space</h2>
          <p className="text-sm text-[var(--text-secondary)]">Set up a new AI-powered data room</p>
        </div>
      </div>

      {/* Stepper */}
      <div className="flex items-center mb-8">
        {STEPS.map((s, i) => (
          <div key={s.num} className="flex items-center flex-1">
            <button
              onClick={() => { if (s.num < step) goToStep(s.num) }}
              className={`flex items-center gap-1.5 ${s.num <= step ? 'cursor-pointer' : 'cursor-default'}`}
            >
              <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold transition-all ${
                s.num === step ? 'bg-[#6366F1] text-white' : s.num < step ? 'bg-emerald-500 text-white' : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)]'
              }`}>
                {s.num < step ? <Check className="w-3.5 h-3.5" /> : s.num}
              </div>
              <span className={`text-xs font-medium hidden md:inline ${s.num === step ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
                {s.label}{(s as any).optional ? <span className="text-[9px] ml-0.5 opacity-60">*</span> : ''}
              </span>
            </button>
            {i < STEPS.length - 1 && (
              <div className={`flex-1 h-px mx-2 ${s.num < step ? 'bg-emerald-500' : 'bg-[var(--border)]'}`} />
            )}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-6 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">{error}</div>
      )}

      {/* ─── Step 1: Setup ─── */}
      {step === 1 && (
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium mb-2">Room Name</label>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g., Sales Analytics"
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] transition-colors" />
          </div>
          <div>
            <label className="flex items-center gap-2 text-sm font-medium mb-2"><Warehouse className="w-4 h-4 text-[var(--text-secondary)]" /> SQL Warehouse</label>
            {(() => {
              const selectedWh = warehouses.find((w) => w.id === warehouseId)
              const isStopped = !!selectedWh && selectedWh.state.includes('STOPPED')
              const isRunning = !!selectedWh && selectedWh.state.includes('RUNNING')
              return (
                <>
                  <div className="flex items-center gap-2">
                    <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                      className="flex-1 px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] focus:outline-none focus:border-[#6366F1] transition-colors">
                      <option value="">{warehouses.length === 0 ? 'Loading warehouses...' : 'Select a warehouse'}</option>
                      {warehouses.map((wh) => (<option key={wh.id} value={wh.id}>{wh.name} ({wh.state.replace('STATE_', '').replace('State.', '')})</option>))}
                    </select>
                    {isStopped && (
                      <button
                        onClick={startSelectedWarehouse}
                        disabled={startingWarehouse}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-2.5 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white text-sm font-medium transition-colors disabled:opacity-60"
                        title="Start this SQL warehouse"
                      >
                        {startingWarehouse ? <><Loader2 className="w-4 h-4 animate-spin" /> Starting…</> : <><Play className="w-4 h-4" /> Start</>}
                      </button>
                    )}
                  </div>
                  {isRunning && (
                    <p className="text-xs text-emerald-600 mt-1">Warehouse is running.</p>
                  )}
                  {isStopped && !startingWarehouse && !warehouseError && (
                    <p className="text-xs text-amber-600 mt-1">This warehouse is stopped — start it to run queries and create the Genie Space.</p>
                  )}
                  {startingWarehouse && (
                    <p className="text-xs text-[var(--text-secondary)] mt-1">Starting the warehouse — this can take a minute or two.</p>
                  )}
                </>
              )
            })()}
            {warehouseError ? (
              <p className="text-xs text-red-500 mt-1">{warehouseError}</p>
            ) : warehouses.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">No SQL warehouses found. Ensure your workspace has at least one SQL warehouse.</p>
            )}
          </div>
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium">Tables ({selectedTables.length})</label>
              {selectedTables.length > 0 && <button onClick={openPicker} className="text-xs text-[#6366F1] hover:text-[#6366F1] font-medium">+ Add more</button>}
            </div>
            {selectedTables.length > 0 && (
              <div className="space-y-2 mb-3">
                {selectedTables.map((table) => (
                  <div key={table} className="flex items-center justify-between px-4 py-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                    <span className="text-sm font-mono text-[#6366F1]">{table}</span>
                    <button onClick={() => removeTable(table)} className="text-[var(--text-secondary)] hover:text-red-400 transition-colors"><X className="w-4 h-4" /></button>
                  </div>
                ))}
              </div>
            )}
            {!pickerOpen ? (
              <button onClick={openPicker} className="w-full py-6 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[#6366F1]/50 text-[var(--text-secondary)] hover:text-[#6366F1] transition-colors flex flex-col items-center gap-2">
                <Database className="w-5 h-5" /><span className="text-sm">Browse Catalog to select tables</span>
              </button>
            ) : (
              <CatalogPicker pickerSearch={pickerSearch} setPickerSearch={(v: string) => { setPickerSearch(v); setVisibleCount(50) }}
                searching={searching} searchResults={searchResults} catalogsLoading={catalogsLoading}
                visibleCatalogs={visibleCatalogs} filteredCatalogs={filteredCatalogs} visibleCount={visibleCount}
                setVisibleCount={setVisibleCount} expandedCatalogs={expandedCatalogs} expandedSchemas={expandedSchemas}
                schemas={schemas} tables={tables} nodeErrors={nodeErrors} loadingNodes={loadingNodes} selectedTables={selectedTables}
                toggleCatalog={toggleCatalog} toggleSchema={toggleSchema} toggleTable={toggleTable} selectAllInSchema={selectAllInSchema}
                onClose={() => setPickerOpen(false)} />
            )}
          </div>
          <button onClick={() => goToStep(2)} disabled={!canProceedStep1}
            className="w-full py-3 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2">
            Next: Verify Descriptions <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ─── Step 2: Description Validation + Editing ─── */}
      {step === 2 && (
        <div className="space-y-6">
          {/* Room Description */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-[var(--text-primary)]">Room Description</label>
              <button
                onClick={async () => {
                  setGeneratingDesc(true)
                  try {
                    const r = await api.datasetDescription(selectedTables, warehouseId || undefined)
                    setDescription(r.description)
                  } catch (e: any) { setError(e.message || 'Failed to generate description') }
                  setGeneratingDesc(false)
                }}
                disabled={generatingDesc}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#3B82F6]/10 text-[#3B82F6] text-xs font-medium hover:bg-[#3B82F6]/20 transition-colors disabled:opacity-50"
              >
                {generatingDesc ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating...</> : <><Wand2 className="w-3.5 h-3.5" /> Generate with AI</>}
              </button>
            </div>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what this room is for, or click 'Generate with AI' to auto-generate based on selected tables..."
              rows={5}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] transition-colors resize-none text-sm" />
          </div>

          {/* Table/Column Description Coverage */}
          {validating ? (
            <div className="flex flex-col items-center justify-center py-16 text-[var(--text-secondary)]">
              <Loader2 className="w-8 h-8 animate-spin mb-3" /><p className="text-sm">Checking table and column descriptions...</p>
            </div>
          ) : descValidation ? (
            <>
              <div className={`p-4 rounded-lg border ${
                descValidation.summary.description_coverage >= 80 ? 'bg-emerald-500/5 border-emerald-500/20'
                  : descValidation.summary.description_coverage >= 50 ? 'bg-amber-500/5 border-amber-500/20'
                    : 'bg-red-500/5 border-red-500/20'
              }`}>
                <div className="flex items-center gap-3 mb-3">
                  {descValidation.summary.description_coverage >= 80
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                    : <AlertTriangle className="w-5 h-5 text-amber-500" />}
                  <span className="text-sm font-semibold text-[var(--text-primary)]">Description Coverage: {descValidation.summary.description_coverage}%</span>
                  <button onClick={refreshValidation} disabled={validating}
                    className="ml-auto text-xs text-[#6366F1] hover:text-[#6366F1] font-medium flex items-center gap-1">
                    <Loader2 className={`w-3 h-3 ${validating ? 'animate-spin' : 'hidden'}`} /> Refresh
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div><span className="text-[var(--text-secondary)]">Tables: </span><span className="font-medium">{descValidation.summary.tables_with_description}/{descValidation.summary.total_tables}</span></div>
                  <div><span className="text-[var(--text-secondary)]">Columns: </span><span className="font-medium">{descValidation.summary.columns_with_description}/{descValidation.summary.total_columns}</span></div>
                </div>
              </div>

              {!warehouseId && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-600 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  Select a SQL Warehouse in Step 1 to enable editing and saving descriptions.
                </div>
              )}

              {/* Bulk AI generation */}
              <div className="rounded-lg border border-[#3B82F6]/30 bg-[#3B82F6]/5 p-4">
                <div className="flex items-start gap-3 mb-3">
                  <Wand2 className="w-5 h-5 text-[#3B82F6] shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[var(--text-primary)]">Generate metadata for all tables</p>
                    <p className="text-xs text-[var(--text-secondary)] mt-0.5">
                      AI drafts table + column descriptions for every selected table in one click. Review per-card or save everything to Unity Catalog at once.
                    </p>
                  </div>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <button
                    onClick={generateAllMetadata}
                    disabled={bulkGenLoading || bulkSaveLoading || descValidation.tables.length === 0}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[#3B82F6] hover:bg-[#1E40AF] text-white text-xs font-semibold transition-colors disabled:opacity-50"
                  >
                    {bulkGenLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Generating…</> : <><Wand2 className="w-3.5 h-3.5" /> Generate all ({descValidation.tables.length})</>}
                  </button>
                  {bulkCount > 0 && (
                    <>
                      <button
                        onClick={saveAllBulkToUC}
                        disabled={bulkSaveLoading || bulkGenLoading || !warehouseId}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors disabled:opacity-50"
                        title={!warehouseId ? 'Select a warehouse in Step 1 first' : `Save ${bulkCount} table drafts to Unity Catalog`}
                      >
                        {bulkSaveLoading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</> : <><Save className="w-3.5 h-3.5" /> Save all to UC ({bulkCount})</>}
                      </button>
                      <button
                        onClick={discardAllBulk}
                        disabled={bulkSaveLoading || bulkGenLoading}
                        className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] text-xs font-medium transition-colors disabled:opacity-50"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Discard drafts
                      </button>
                    </>
                  )}
                </div>
                {(bulkGenProgress || bulkSaveProgress) && (
                  <p className="text-[11px] text-[#3B82F6] mt-2 font-mono">
                    {bulkGenProgress || bulkSaveProgress}
                  </p>
                )}
                {bulkError && (
                  <p className="text-[11px] text-red-500 mt-2">{bulkError}</p>
                )}
                {bulkCount > 0 && !bulkGenLoading && !bulkSaveLoading && (
                  <p className="text-[11px] text-[var(--text-secondary)] mt-2">
                    {bulkCount} table draft{bulkCount > 1 ? 's' : ''} ready — expand any card below to review, or click "Save all to UC" to apply them.
                  </p>
                )}
              </div>

              <div className="space-y-3">
                {descValidation.tables.map((t) => (
                  <TableDescriptionCard
                    key={t.full_name}
                    table={t}
                    warehouseId={warehouseId}
                    onSaved={refreshValidation}
                    presetGenerated={bulkGen[t.full_name]}
                  />
                ))}
              </div>

              {descValidation.summary.description_coverage < 80 && (
                <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 text-sm text-amber-600">
                  <AlertTriangle className="w-4 h-4 inline mr-1.5" />
                  Low coverage may reduce Genie's accuracy. Add descriptions above or continue anyway.
                </div>
              )}
            </>
          ) : null}

          <div className="flex gap-3">
            <button onClick={() => goToStep(1)}
              className="py-3 px-5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={() => goToStep(4)} disabled={validating}
              className="py-3 px-5 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] font-medium text-sm transition-colors flex items-center justify-center gap-1.5 disabled:opacity-40">
              <SkipForward className="w-3.5 h-3.5" /> Skip to Instructions
            </button>
            <button onClick={() => goToStep(3)} disabled={validating}
              className="flex-1 py-3 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2">
              Next: Analysis <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 3: Analysis (Optional) ─── */}
      {step === 3 && (
        <div className="space-y-6">
          <div className="p-4 rounded-lg bg-[#6366F1]/5 border border-[#6366F1]/15">
            <div className="flex items-center gap-2 mb-1">
              <BarChart3 className="w-4 h-4 text-[#6366F1]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Data Analysis</span>
              <span className="text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-[var(--bg-tertiary)] text-[var(--text-secondary)]">Optional</span>
            </div>
            <p className="text-xs text-[var(--text-secondary)]">
              Run optional analyses to understand your data before creating the room. You can skip this step entirely.
            </p>
          </div>

          {/* Analysis action cards */}
          <div className="grid grid-cols-1 gap-3">
            {/* Summary Stats */}
            <AnalysisCard
              icon={Hash} title="Summary Stats" description="Row counts, column counts, and data type distribution for each table"
              loading={statsLoading} done={!!statsResult}
              onRun={async () => {
                setStatsLoading(true)
                try { const r = await api.summaryStats(selectedTables, warehouseId || undefined); setStatsResult(r) } catch (e: any) { setError(e.message) }
                setStatsLoading(false)
              }}
            >
              {statsResult && (
                <div className="space-y-3">
                  {statsResult.tables.map((t) => (
                    <div key={t.full_name} className="p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border)]">
                      <div className="flex items-center gap-2 mb-2">
                        <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-sm font-medium text-[var(--text-primary)] truncate">{t.name}</span>
                        <span className="text-[10px] text-[var(--text-secondary)] font-mono">{t.full_name}</span>
                      </div>
                      {'error' in t && t.error ? (
                        <p className="text-xs text-red-500">{t.error}</p>
                      ) : (
                        <div className="grid grid-cols-3 gap-3">
                          <div>
                            <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Rows</p>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{t.row_count !== null ? t.row_count.toLocaleString() : '—'}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Columns</p>
                            <p className="text-sm font-semibold text-[var(--text-primary)]">{t.column_count}</p>
                          </div>
                          <div>
                            <p className="text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">Types</p>
                            <div className="flex flex-wrap gap-1 mt-0.5">
                              {Object.entries(t.column_types || {}).map(([type, count]) => (
                                <span key={type} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-secondary)] font-mono">
                                  {type} ({count})
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AnalysisCard>

            {/* Time Ranges */}
            <AnalysisCard
              icon={Clock} title="Time Ranges" description="Detect date/timestamp columns and find min/max date ranges"
              loading={timeLoading} done={!!timeResult}
              disabled={!warehouseId}
              disabledReason="Select a SQL Warehouse in Step 1"
              onRun={async () => {
                setTimeLoading(true)
                try { const r = await api.timeRanges(selectedTables, warehouseId); setTimeResult(r) } catch (e: any) { setError(e.message) }
                setTimeLoading(false)
              }}
            >
              {timeResult && (
                <div className="space-y-3">
                  {timeResult.tables.map((t) => (
                    <div key={t.full_name} className="p-3 rounded-md bg-[var(--bg-primary)] border border-[var(--border)]">
                      <div className="flex items-center gap-2 mb-2">
                        <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                        <span className="text-sm font-medium text-[var(--text-primary)]">{t.name}</span>
                      </div>
                      {t.error ? (
                        <p className="text-xs text-red-500">{t.error}</p>
                      ) : t.time_columns.length === 0 ? (
                        <p className="text-xs text-[var(--text-secondary)] italic">No date/timestamp columns found</p>
                      ) : (
                        <div className="space-y-1.5">
                          {t.time_columns.map((tc) => (
                            <div key={tc.column} className="flex items-center gap-3 text-xs">
                              <span className="font-mono text-[var(--text-primary)] min-w-[120px]">{tc.column}</span>
                              <span className="text-[var(--text-secondary)]">({tc.type})</span>
                              {tc.error ? (
                                <span className="text-red-500">{tc.error}</span>
                              ) : (
                                <span className="text-[var(--text-primary)] font-medium">
                                  {tc.min || '?'} → {tc.max || '?'}
                                </span>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </AnalysisCard>

            {/* Dataset Description */}
            <AnalysisCard
              icon={MessageSquarePlus} title="Dataset Description" description="AI-generated description of your dataset — add it to Genie Space instructions"
              loading={datasetDescLoading} done={!!datasetDesc}
              onRun={async () => {
                setDatasetDescLoading(true)
                try {
                  const r = await api.datasetDescription(selectedTables, warehouseId || undefined)
                  setDatasetDesc(r.description)
                } catch (e: any) { setError(e.message) }
                setDatasetDescLoading(false)
              }}
            >
              {datasetDesc && (
                <div className="space-y-3">
                  <textarea
                    value={datasetDesc}
                    onChange={(e) => setDatasetDesc(e.target.value)}
                    rows={Math.max(4, Math.ceil(datasetDesc.length / 80))}
                    className="w-full px-3 py-2 rounded-md bg-[var(--bg-primary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#6366F1] resize-none"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        setInstructions((prev) => prev ? `${prev}\n\n${datasetDesc}` : datasetDesc)
                      }}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-[#6366F1] text-white text-xs font-medium hover:bg-[#4F46E5] transition-colors"
                    >
                      <MessageSquarePlus className="w-3 h-3" /> Add to Instructions
                    </button>
                    {instructions.includes(datasetDesc) && (
                      <span className="text-xs text-emerald-600 flex items-center gap-1"><Check className="w-3 h-3" /> Added</span>
                    )}
                  </div>
                </div>
              )}
            </AnalysisCard>
          </div>

          <div className="flex gap-3">
            <button onClick={() => goToStep(2)}
              className="flex-1 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={() => goToStep(4)}
              className="flex-1 py-3 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-sm transition-all flex items-center justify-center gap-2">
              Next: SQL Instructions <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ─── Step 4: SQL Instructions ─── */}
      {step === 4 && (
        <div className="space-y-6">
          <div>
            <h3 className="text-base font-semibold text-[var(--text-primary)] mb-1">General Instructions</h3>
            <p className="text-xs text-[var(--text-secondary)] mb-3">Provide guidance for how Genie should answer questions (optional)</p>
            <textarea
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="e.g., Always filter by active status. Use fiscal year dates. Revenue should be calculated as quantity * unit_price..."
              rows={4}
              className="w-full px-4 py-2.5 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] transition-colors resize-none text-sm"
            />
          </div>

          {/* SQL Queries & Functions */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <h3 className="text-base font-semibold text-[var(--text-primary)]">SQL Queries &amp; Functions</h3>
              <button
                onClick={() => setSampleQueries([...sampleQueries, { question: '', sql: '' }])}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[#6366F1]/10 text-[#6366F1] text-xs font-medium hover:bg-[#6366F1]/20 transition-colors"
              >
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
              <button
                onClick={() => setSampleQueries([{ question: '', sql: '' }])}
                className="w-full py-8 rounded-lg border-2 border-dashed border-[var(--border)] hover:border-[#6366F1]/50 text-[var(--text-secondary)] hover:text-[#6366F1] transition-colors flex flex-col items-center gap-2"
              >
                <Code className="w-5 h-5" />
                <span className="text-sm">Add a SQL query manually</span>
              </button>
            )}

            <div className="space-y-4">
              {sampleQueries.map((sq, idx) => (
                <div key={idx} className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
                  <div className="px-4 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center justify-between">
                    <span className="text-xs font-medium text-[var(--text-secondary)]">Query {idx + 1}</span>
                    <button
                      onClick={() => setSampleQueries(sampleQueries.filter((_, i) => i !== idx))}
                      className="text-[var(--text-secondary)] hover:text-red-400 transition-colors"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="p-4 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">Question (what a user would ask)</label>
                      <input
                        type="text"
                        value={sq.question}
                        onChange={(e) => {
                          const updated = [...sampleQueries]
                          updated[idx] = { ...updated[idx], question: e.target.value }
                          setSampleQueries(updated)
                        }}
                        placeholder="e.g., What are the top 10 customers by revenue?"
                        className="w-full px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] transition-colors text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[var(--text-secondary)] mb-1">SQL</label>
                      <textarea
                        value={sq.sql}
                        onChange={(e) => {
                          const updated = [...sampleQueries]
                          updated[idx] = { ...updated[idx], sql: e.target.value }
                          setSampleQueries(updated)
                        }}
                        placeholder="SELECT customer_name, SUM(revenue) as total_revenue FROM sales GROUP BY customer_name ORDER BY total_revenue DESC LIMIT 10"
                        rows={4}
                        className="w-full px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] transition-colors text-sm font-mono resize-none"
                      />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <StepNav onBack={() => goToStep(3)} onNext={() => goToStep(5)} nextLabel="Next: Review & Create" />
        </div>
      )}

      {/* ─── Step 5: Review & Create ─── */}
      {step === 5 && (
        <div className="space-y-6">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--bg-tertiary)] border-b border-[var(--border)]">
              <span className="text-sm font-semibold text-[var(--text-primary)]">Review</span>
            </div>
            <div className="p-4 space-y-4">
              <ReviewRow label="Room Name" value={title} />
              {description && <ReviewRow label="Description" value={description} />}
              <ReviewRow label="Warehouse" value={warehouseId ? warehouses.find((w) => w.id === warehouseId)?.name || warehouseId : 'Auto-select'} />
              <div>
                <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Tables ({selectedTables.length})</p>
                <div className="space-y-1">
                  {selectedTables.map((t) => (
                    <div key={t} className="flex items-center gap-2 text-sm">
                      <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" /><span className="font-mono text-[#6366F1]">{t}</span>
                    </div>
                  ))}
                </div>
              </div>
              {descValidation && (
                <div>
                  <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Description Coverage</p>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 h-2 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${
                        descValidation.summary.description_coverage >= 80 ? 'bg-emerald-500' : descValidation.summary.description_coverage >= 50 ? 'bg-amber-500' : 'bg-red-500'
                      }`} style={{ width: `${descValidation.summary.description_coverage}%` }} />
                    </div>
                    <span className="text-sm font-medium">{descValidation.summary.description_coverage}%</span>
                  </div>
                </div>
              )}
              {(instructions.trim() || sampleQueries.some(sq => sq.question || sq.sql)) && (
                <div className="p-2.5 rounded-md bg-[#6366F1]/5 border border-[#6366F1]/15 text-[11px] text-[var(--text-secondary)]">
                  Instructions and sample queries will be included in the room description as context for Genie.
                </div>
              )}
              {instructions.trim() && (
                <div>
                  <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Instructions</p>
                  <p className="text-sm text-[var(--text-primary)] bg-[var(--bg-tertiary)] px-3 py-2 rounded-md whitespace-pre-wrap">{instructions}</p>
                </div>
              )}
              {sampleQueries.length > 0 && (() => {
                const validQueries = sampleQueries.filter(sq => sq.question.trim() || sq.sql.trim())
                const emptyCount = sampleQueries.length - validQueries.length
                return (
                  <div>
                    <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1.5">Sample Queries ({validQueries.length})</p>
                    {emptyCount > 0 && (
                      <div className="mb-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-600">
                        {emptyCount} empty {emptyCount === 1 ? 'query' : 'queries'} will be skipped
                      </div>
                    )}
                    {validQueries.length === 0 && (
                      <p className="text-xs text-[var(--text-secondary)] italic">No queries with content — none will be included</p>
                    )}
                    <div className="space-y-2">
                      {validQueries.map((sq, i) => (
                        <div key={i} className="bg-[var(--bg-tertiary)] px-3 py-2 rounded-md">
                          {sq.question && <p className="text-sm text-[var(--text-primary)] mb-1">{sq.question}</p>}
                          {sq.sql && <pre className="text-xs text-[#6366F1] font-mono overflow-x-auto">{sq.sql}</pre>}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              })()}
            </div>
          </div>

          {/* Access & Filters (optional) */}
          <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
            <div className="px-4 py-3 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#6366F1]" />
              <span className="text-sm font-semibold text-[var(--text-primary)]">Access &amp; Filters</span>
              <span className="text-[10px] text-[var(--text-secondary)] ml-auto">Optional</span>
            </div>
            <div className="p-4 space-y-4">
              <p className="text-xs text-[var(--text-secondary)]">
                Row-level security. Configure filter columns (e.g. <code>region</code>, <code>vendor_id</code>) and grant per-user
                allowed values. Leave empty for an unrestricted room — you can always set this up later in Edit Room.
              </p>

              {/* Filter columns */}
              <div>
                <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Filter columns</h4>
                <div className="flex gap-2 mb-2">
                  <select
                    value={newFilterCol}
                    onChange={(e) => setNewFilterCol(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm focus:outline-none focus:border-[#6366F1]"
                  >
                    <option value="">
                      {availableColsLoading ? 'Loading columns…' :
                       availableFilterCols.length === 0 ? 'No columns found in selected tables' :
                       'Select a column…'}
                    </option>
                    {availableFilterCols
                      .filter((c) => !filterColumns.some((f) => f.column_name === c.name))
                      .map((c) => (
                        <option key={c.name} value={c.name}>
                          {c.name} ({c.type}) {c.tables.length > 1 ? `· ${c.tables.length} tables` : ''}
                        </option>
                      ))}
                  </select>
                  <input type="text" value={newFilterColLabel} onChange={(e) => setNewFilterColLabel(e.target.value)}
                    placeholder="Label (optional)"
                    className="w-40 px-3 py-2 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm focus:outline-none focus:border-[#6366F1]" />
                  <button
                    onClick={() => {
                      const name = newFilterCol.trim()
                      if (!name) return
                      if (filterColumns.some((c) => c.column_name === name)) return
                      setFilterColumns([...filterColumns, { column_name: name, label: newFilterColLabel.trim() || undefined }])
                      setNewFilterCol('')
                      setNewFilterColLabel('')
                    }}
                    disabled={!newFilterCol}
                    className="px-3 py-2 rounded-md bg-[#6366F1]/10 text-[#6366F1] text-xs font-medium hover:bg-[#6366F1]/20 disabled:opacity-40 flex items-center gap-1">
                    <Plus className="w-3.5 h-3.5" /> Add
                  </button>
                </div>
                {filterColumns.length === 0 ? (
                  <p className="text-xs text-[var(--text-secondary)] italic">No filter columns — room will be unrestricted.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {filterColumns.map((c) => (
                      <span key={c.column_name} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs">
                        <code className="text-[#6366F1]">{c.column_name}</code>
                        {c.label && c.label !== c.column_name && <span className="text-[var(--text-secondary)]">({c.label})</span>}
                        <button
                          onClick={() => {
                            setFilterColumns(filterColumns.filter((x) => x.column_name !== c.column_name))
                            // Remove this column from any per-user mappings
                            setFilterUsers(filterUsers.map((u) => {
                              const v = { ...u.values }
                              delete v[c.column_name]
                              return { ...u, values: v }
                            }))
                          }}
                          className="text-[var(--text-secondary)] hover:text-red-400">
                          <X className="w-3 h-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              {/* User & group access */}
              {filterColumns.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <UsersIcon className="w-3.5 h-3.5 text-[var(--text-secondary)]" />
                    <h4 className="text-xs font-semibold text-[var(--text-primary)]">User &amp; group access</h4>
                  </div>
                  <PrincipalPicker
                    excludeIds={new Set(filterUsers.map((u) => u.user_email.toLowerCase()))}
                    onPick={(p: Principal) => {
                      const id = p.type === 'user' ? (p.email || p.user_name || p.id).toLowerCase() : p.id
                      if (filterUsers.some((u) => u.user_email.toLowerCase() === id.toLowerCase())) return
                      setFilterUsers([
                        ...filterUsers,
                        {
                          user_email: id,
                          principal_type: p.type,
                          display_name: p.display_name,
                          values: {},
                        },
                      ])
                    }}
                  />
                  {filterUsers.length === 0 ? (
                    <p className="text-xs text-[var(--text-secondary)] italic mt-2">No users or groups granted access yet — room will be closed when created.</p>
                  ) : (
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="text-left text-[var(--text-secondary)] border-b border-[var(--border)]">
                            <th className="py-2 pr-3 font-medium">Principal</th>
                            {filterColumns.map((c) => (
                              <th key={c.column_name} className="py-2 pr-3 font-medium">
                                <code className="text-[#6366F1]">{c.column_name}</code>
                              </th>
                            ))}
                            <th className="py-2"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filterUsers.map((u, ui) => (
                            <tr key={u.user_email} className="border-b border-[var(--border)] last:border-0">
                              <td className="py-2 pr-3 max-w-[220px]">
                                <div className="flex items-center gap-1.5">
                                  {u.principal_type === 'group'
                                    ? <UsersIcon className="w-3 h-3 text-[#3B82F6] shrink-0" />
                                    : <UsersIcon className="w-3 h-3 text-[var(--text-secondary)] shrink-0" />}
                                  <div className="min-w-0">
                                    <p className="text-[var(--text-primary)] truncate">{u.display_name || u.user_email}</p>
                                    {u.principal_type === 'group' && (
                                      <p className="text-[9px] text-[#3B82F6] font-semibold">GROUP</p>
                                    )}
                                  </div>
                                </div>
                              </td>
                              {filterColumns.map((c) => (
                                <td key={c.column_name} className="py-2 pr-3">
                                  <input
                                    type="text"
                                    value={(u.values[c.column_name] || []).join(', ')}
                                    onChange={(e) => {
                                      const vals = e.target.value.split(',').map((v) => v.trim()).filter(Boolean)
                                      const updated = [...filterUsers]
                                      updated[ui] = { ...u, values: { ...u.values, [c.column_name]: vals } }
                                      setFilterUsers(updated)
                                    }}
                                    placeholder="e.g., EMEA, APAC"
                                    className="w-full px-2 py-1 rounded bg-[var(--bg-tertiary)] border border-[var(--border)] text-[11px] focus:outline-none focus:border-[#6366F1]"
                                  />
                                </td>
                              ))}
                              <td className="py-2">
                                <button onClick={() => setFilterUsers(filterUsers.filter((_, i) => i !== ui))}
                                  className="text-[var(--text-secondary)] hover:text-red-400">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="text-[10px] text-[var(--text-secondary)] mt-2">Comma-separate values. Empty cell = no access for that column.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => goToStep(4)}
              className="flex-1 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
              <ArrowLeft className="w-4 h-4" /> Back
            </button>
            <button onClick={handleCreate} disabled={creating}
              className="flex-1 py-3 rounded-lg bg-gradient-to-r from-[#6366F1] to-[#4338CA] hover:from-[#4F46E5] hover:to-[#4338CA] text-white font-semibold text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2">
              {creating ? <><Loader2 className="w-4 h-4 animate-spin" /> Creating...</> : <><Sparkles className="w-4 h-4" /> Create Genie Space</>}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}


// ── Step Nav ──

function StepNav({ onBack, onNext, nextLabel, disabled }: { onBack: () => void; onNext: () => void; nextLabel: string; disabled?: boolean }) {
  return (
    <div className="flex gap-3">
      <button onClick={onBack} className="flex-1 py-3 rounded-lg bg-[var(--bg-tertiary)] hover:bg-[var(--bg-hover)] text-[var(--text-primary)] font-medium text-sm transition-colors flex items-center justify-center gap-2">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>
      <button onClick={onNext} disabled={disabled}
        className="flex-1 py-3 rounded-lg bg-[#6366F1] hover:bg-[#4F46E5] text-white font-semibold text-sm transition-all disabled:opacity-40 flex items-center justify-center gap-2">
        {nextLabel} <ArrowRight className="w-4 h-4" />
      </button>
    </div>
  )
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-[var(--text-secondary)] uppercase tracking-wider mb-1">{label}</p>
      <p className="text-sm font-medium text-[var(--text-primary)]">{value}</p>
    </div>
  )
}


// ── Table Description Card with Editing ──

function TableDescriptionCard({ table, warehouseId, onSaved, presetGenerated }: {
  table: DescriptionValidation['tables'][0]
  warehouseId: string
  onSaved: () => void
  presetGenerated?: { table_description: string; columns: Record<string, string> }
}) {
  const [open, setOpen] = useState(false)
  // Manual editing
  const [editingTableDesc, setEditingTableDesc] = useState(false)
  const [tableDesc, setTableDesc] = useState(table.table_comment || '')
  const [savingTableDesc, setSavingTableDesc] = useState(false)
  const [editingCol, setEditingCol] = useState<string | null>(null)
  const [colDesc, setColDesc] = useState('')
  const [savingCol, setSavingCol] = useState(false)
  // AI generation
  const [generating, setGenerating] = useState(false)
  const [generatedTableDesc, setGeneratedTableDesc] = useState<string | null>(null)
  const [generatedColDescs, setGeneratedColDescs] = useState<Record<string, string>>({})
  const [savingAll, setSavingAll] = useState(false)
  const [saveProgress, setSaveProgress] = useState('')

  // When the parent provides a bulk-generated draft, load it into the card's state
  useEffect(() => {
    if (presetGenerated) {
      setGeneratedTableDesc(presetGenerated.table_description || '')
      setGeneratedColDescs(presetGenerated.columns || {})
      setOpen(true)
    }
  }, [presetGenerated])

  if (table.error) {
    return (
      <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20 text-sm">
        <span className="font-mono text-red-500">{table.full_name}</span>
        <span className="text-red-400 ml-2">Error: {table.error}</span>
      </div>
    )
  }

  const pct = table.total_columns ? Math.round(((table.described_columns || 0) / table.total_columns) * 100) : 0
  const hasTableDesc = table.has_table_comment
  const allGood = hasTableDesc && pct === 100
  const hasGenerated = generatedTableDesc !== null || Object.keys(generatedColDescs).length > 0

  const generateWithAI = async () => {
    setGenerating(true)
    try {
      const result = await api.generateDescriptions({
        full_name: table.full_name,
        table_name: table.table_name || table.full_name.split('.').pop() || '',
        columns: (table.columns || []).map((c) => ({ name: c.name, type: c.type, comment: c.comment })),
        existing_comment: table.table_comment || '',
      })
      setGeneratedTableDesc(result.table_description || '')
      setGeneratedColDescs(result.columns || {})
      setOpen(true)
    } catch {}
    setGenerating(false)
  }

  const [saveError, setSaveError] = useState('')

  const saveTableDesc = async () => {
    if (!warehouseId) return
    setSavingTableDesc(true); setSaveError('')
    try {
      await api.updateTableDescription(table.full_name, tableDesc, warehouseId)
      setEditingTableDesc(false)
      onSaved()
    } catch (e: any) { setSaveError(e.message || 'Failed to save table description') }
    setSavingTableDesc(false)
  }

  const saveColDesc = async (colName: string) => {
    if (!warehouseId) return
    setSavingCol(true); setSaveError('')
    try {
      await api.updateColumnDescription(table.full_name, colName, colDesc, warehouseId)
      setEditingCol(null)
      onSaved()
    } catch (e: any) { setSaveError(e.message || 'Failed to save column description') }
    setSavingCol(false)
  }

  const saveAllGenerated = async () => {
    if (!warehouseId) return
    setSavingAll(true); setSaveError('')
    let saved = 0
    const total = (generatedTableDesc ? 1 : 0) + Object.keys(generatedColDescs).length
    try {
      if (generatedTableDesc) {
        setSaveProgress(`Saving table description...`)
        await api.updateTableDescription(table.full_name, generatedTableDesc, warehouseId)
        saved++
      }
      for (const [colName, desc] of Object.entries(generatedColDescs)) {
        if (!desc) continue
        setSaveProgress(`Saving column ${saved + 1}/${total}...`)
        await api.updateColumnDescription(table.full_name, colName, desc, warehouseId)
        saved++
      }
      setGeneratedTableDesc(null)
      setGeneratedColDescs({})
      setSaveProgress('')
      onSaved()
    } catch (e: any) {
      setSaveProgress(`Saved ${saved}/${total} — some failed`)
      setSaveError(e.message || 'Failed to save some descriptions')
    }
    setSavingAll(false)
  }

  const discardGenerated = () => {
    setGeneratedTableDesc(null)
    setGeneratedColDescs({})
  }

  return (
    <div className={`rounded-lg border overflow-hidden ${allGood && !hasGenerated ? 'border-emerald-500/20' : hasGenerated ? 'border-[#3B82F6]/30' : 'border-amber-500/20'}`}>
      <div className="flex items-center">
        <button onClick={() => setOpen(!open)} className="flex-1 flex items-center gap-3 px-4 py-3 text-left hover:bg-[var(--bg-hover)] transition-colors min-w-0">
          {allGood ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />}
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] truncate">{table.full_name}</p>
            <div className="flex items-center gap-3 mt-0.5 text-xs text-[var(--text-secondary)]">
              <span className={hasTableDesc ? 'text-emerald-600' : 'text-amber-600'}>{hasTableDesc ? 'Has description' : 'No description'}</span>
              <span>Columns: {table.described_columns}/{table.total_columns}</span>
              {hasGenerated && <span className="text-[#3B82F6] font-medium">AI draft ready</span>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="w-16 h-1.5 bg-[var(--bg-tertiary)] rounded-full overflow-hidden">
              <div className={`h-full rounded-full ${pct === 100 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-500' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] font-medium text-[var(--text-secondary)] w-8 text-right">{pct}%</span>
            {open ? <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" /> : <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />}
          </div>
        </button>
        {/* Generate button in header */}
        {!hasGenerated && (
          <button onClick={(e) => { e.stopPropagation(); generateWithAI() }} disabled={generating}
            className="mr-3 px-2.5 py-1.5 rounded-md bg-[#3B82F6]/10 text-[#3B82F6] text-[11px] font-medium hover:bg-[#3B82F6]/20 disabled:opacity-50 transition-colors flex items-center gap-1 shrink-0"
            title="Generate descriptions with AI">
            {generating ? <Loader2 className="w-3 h-3 animate-spin" /> : <Wand2 className="w-3 h-3" />}
            {generating ? 'Generating...' : 'Generate'}
          </button>
        )}
      </div>
      {open && (
        <div className="px-4 pb-3 border-t border-[var(--border)]">
          {/* Save error */}
          {saveError && (
            <div className="mt-3 p-2.5 rounded-md bg-red-500/5 border border-red-500/20 text-xs text-red-500 flex items-center gap-2">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              <span className="flex-1">{saveError}</span>
              <button onClick={() => setSaveError('')} className="text-red-400 hover:text-red-600"><X className="w-3 h-3" /></button>
            </div>
          )}
          {/* AI-generated banner + save all */}
          {hasGenerated && (
            <div className="mt-3 mb-3 p-3 rounded-lg bg-[#3B82F6]/5 border border-[#3B82F6]/20">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Wand2 className="w-3.5 h-3.5 text-[#3B82F6]" />
                  <span className="text-xs font-semibold text-[#3B82F6]">AI-Generated Descriptions</span>
                </div>
                <div className="flex items-center gap-2">
                  {saveProgress && <span className="text-[10px] text-[var(--text-secondary)]">{saveProgress}</span>}
                  <button onClick={discardGenerated} disabled={savingAll}
                    className="px-2 py-1 rounded-md text-[10px] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-tertiary)] transition-colors">
                    Discard
                  </button>
                  <button onClick={saveAllGenerated} disabled={savingAll || !warehouseId}
                    className="px-2.5 py-1 rounded-md bg-[#3B82F6] text-white text-[10px] font-medium hover:bg-[#1D4ED8] disabled:opacity-50 flex items-center gap-1 transition-colors"
                    title={!warehouseId ? 'Select a warehouse in Step 1 first' : 'Save all descriptions to Unity Catalog'}>
                    {savingAll ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />} Save All to UC
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Review the generated descriptions below. Edit any you'd like to change, then click "Save All to UC" to write them to Unity Catalog.{!warehouseId && ' You need to select a SQL warehouse in Step 1 first.'}
              </p>
            </div>
          )}

          {/* Table description */}
          <div className="mt-3 mb-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-medium text-[var(--text-secondary)]">Table Description</span>
              {!editingTableDesc && !hasGenerated && warehouseId && (
                <button onClick={() => { setTableDesc(table.table_comment || ''); setEditingTableDesc(true) }}
                  className="text-xs text-[#6366F1] hover:text-[#6366F1] flex items-center gap-1"><Pencil className="w-3 h-3" /> Edit</button>
              )}
            </div>
            {hasGenerated && generatedTableDesc !== null ? (
              <textarea value={generatedTableDesc} onChange={(e) => setGeneratedTableDesc(e.target.value)}
                rows={Math.max(2, Math.ceil((generatedTableDesc || '').length / 80))}
                className="w-full px-3 py-1.5 rounded-md bg-[#3B82F6]/5 border border-[#3B82F6]/20 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#3B82F6] resize-none" />
            ) : editingTableDesc ? (
              <div className="space-y-2">
                <textarea value={tableDesc} onChange={(e) => setTableDesc(e.target.value)}
                  placeholder="Add a description for this table..."
                  rows={Math.max(2, Math.ceil((tableDesc || '').length / 80))}
                  className="w-full px-3 py-1.5 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-sm text-[var(--text-primary)] focus:outline-none focus:border-[#6366F1] resize-none"
                  autoFocus />
                <div className="flex gap-2">
                  <button onClick={saveTableDesc} disabled={savingTableDesc}
                    className="px-3 py-1.5 rounded-md bg-[#6366F1] text-white text-xs font-medium hover:bg-[#4F46E5] disabled:opacity-50 flex items-center gap-1">
                    {savingTableDesc ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Save
                  </button>
                  <button onClick={() => setEditingTableDesc(false)} className="px-2 py-1.5 rounded-md bg-[var(--bg-tertiary)] text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]">Cancel</button>
                </div>
              </div>
            ) : (
              <p className={`text-sm ${table.table_comment ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)] italic'}`}>
                {table.table_comment || 'No description'}
              </p>
            )}
          </div>

          {/* Columns */}
          <div className="space-y-1">
            {table.columns?.map((c) => {
              const genDesc = generatedColDescs[c.name]
              return (
                <div key={c.name} className="py-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    {c.has_comment ? <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" /> : <AlertTriangle className="w-3 h-3 text-amber-600 shrink-0" />}
                    <span className="font-mono text-[var(--text-primary)]">{c.name}</span>
                    <span className="text-[var(--text-secondary)]">({c.type})</span>
                    {!hasGenerated && c.has_comment && editingCol !== c.name && (
                      <span className="text-[var(--text-secondary)] truncate ml-auto max-w-[40%]">{c.comment}</span>
                    )}
                    {!hasGenerated && !c.has_comment && editingCol !== c.name && warehouseId && (
                      <button onClick={() => { setEditingCol(c.name); setColDesc(c.comment || '') }}
                        className="ml-auto text-[10px] text-[#6366F1] hover:text-[#6366F1] flex items-center gap-0.5"><Pencil className="w-2.5 h-2.5" /> Add</button>
                    )}
                    {!hasGenerated && c.has_comment && editingCol !== c.name && warehouseId && (
                      <button onClick={() => { setEditingCol(c.name); setColDesc(c.comment || '') }}
                        className="text-[10px] text-[#6366F1] hover:text-[#6366F1] flex items-center gap-0.5 shrink-0"><Pencil className="w-2.5 h-2.5" /></button>
                    )}
                  </div>
                  {/* AI-generated column description (editable inline) */}
                  {hasGenerated && genDesc !== undefined && (
                    <div className="ml-5 mt-1">
                      <input type="text" value={genDesc} onChange={(e) => setGeneratedColDescs((prev) => ({ ...prev, [c.name]: e.target.value }))}
                        className="w-full px-2.5 py-1 rounded-md bg-[#3B82F6]/5 border border-[#3B82F6]/20 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#3B82F6]" />
                    </div>
                  )}
                  {/* Show existing description when generated is present but not for this column */}
                  {hasGenerated && genDesc === undefined && c.comment && (
                    <div className="ml-5 mt-0.5 text-xs text-[var(--text-secondary)]">{c.comment}</div>
                  )}
                  {/* Manual editing */}
                  {!hasGenerated && editingCol === c.name && (
                    <div className="flex gap-2 mt-1.5 ml-5">
                      <input type="text" value={colDesc} onChange={(e) => setColDesc(e.target.value)}
                        placeholder={`Describe ${c.name}...`}
                        className="flex-1 px-2.5 py-1 rounded-md bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs text-[var(--text-primary)] focus:outline-none focus:border-[#6366F1]"
                        autoFocus onKeyDown={(e) => { if (e.key === 'Enter') saveColDesc(c.name) }} />
                      <button onClick={() => saveColDesc(c.name)} disabled={savingCol}
                        className="px-2 py-1 rounded-md bg-[#6366F1] text-white text-[10px] font-medium hover:bg-[#4F46E5] disabled:opacity-50 flex items-center gap-1">
                        {savingCol ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <Save className="w-2.5 h-2.5" />} Save
                      </button>
                      <button onClick={() => setEditingCol(null)} className="px-2 py-1 rounded-md bg-[var(--bg-tertiary)] text-[10px] text-[var(--text-secondary)]">Cancel</button>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}


// ── SQL File Uploader (local + workspace) ──

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
    setWsLoading(true)
    setWsPath(path)
    try {
      const r = await api.listWorkspacePath(path)
      setWsItems(r.items)
    } catch { setWsItems([]) }
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
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[#6366F1] hover:border-[#6366F1]/30 transition-colors">
          <Upload className="w-3.5 h-3.5" /> Upload from computer
        </button>
        <button onClick={() => { setShowWorkspaceBrowser(true); browseWorkspace(wsPath === '/' ? '/' : wsPath) }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-xs font-medium text-[var(--text-secondary)] hover:text-[#3B82F6] hover:border-[#3B82F6]/30 transition-colors">
          <FolderOpen className="w-3.5 h-3.5" /> Browse workspace
        </button>
      </div>

      {/* Workspace browser */}
      {showWorkspaceBrowser && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
          <div className="px-3 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border)] flex items-center gap-2">
            <FolderOpen className="w-3.5 h-3.5 text-[#3B82F6]" />
            <span className="text-xs font-semibold text-[var(--text-primary)] flex-1 truncate">{wsPath}</span>
            <button onClick={() => setShowWorkspaceBrowser(false)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>
          </div>
          <div className="max-h-52 overflow-y-auto p-1.5 space-y-0.5">
            {wsLoading ? (
              <div className="flex items-center justify-center py-6 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading...</div>
            ) : (
              <>
                {parentPath !== null && (
                  <button onClick={() => browseWorkspace(parentPath)}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors text-[var(--text-secondary)]">
                    <ArrowLeft className="w-3.5 h-3.5" /> <span>..</span>
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
                      {isDir ? <Folder className="w-3.5 h-3.5 text-amber-500 shrink-0" /> : <FileText className={`w-3.5 h-3.5 shrink-0 ${alreadyAdded ? 'text-emerald-500' : item.is_sql ? 'text-[#6366F1]' : 'text-[var(--text-secondary)]'}`} />}
                      <span className={`flex-1 text-left truncate ${alreadyAdded ? 'text-emerald-600' : item.is_sql ? 'text-[var(--text-primary)] font-medium' : 'text-[var(--text-secondary)]'}`}>{item.name}</span>
                      {wsReadingFile === item.path && <Loader2 className="w-3 h-3 animate-spin text-[#6366F1]" />}
                      {!isDir && alreadyAdded && <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-medium"><CheckCircle2 className="w-3 h-3" /> Added as query</span>}
                      {!isDir && item.is_sql && !alreadyAdded && wsReadingFile !== item.path && <span className="text-[10px] text-[#6366F1] font-medium">Import</span>}
                      {isDir && <ChevronRight className="w-3 h-3 text-[var(--text-secondary)]" />}
                    </button>
                  )
                })}
                {wsItems.length === 0 && !wsLoading && (
                  <p className="text-center py-4 text-xs text-[var(--text-secondary)]">Empty directory</p>
                )}
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


// ── Analysis Card ──

function AnalysisCard({ icon: Icon, title, description, loading, done, disabled, disabledReason, onRun, children }: {
  icon: typeof Hash; title: string; description: string; loading: boolean; done: boolean
  disabled?: boolean; disabledReason?: string; onRun: () => void; children?: React.ReactNode
}) {
  return (
    <div className={`rounded-lg border overflow-hidden ${done ? 'border-emerald-500/20 bg-[var(--bg-secondary)]' : 'border-[var(--border)] bg-[var(--bg-secondary)]'}`}>
      <div className="flex items-center gap-3 px-4 py-3">
        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${done ? 'bg-emerald-500/10' : 'bg-[var(--bg-tertiary)]'}`}>
          <Icon className={`w-4.5 h-4.5 ${done ? 'text-emerald-500' : 'text-[var(--text-secondary)]'}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h4 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h4>
            {done && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
          </div>
          <p className="text-xs text-[var(--text-secondary)]">{description}</p>
        </div>
        {!done && (
          <button onClick={onRun} disabled={loading || disabled}
            className="shrink-0 px-3 py-1.5 rounded-md bg-[#6366F1]/10 text-[#6366F1] text-xs font-medium hover:bg-[#6366F1]/20 disabled:opacity-40 transition-colors flex items-center gap-1.5"
            title={disabled ? disabledReason : undefined}>
            {loading ? <Loader2 className="w-3 h-3 animate-spin" /> : <BarChart3 className="w-3 h-3" />}
            {loading ? 'Running...' : 'Run'}
          </button>
        )}
        {done && !loading && (
          <button onClick={onRun}
            className="shrink-0 px-2.5 py-1 rounded-md text-[var(--text-secondary)] text-[11px] font-medium hover:bg-[var(--bg-tertiary)] transition-colors">
            Re-run
          </button>
        )}
      </div>
      {disabled && !done && disabledReason && (
        <div className="px-4 pb-3">
          <p className="text-[11px] text-amber-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> {disabledReason}</p>
        </div>
      )}
      {children && (
        <div className="px-4 pb-4 border-t border-[var(--border)] pt-3">
          {children}
        </div>
      )}
    </div>
  )
}


// ── Catalog Picker ──

function CatalogPicker({
  pickerSearch, setPickerSearch, searching, searchResults,
  catalogsLoading, visibleCatalogs, filteredCatalogs, visibleCount, setVisibleCount,
  expandedCatalogs, expandedSchemas, schemas, tables, nodeErrors, loadingNodes,
  selectedTables, toggleCatalog, toggleSchema, toggleTable, selectAllInSchema, onClose,
}: any) {
  const q = pickerSearch.trim()
  const hasActiveSearch = q.length >= 2

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-secondary)] overflow-hidden">
      <div className="px-3 py-2.5 border-b border-[var(--border)] bg-[var(--bg-tertiary)]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-secondary)]" />
          <input type="text" value={pickerSearch} onChange={(e) => setPickerSearch(e.target.value)}
            placeholder="Search tables (e.g. trips or catalog.schema.table)..."
            className="w-full pl-8 pr-8 py-1.5 rounded-md bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#6366F1] transition-colors text-sm"
            autoFocus />
          {pickerSearch && <button onClick={() => setPickerSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><X className="w-3.5 h-3.5" /></button>}
        </div>
      </div>
      <div className="max-h-72 overflow-y-auto p-2">
        {/* Search results */}
        {hasActiveSearch && (
          <>
            {searching && (
              <div className="flex items-center justify-center py-8 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching...</div>
            )}
            {!searching && searchResults.length > 0 && searchResults.map((r: CatalogSearchResult) => {
              if (r.type === 'table') {
                const isSelected = selectedTables.includes(r.full_name)
                return (
                  <button key={r.full_name} onClick={() => toggleTable(r.full_name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                    <div className={`shrink-0 rounded border flex items-center justify-center ${isSelected ? 'bg-[#6366F1] border-[#6366F1]' : 'border-[var(--border)]'}`} style={{ width: 18, height: 18 }}>
                      {isSelected && <Check className="w-3 h-3 text-white" />}
                    </div>
                    <Table2 className="w-3.5 h-3.5 text-emerald-500" />
                    <div className="flex flex-col min-w-0 flex-1 text-left">
                      <span className="truncate font-medium">{r.name}</span>
                      <span className="text-[11px] text-[var(--text-secondary)] truncate">{r.catalog}.{r.schema}</span>
                    </div>
                    {r.comment && <span className="text-[11px] text-[var(--text-secondary)] truncate max-w-[200px] hidden lg:inline">{r.comment}</span>}
                  </button>
                )
              }
              return (
                <button key={r.full_name} onClick={() => {
                  // Drill down: set search to namespace prefix to show children
                  if (r.type === 'catalog') {
                    setPickerSearch(`${r.name}.`)
                  } else if (r.type === 'schema' && r.catalog) {
                    setPickerSearch(`${r.catalog}.${r.name}.`)
                  }
                }}
                  className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                  {r.type === 'catalog' ? <Database className="w-3.5 h-3.5 text-[#6366F1]" /> : <Layers className="w-3.5 h-3.5 text-[#3B82F6]" />}
                  <span className="font-medium">{r.name}</span>
                  <span className="ml-auto text-[10px] text-[var(--text-secondary)] uppercase tracking-wider">
                    {r.type === 'catalog' ? 'catalog' : 'schema'} &rsaquo;
                  </span>
                </button>
              )
            })}
            {!searching && searchResults.length === 0 && (
              <p className="text-center py-6 text-sm text-[var(--text-secondary)]">No results for &ldquo;{q}&rdquo;</p>
            )}
          </>
        )}

        {/* Catalog tree browser (when no active search) */}
        {!hasActiveSearch && (
          <>
            {catalogsLoading && <div className="flex items-center justify-center py-8 text-[var(--text-secondary)] text-sm"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading catalogs...</div>}
            {visibleCatalogs.map((cat: Catalog) => (
              <div key={cat.name}>
                <button onClick={() => toggleCatalog(cat.name)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                  {loadingNodes.has(cat.name) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" /> : expandedCatalogs.has(cat.name) ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                  <Database className="w-3.5 h-3.5 text-[#6366F1]" /><span className="font-medium">{cat.name}</span>
                </button>
                {expandedCatalogs.has(cat.name) && schemas[cat.name]?.map((sch: Schema) => {
                  const sk = `${cat.name}.${sch.name}`
                  const schemaTables = tables[sk] as Table[] | undefined
                  const schemaTableCount = schemaTables?.length ?? 0
                  const selectedInSchema = schemaTables
                    ? schemaTables.filter((t) => selectedTables.includes(t.full_name)).length
                    : 0
                  const allSelected = schemaTableCount > 0 && selectedInSchema === schemaTableCount
                  const someSelected = selectedInSchema > 0 && !allSelected
                  return (
                    <div key={sch.name} className="ml-4">
                      <div className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                        <button
                          onClick={(e) => { e.stopPropagation(); selectAllInSchema(cat.name, sch.name) }}
                          title={allSelected ? 'Deselect all tables in schema' : 'Select all tables in schema'}
                          className={`shrink-0 rounded border flex items-center justify-center transition-colors ${
                            allSelected
                              ? 'bg-[#6366F1] border-[#6366F1]'
                              : someSelected
                                ? 'bg-[#6366F1]/30 border-[#6366F1]'
                                : 'border-[var(--border)] hover:border-[#6366F1]'
                          }`}
                          style={{ width: 18, height: 18 }}
                        >
                          {allSelected && <Check className="w-3 h-3 text-white" />}
                          {someSelected && <Minus className="w-3 h-3 text-[#6366F1]" />}
                        </button>
                        <button onClick={() => toggleSchema(cat.name, sch.name)} className="flex-1 flex items-center gap-2 text-left">
                          {loadingNodes.has(sk) ? <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--text-secondary)]" /> : expandedSchemas.has(sk) ? <ChevronDown className="w-3.5 h-3.5 text-[var(--text-secondary)]" /> : <ChevronRight className="w-3.5 h-3.5 text-[var(--text-secondary)]" />}
                          <Layers className="w-3.5 h-3.5 text-[#3B82F6]" /><span>{sch.name}</span>
                        </button>
                      </div>
                      {expandedSchemas.has(sk) && tables[sk]?.map((tbl: Table) => {
                        const isSel = selectedTables.includes(tbl.full_name)
                        return (
                          <button key={tbl.name} onClick={() => toggleTable(tbl.full_name)} className="w-full ml-4 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors">
                            <div className={`shrink-0 rounded border flex items-center justify-center ${isSel ? 'bg-[#6366F1] border-[#6366F1]' : 'border-[var(--border)]'}`} style={{ width: 18, height: 18 }}>
                              {isSel && <Check className="w-3 h-3 text-white" />}
                            </div>
                            <Table2 className="w-3.5 h-3.5 text-emerald-500" /><span className="truncate">{tbl.name}</span>
                          </button>
                        )
                      })}
                      {/* Surface load failures / empty schemas instead of a blank body */}
                      {expandedSchemas.has(sk) && !loadingNodes.has(sk) && nodeErrors[sk] && (
                        <p className="ml-8 px-2 py-1.5 text-[11px] text-red-500">{nodeErrors[sk]}</p>
                      )}
                      {expandedSchemas.has(sk) && !loadingNodes.has(sk) && !nodeErrors[sk] && tables[sk]?.length === 0 && (
                        <p className="ml-8 px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">No tables you can access in this schema.</p>
                      )}
                    </div>
                  )
                })}
                {/* Surface schema load failures / empty catalogs instead of a blank body */}
                {expandedCatalogs.has(cat.name) && !loadingNodes.has(cat.name) && nodeErrors[cat.name] && (
                  <p className="ml-6 px-2 py-1.5 text-[11px] text-red-500">{nodeErrors[cat.name]}</p>
                )}
                {expandedCatalogs.has(cat.name) && !loadingNodes.has(cat.name) && !nodeErrors[cat.name] && schemas[cat.name]?.length === 0 && (
                  <p className="ml-6 px-2 py-1.5 text-[11px] text-[var(--text-secondary)]">No schemas you can access in this catalog.</p>
                )}
              </div>
            ))}
            {visibleCount < filteredCatalogs.length && (
              <button onClick={() => setVisibleCount((c: number) => c + 50)} className="w-full py-2 text-xs text-[#6366F1] font-medium">Show more ({filteredCatalogs.length - visibleCount})</button>
            )}
          </>
        )}
      </div>
      <div className="px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-tertiary)] flex items-center justify-between">
        <span className="text-xs text-[var(--text-secondary)]">{selectedTables.length} selected</span>
        <button onClick={onClose} className="text-xs font-medium text-[#6366F1] hover:text-[#6366F1]">Done</button>
      </div>
    </div>
  )
}


// ── Markdown renderer ──

