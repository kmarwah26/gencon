import { useState, useEffect, useMemo, useCallback } from 'react'
import {
  ChevronRight,
  ChevronDown,
  Database,
  Layers,
  Table2,
  Check,
  Columns3,
  Loader2,
  Search,
  X,
} from 'lucide-react'
import { api } from '../api'
import type { Catalog, Schema, Table, CatalogSearchResult } from '../api'
import { useAppStore } from '../store'
import { useNavigate } from 'react-router-dom'

interface SearchResult {
  catalog: string
  schema: string
  table: Table
}

export default function CatalogExplorer() {
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [expandedCatalogs, setExpandedCatalogs] = useState<Set<string>>(new Set())
  const [expandedSchemas, setExpandedSchemas] = useState<Set<string>>(new Set())
  const [schemas, setSchemas] = useState<Record<string, Schema[]>>({})
  const [tables, setTables] = useState<Record<string, Table[]>>({})
  const [loadingNodes, setLoadingNodes] = useState<Set<string>>(new Set())
  const [selectedTable, setSelectedTable] = useState<Table | null>(null)
  const { selectedTables, toggleTable } = useAppStore()
  const navigate = useNavigate()

  // Search state
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searching, setSearching] = useState(false)
  const [searchDone, setSearchDone] = useState(false)
  const [namespaceResults, setNamespaceResults] = useState<CatalogSearchResult[]>([])
  const [namespaceSearchActive, setNamespaceSearchActive] = useState(false)

  useEffect(() => {
    api.listCatalogs().then((r) => { setCatalogs(r.catalogs); setLoading(false) })
      .catch((e) => { setError(e.message); setLoading(false) })
  }, [])

  // Filter catalogs in the tree view
  const filteredCatalogs = useMemo(() => {
    if (!searchQuery.trim()) return catalogs
    const q = searchQuery.toLowerCase()
    return catalogs.filter((c) => c.name.toLowerCase().includes(q))
  }, [catalogs, searchQuery])

  // Search across loaded schemas and tables, or use namespace API for dot-queries
  const doSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([])
      setNamespaceResults([])
      setNamespaceSearchActive(false)
      setSearchDone(false)
      return
    }

    setSearching(true)

    // If query contains a dot, use the namespace search API
    if (query.includes('.')) {
      setNamespaceSearchActive(true)
      try {
        const resp = await api.searchCatalog(query)
        setNamespaceResults(resp.results)
        setSearchResults([])
      } catch {
        setNamespaceResults([])
      }
      setSearching(false)
      setSearchDone(true)
      return
    }

    // Otherwise, search locally loaded tables + filter catalogs
    setNamespaceSearchActive(false)
    setNamespaceResults([])
    const q = query.toLowerCase()
    const results: SearchResult[] = []

    for (const [key, tableList] of Object.entries(tables)) {
      const [catalog, schema] = key.split('.')
      for (const tbl of tableList) {
        if (
          tbl.name.toLowerCase().includes(q) ||
          tbl.full_name.toLowerCase().includes(q) ||
          (tbl.comment && tbl.comment.toLowerCase().includes(q))
        ) {
          results.push({ catalog, schema, table: tbl })
        }
      }
    }

    setSearchResults(results)
    setSearching(false)
    setSearchDone(true)
  }, [tables])

  // Debounced search
  useEffect(() => {
    const timer = setTimeout(() => doSearch(searchQuery), 300)
    return () => clearTimeout(timer)
  }, [searchQuery, doSearch])

  const toggleCatalog = async (name: string) => {
    const next = new Set(expandedCatalogs)
    if (next.has(name)) {
      next.delete(name)
    } else {
      next.add(name)
      if (!schemas[name]) {
        setLoadingNodes((s) => new Set(s).add(name))
        try {
          const r = await api.listSchemas(name)
          setSchemas((s) => ({ ...s, [name]: r.schemas }))
        } catch { /* ignore */ }
        setLoadingNodes((s) => { const n = new Set(s); n.delete(name); return n })
      }
    }
    setExpandedCatalogs(next)
  }

  const toggleSchema = async (catalog: string, schema: string) => {
    const key = `${catalog}.${schema}`
    const next = new Set(expandedSchemas)
    if (next.has(key)) {
      next.delete(key)
    } else {
      next.add(key)
      if (!tables[key]) {
        setLoadingNodes((s) => new Set(s).add(key))
        try {
          const r = await api.listTables(catalog, schema)
          setTables((s) => ({ ...s, [key]: r.tables }))
        } catch { /* ignore */ }
        setLoadingNodes((s) => { const n = new Set(s); n.delete(key); return n })
      }
    }
    setExpandedSchemas(next)
  }

  const isSearchActive = searchQuery.trim().length > 0

  return (
    <div className="flex h-full">
      {/* Tree panel */}
      <div className="w-[380px] shrink-0 border-r border-[var(--border)] flex flex-col">
        <div className="p-5 border-b border-[var(--border)]">
          <h2 className="text-xl font-semibold text-[var(--text-primary)]">Unity Catalog</h2>
          <p className="text-sm text-[var(--text-secondary)] mt-1">
            Browse and select tables for Genie rooms
          </p>
          {/* Search bar */}
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-secondary)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search by name or namespace (catalog.schema.table)..."
              className="w-full pl-9 pr-8 py-2 rounded-lg bg-[var(--bg-tertiary)] border border-[var(--border)] text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] focus:outline-none focus:border-[#D0A33C] transition-colors text-sm"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && (
            <div className="flex items-center justify-center py-12 text-[var(--text-secondary)]">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading catalogs...
            </div>
          )}
          {error && (
            <div className="p-4 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Search results */}
          {isSearchActive && searching && (
            <div className="flex items-center justify-center py-8 text-[var(--text-secondary)]">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Searching...
            </div>
          )}

          {/* Namespace search results (dot-separated queries) */}
          {isSearchActive && searchDone && namespaceSearchActive && (
            <div className="mb-2">
              {namespaceResults.length > 0 ? (
                <>
                  <p className="text-xs text-[var(--text-secondary)] px-2 mb-2">
                    {namespaceResults.length} result{namespaceResults.length !== 1 ? 's' : ''} found
                  </p>
                  {namespaceResults.map((r) => {
                    if (r.type === 'catalog') {
                      return (
                        <button
                          key={r.full_name}
                          onClick={() => toggleCatalog(r.name)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors"
                        >
                          <Database className="w-3.5 h-3.5 text-[#D0A33C]" />
                          <span className="font-medium">{r.name}</span>
                          <span className="ml-auto text-[10px] text-[var(--text-secondary)] uppercase">catalog</span>
                        </button>
                      )
                    }
                    if (r.type === 'schema') {
                      return (
                        <button
                          key={r.full_name}
                          onClick={() => { if (r.catalog) toggleSchema(r.catalog, r.name) }}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors"
                        >
                          <Layers className="w-3.5 h-3.5 text-[#325B6D]" />
                          <span className="font-medium">{r.name}</span>
                          <span className="text-[11px] text-[var(--text-secondary)] ml-1">{r.catalog}</span>
                          <span className="ml-auto text-[10px] text-[var(--text-secondary)] uppercase">schema</span>
                        </button>
                      )
                    }
                    // table result
                    const isSelected = selectedTables.includes(r.full_name)
                    const tableObj: Table = {
                      name: r.name,
                      full_name: r.full_name,
                      table_type: r.table_type || '',
                      comment: r.comment || '',
                      columns: r.columns || [],
                    }
                    return (
                      <div key={r.full_name} className="flex items-center mb-0.5">
                        <button
                          onClick={() => toggleTable(r.full_name)}
                          className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-[#D0A33C] border-[#D0A33C]'
                              : 'border-[var(--border)] hover:border-[#D0A33C]'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <button
                          onClick={() => setSelectedTable(tableObj)}
                          className="flex-1 flex flex-col px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors text-left min-w-0"
                        >
                          <span className="flex items-center gap-2">
                            <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="font-medium truncate">{r.name}</span>
                            <span className="ml-auto text-[10px] text-[var(--text-secondary)] uppercase shrink-0">
                              {(r.table_type || '').replace('TABLE_TYPE_', '')}
                            </span>
                          </span>
                          <span className="text-[11px] text-[var(--text-secondary)] truncate pl-[22px]">
                            {r.catalog}.{r.schema}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </>
              ) : (
                <div className="text-center py-8 text-[var(--text-secondary)] text-sm">
                  <p>No results for "{searchQuery}"</p>
                  <p className="text-xs mt-1">Try catalog.schema or catalog.schema.table</p>
                </div>
              )}
            </div>
          )}

          {/* Local search results (non-dot queries) */}
          {isSearchActive && searchDone && !namespaceSearchActive && (
            <div className="mb-2">
              {searchResults.length > 0 ? (
                <>
                  <p className="text-xs text-[var(--text-secondary)] px-2 mb-2">
                    {searchResults.length} table{searchResults.length !== 1 ? 's' : ''} found
                  </p>
                  {searchResults.map((sr) => {
                    const isSelected = selectedTables.includes(sr.table.full_name)
                    return (
                      <div key={sr.table.full_name} className="flex items-center mb-0.5">
                        <button
                          onClick={() => toggleTable(sr.table.full_name)}
                          className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${
                            isSelected
                              ? 'bg-[#D0A33C] border-[#D0A33C]'
                              : 'border-[var(--border)] hover:border-[#D0A33C]'
                          }`}
                        >
                          {isSelected && <Check className="w-3 h-3 text-white" />}
                        </button>
                        <button
                          onClick={() => setSelectedTable(sr.table)}
                          className="flex-1 flex flex-col px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors text-left min-w-0"
                        >
                          <span className="flex items-center gap-2">
                            <Table2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span className="font-medium truncate">{sr.table.name}</span>
                          </span>
                          <span className="text-[11px] text-[var(--text-secondary)] truncate pl-[22px]">
                            {sr.catalog}.{sr.schema}
                          </span>
                        </button>
                      </div>
                    )
                  })}
                </>
              ) : (
                <div className="text-center py-8 text-[var(--text-secondary)] text-sm">
                  <p>No tables found for "{searchQuery}"</p>
                  <p className="text-xs mt-1">Try namespace search: catalog.schema.table</p>
                </div>
              )}
            </div>
          )}

          {/* Tree view - hide when search results are showing */}
          {(!isSearchActive || (!searchDone && !searching) || (!namespaceSearchActive && searchResults.length === 0 && !searching)) && (
            <>
              {filteredCatalogs.map((cat) => (
                <div key={cat.name}>
                  <button
                    onClick={() => toggleCatalog(cat.name)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors"
                  >
                    {loadingNodes.has(cat.name) ? (
                      <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
                    ) : expandedCatalogs.has(cat.name) ? (
                      <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
                    )}
                    <Database className="w-4 h-4 text-[#D0A33C]" />
                    <span className="font-medium">{cat.name}</span>
                  </button>

                  {expandedCatalogs.has(cat.name) && schemas[cat.name]?.map((sch) => {
                    const schemaKey = `${cat.name}.${sch.name}`
                    // Filter schemas if searching
                    if (isSearchActive && !sch.name.toLowerCase().includes(searchQuery.toLowerCase())) {
                      // Still show if it has matching tables
                      const schemaTables = tables[schemaKey] || []
                      const hasMatch = schemaTables.some(
                        (t) => t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                               t.full_name.toLowerCase().includes(searchQuery.toLowerCase())
                      )
                      if (!hasMatch) return null
                    }
                    return (
                      <div key={sch.name} className="ml-4">
                        <button
                          onClick={() => toggleSchema(cat.name, sch.name)}
                          className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors"
                        >
                          {loadingNodes.has(schemaKey) ? (
                            <Loader2 className="w-4 h-4 animate-spin text-[var(--text-secondary)]" />
                          ) : expandedSchemas.has(schemaKey) ? (
                            <ChevronDown className="w-4 h-4 text-[var(--text-secondary)]" />
                          ) : (
                            <ChevronRight className="w-4 h-4 text-[var(--text-secondary)]" />
                          )}
                          <Layers className="w-4 h-4 text-[#325B6D]" />
                          <span>{sch.name}</span>
                        </button>

                        {expandedSchemas.has(schemaKey) && tables[schemaKey]?.map((tbl) => {
                          // Filter tables if searching
                          if (isSearchActive &&
                            !tbl.name.toLowerCase().includes(searchQuery.toLowerCase()) &&
                            !tbl.full_name.toLowerCase().includes(searchQuery.toLowerCase())
                          ) return null

                          const isSelected = selectedTables.includes(tbl.full_name)
                          return (
                            <div key={tbl.name} className="ml-4 flex items-center">
                              <button
                                onClick={() => toggleTable(tbl.full_name)}
                                className={`shrink-0 w-5 h-5 rounded border flex items-center justify-center transition-all ${
                                  isSelected
                                    ? 'bg-[#D0A33C] border-[#D0A33C]'
                                    : 'border-[var(--border)] hover:border-[#D0A33C]'
                                }`}
                              >
                                {isSelected && <Check className="w-3 h-3 text-white" />}
                              </button>
                              <button
                                onClick={() => setSelectedTable(tbl)}
                                className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--bg-hover)] text-sm transition-colors text-left"
                              >
                                <Table2 className="w-4 h-4 text-emerald-500" />
                                <span className="truncate">{tbl.name}</span>
                                <span className="ml-auto text-[10px] text-[var(--text-secondary)] uppercase">
                                  {tbl.table_type.replace('TABLE_TYPE_', '')}
                                </span>
                              </button>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              ))}
              {!loading && filteredCatalogs.length === 0 && isSearchActive && (
                <div className="text-center py-8 text-[var(--text-secondary)] text-sm">
                  No catalogs match "{searchQuery}"
                </div>
              )}
            </>
          )}
        </div>

        {selectedTables.length > 0 && (
          <div className="p-4 border-t border-[var(--border)] bg-[var(--bg-tertiary)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {selectedTables.length} table{selectedTables.length > 1 ? 's' : ''} selected
              </span>
            </div>
            <button
              onClick={() => navigate('/create')}
              className="w-full py-2 rounded-lg bg-[#D0A33C] hover:bg-[#b88d2e] text-white text-sm font-medium transition-colors"
            >
              Create Genie Room
            </button>
          </div>
        )}
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-y-auto">
        {selectedTable ? (
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                <Table2 className="w-5 h-5 text-emerald-500" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--text-primary)]">{selectedTable.name}</h3>
                <p className="text-sm text-[var(--text-secondary)]">{selectedTable.full_name}</p>
              </div>
              <button
                onClick={() => toggleTable(selectedTable.full_name)}
                className={`ml-auto px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                  selectedTables.includes(selectedTable.full_name)
                    ? 'bg-[#D0A33C]/15 text-[#D0A33C] border border-[#D0A33C]/30'
                    : 'bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                }`}
              >
                {selectedTables.includes(selectedTable.full_name) ? 'Selected' : 'Select'}
              </button>
            </div>

            {selectedTable.comment && (
              <p className="text-sm text-[var(--text-secondary)] mb-6 p-3 rounded-lg bg-[var(--bg-tertiary)]">
                {selectedTable.comment}
              </p>
            )}

            <div className="flex items-center gap-2 mb-3">
              <Columns3 className="w-4 h-4 text-[var(--text-secondary)]" />
              <h4 className="text-sm font-medium text-[var(--text-secondary)] uppercase tracking-wider">
                Columns ({selectedTable.columns.length})
              </h4>
            </div>
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[var(--bg-tertiary)]">
                    <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Name</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Type</th>
                    <th className="text-left px-4 py-2.5 font-medium text-[var(--text-secondary)]">Comment</th>
                  </tr>
                </thead>
                <tbody>
                  {selectedTable.columns.map((col, i) => (
                    <tr key={col.name} className={i % 2 === 0 ? '' : 'bg-[var(--bg-secondary)]'}>
                      <td className="px-4 py-2 font-mono text-[#325B6D]">{col.name}</td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">{col.type}</td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">{col.comment || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-[var(--text-secondary)]">
            <Database className="w-12 h-12 mb-3 opacity-30" />
            <p className="text-lg">Select a table to view details</p>
            <p className="text-sm mt-1">Browse the catalog tree on the left</p>
          </div>
        )}
      </div>
    </div>
  )
}
