const BASE = '/api';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let resp: Response;
  try {
    resp = await fetch(`${BASE}${path}`, {
      headers: { 'Content-Type': 'application/json', ...options?.headers },
      ...options,
    });
  } catch (e: any) {
    throw new Error(e.message === 'Failed to fetch' ? 'Network error — the server may be restarting. Please try again.' : e.message);
  }
  if (!resp.ok) {
    const text = await resp.text();
    // Extract clean message from HTML error pages (e.g. 502 Bad Gateway)
    if (text.startsWith('<!') || text.startsWith('<html')) {
      const status = resp.status;
      const label = status === 502 ? 'Bad Gateway' : status === 504 ? 'Gateway Timeout' : `HTTP ${status}`;
      throw new Error(`${label} — the server may be busy or restarting. Please retry in a few seconds.`);
    }
    // Try to extract JSON detail
    try {
      const json = JSON.parse(text);
      throw new Error(json.detail || json.message || text);
    } catch (jsonErr) {
      if (jsonErr instanceof SyntaxError) throw new Error(text || resp.statusText);
      throw jsonErr;
    }
  }
  return resp.json();
}

export interface Catalog {
  name: string;
  comment: string;
  owner: string;
}

export interface Schema {
  name: string;
  full_name: string;
  comment: string;
}

export interface Column {
  name: string;
  type: string;
  comment: string;
}

export interface Table {
  name: string;
  full_name: string;
  table_type: string;
  comment: string;
  columns: Column[];
}

export interface GenieRoom {
  id: string;
  title: string;
  description: string;
  creator_id: string;
  creator_name: string;
}

export interface GenieRoomDetail {
  space_id: string;
  title: string;
  description: string;
  warehouse_id: string;
  parent_path: string;
  table_identifiers: string[];
  instructions: string;
  sample_queries: { question: string; sql: string }[];
}

export interface SavedQuestion {
  id: string;
  question: string;
  sql: string;
  created_at: string;
}

export interface ChatHistoryMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  sql: string;
  queryResult: any;
  description: string;
  status: string;
  userQuestion: string;
  created_at: string;
}

export interface CurrentUser {
  id: string;
  user_name: string;
  display_name: string;
}

export interface Warehouse {
  id: string;
  name: string;
  state: string;
  cluster_size: string;
}

export interface CatalogSearchResult {
  type: 'catalog' | 'schema' | 'table';
  name: string;
  full_name: string;
  catalog?: string;
  schema?: string;
  table_type?: string;
  comment?: string;
  columns?: Column[];
}

export const api = {
  searchCatalog: (q: string) =>
    request<{ results: CatalogSearchResult[]; query: string }>(`/catalog-search?q=${encodeURIComponent(q)}`),
  listCatalogs: () => request<{ catalogs: Catalog[] }>('/catalogs'),
  listSchemas: (catalog: string) =>
    request<{ schemas: Schema[] }>(`/catalogs/${catalog}/schemas`),
  listTables: (catalog: string, schema: string) =>
    request<{ tables: Table[] }>(`/catalogs/${catalog}/schemas/${schema}/tables`),
  listWarehouses: () => request<{ warehouses: Warehouse[] }>('/warehouses'),
  startWarehouse: (warehouseId: string) =>
    request<{ started: boolean }>(`/warehouses/${warehouseId}/start`, { method: 'POST' }),

  getCurrentUser: () => request<CurrentUser>('/me'),
  getServices: () => request<{ services: ServiceStatus[] }>('/services'),
  listGenieRooms: () => request<{ rooms: GenieRoom[] }>('/genie/rooms'),
  createGenieRoom: (data: {
    title: string;
    description: string;
    table_identifiers: string[];
    warehouse_id?: string;
    sample_queries?: { question: string; sql: string }[];
    instructions?: string;
  }) => request<any>('/genie/rooms', { method: 'POST', body: JSON.stringify(data) }),
  getGenieRoom: (id: string) => request<GenieRoomDetail>(`/genie/rooms/${id}`),
  updateGenieRoom: (id: string, data: {
    title?: string;
    description?: string;
    table_identifiers?: string[];
    warehouse_id?: string;
    sample_queries?: { question: string; sql: string }[];
    instructions?: string;
  }) => request<GenieRoomDetail>(`/genie/rooms/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteGenieRoom: (id: string) => request<{ deleted: boolean }>(`/genie/rooms/${id}`, { method: 'DELETE' }),

  // Saved questions (Lakebase)
  listSavedQuestions: (roomId: string) =>
    request<{ questions: SavedQuestion[]; db_available: boolean }>(`/saved-questions/${roomId}`),
  saveQuestion: (data: { room_id: string; question: string; sql: string }) =>
    request<{ id: string; saved: boolean }>('/saved-questions', { method: 'POST', body: JSON.stringify(data) }),
  deleteSavedQuestion: (id: string) =>
    request<{ deleted: boolean }>(`/saved-questions/${id}`, { method: 'DELETE' }),

  // Chat history (Lakebase)
  getChatHistory: (roomId: string, userId: string) =>
    request<{ messages: ChatHistoryMessage[]; db_available: boolean }>(
      `/chat-history/${roomId}?user_id=${encodeURIComponent(userId)}`
    ),
  saveChatMessage: (data: {
    room_id: string;
    user_id: string;
    role: string;
    content: string;
    sql_text?: string;
    query_result?: any;
    description?: string;
    status?: string;
    user_question?: string;
  }) =>
    request<{ id: string; saved: boolean }>('/chat-history', { method: 'POST', body: JSON.stringify(data) }),
  clearChatHistory: (roomId: string, userId: string) =>
    request<{ cleared: boolean }>(`/chat-history/${roomId}?user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' }),

  executeSql: (warehouse_id: string, statement: string) =>
    request<any>('/execute-sql', {
      method: 'POST',
      body: JSON.stringify({ warehouse_id, statement }),
    }),

  startConversation: (roomId: string, content: string) =>
    request<any>(`/genie/rooms/${roomId}/conversations`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),
  sendMessage: (roomId: string, conversationId: string, content: string) =>
    request<any>(`/genie/rooms/${roomId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ content }),
    }),

  supervisorAsk: (data: {
    question: string;
    room_ids: string[];
    room_descriptions: { id: string; title: string; description: string }[];
    conversation_state?: Record<string, string>;
    recursion_limit?: number;
  }) =>
    request<{
      answer: string;
      routed_to: {
        room_id: string;
        room_title: string;
        room_description?: string;
        status: string;
        text: string;
        query: string;
        description: string;
        query_result: any;
      }[];
      routing_reasoning?: string;
      recursion_limit_used?: number;
      conversation_state: Record<string, string>;
    }>('/supervisor/ask', { method: 'POST', body: JSON.stringify(data) }),

  // Cache endpoints (Lakebase-backed, fast reads)
  cacheStatus: () => request<{
    available: boolean;
    rooms?: number;
    tables?: number;
    last_room_sync?: string | null;
    last_table_sync?: string | null;
  }>('/cache/status'),
  cacheInit: () => request<any>('/cache/init', { method: 'POST' }),
  cacheSyncRooms: () => request<{ status: string; rooms_synced: number }>('/cache/sync-rooms', { method: 'POST' }),
  cacheSyncTables: () => request<{ status: string; tables_synced: number }>('/cache/sync-tables', { method: 'POST' }),
  cachedRooms: () => request<{ rooms: GenieRoom[] }>('/cache/rooms'),
  cachedTables: (params?: { catalog?: string; schema?: string; q?: string; limit?: number }) => {
    const sp = new URLSearchParams();
    if (params?.catalog) sp.set('catalog', params.catalog);
    if (params?.schema) sp.set('schema', params.schema);
    if (params?.q) sp.set('q', params.q);
    if (params?.limit) sp.set('limit', String(params.limit));
    const qs = sp.toString();
    return request<{ tables: CachedTable[] }>(`/cache/tables${qs ? `?${qs}` : ''}`);
  },
  cachedCatalogs: () => request<{ catalogs: string[] }>('/cache/catalogs'),
  cachedSchemas: (catalog: string) =>
    request<{ schemas: string[] }>(`/cache/schemas?catalog=${encodeURIComponent(catalog)}`),

  // Workspace files
  listWorkspacePath: (path: string) =>
    request<WorkspaceListResult>(`/workspace/list?path=${encodeURIComponent(path)}`),
  readWorkspaceFile: (path: string) =>
    request<{ path: string; content: string }>(`/workspace/read?path=${encodeURIComponent(path)}`),

  // Analysis endpoints
  validateDescriptions: (table_identifiers: string[]) =>
    request<DescriptionValidation>('/analysis/validate-descriptions', {
      method: 'POST',
      body: JSON.stringify({ table_identifiers }),
    }),
  edaAnalysis: (table_identifiers: string[], warehouse_id?: string) =>
    request<EdaResult>('/analysis/eda', {
      method: 'POST',
      body: JSON.stringify({ table_identifiers, warehouse_id }),
    }),
  summaryStats: (table_identifiers: string[], warehouse_id?: string) =>
    request<SummaryStatsResult>('/analysis/summary-stats', {
      method: 'POST',
      body: JSON.stringify({ table_identifiers, warehouse_id }),
    }),
  timeRanges: (table_identifiers: string[], warehouse_id: string) =>
    request<TimeRangesResult>('/analysis/time-ranges', {
      method: 'POST',
      body: JSON.stringify({ table_identifiers, warehouse_id }),
    }),
  datasetDescription: (table_identifiers: string[], warehouse_id?: string) =>
    request<{ description: string }>('/analysis/dataset-description', {
      method: 'POST',
      body: JSON.stringify({ table_identifiers, warehouse_id }),
    }),
  generateDescriptions: (data: {
    full_name: string;
    table_name: string;
    columns: { name: string; type: string; comment: string }[];
    existing_comment?: string;
  }) =>
    request<{ table_description: string; columns: Record<string, string> }>('/analysis/generate-descriptions', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  updateTableDescription: (full_name: string, comment: string, warehouse_id: string) =>
    request<{ status: string }>('/analysis/update-table-description', {
      method: 'POST',
      body: JSON.stringify({ full_name, comment, warehouse_id }),
    }),
  updateColumnDescription: (full_name: string, column_name: string, comment: string, warehouse_id: string) =>
    request<{ status: string }>('/analysis/update-column-description', {
      method: 'POST',
      body: JSON.stringify({ full_name, column_name, comment, warehouse_id }),
    }),

  // Semantic cache
  semanticCacheLookup: (room_id: string, query: string, similarity_threshold?: number) =>
    request<SemanticCacheResult>('/semantic-cache/lookup', {
      method: 'POST',
      body: JSON.stringify({ room_id, query, ...(similarity_threshold != null && { similarity_threshold }) }),
    }),
  semanticCacheSet: (room_id: string, query: string, response: string, metadata?: Record<string, any>) =>
    request<{ id: number; cached: boolean }>('/semantic-cache/set', {
      method: 'POST',
      body: JSON.stringify({ room_id, query, response, metadata }),
    }),
  semanticCacheSearch: (room_id: string, query: string, top_k?: number) =>
    request<{ results: SemanticCacheEntry[] }>('/semantic-cache/search', {
      method: 'POST',
      body: JSON.stringify({ room_id, query, top_k: top_k ?? 5 }),
    }),
  semanticCacheStats: (room_id?: string) =>
    request<SemanticCacheStats>(`/semantic-cache/stats${room_id ? `?room_id=${encodeURIComponent(room_id)}` : ''}`),
  semanticCacheInit: () =>
    request<{ ready: boolean }>('/semantic-cache/init', { method: 'POST' }),
  semanticCacheDeleteRoom: (room_id: string) =>
    request<{ cleared: number }>(`/semantic-cache/room/${room_id}`, { method: 'DELETE' }),

  // Sample data generation
  sampleDataIndustries: () =>
    request<{ industries: SampleIndustry[] }>('/sample-data/industries'),
  sampleDataCreateSchema: (data: {
    industry: string; catalog: string; schema_name: string;
    create_schema: boolean; warehouse_id: string;
    date_start: string; date_end: string; row_count: number;
  }) =>
    request<{ results: { action: string; status: string; error: string }[] }>(
      '/sample-data/create-schema', { method: 'POST', body: JSON.stringify(data) }
    ),
  sampleDataGenerateTable: (data: {
    industry: string; table_name: string; all_tables: string[];
    catalog: string; schema_name: string;
    date_start: string; date_end: string; row_count: number;
    warehouse_id: string; include_descriptions?: boolean;
  }) =>
    request<{ table: string; status: string; sql_preview: string; executed: any[] }>(
      '/sample-data/generate-table', { method: 'POST', body: JSON.stringify(data) }
    ),
};

export interface DescriptionValidation {
  tables: {
    full_name: string;
    table_name?: string;
    has_table_comment?: boolean;
    table_comment?: string;
    total_columns?: number;
    described_columns?: number;
    missing_columns?: string[];
    columns?: { name: string; type: string; comment: string; has_comment: boolean }[];
    error?: string;
  }[];
  summary: {
    total_tables: number;
    tables_with_description: number;
    total_columns: number;
    columns_with_description: number;
    description_coverage: number;
  };
}

export interface EdaResult {
  summary: string;
  tables: {
    full_name: string;
    name: string;
    table_type: string;
    comment: string;
    column_count: number;
    row_count: number | null;
    error?: string;
  }[];
}

export interface WorkspaceItem {
  path: string;
  name: string;
  type: string; // DIRECTORY, FILE, NOTEBOOK
  language: string;
  is_sql: boolean;
}

export interface WorkspaceListResult {
  path: string;
  items: WorkspaceItem[];
  error?: string;
}

export interface SummaryStatsResult {
  tables: {
    full_name: string;
    name: string;
    table_type: string;
    comment: string;
    column_count: number;
    row_count: number | null;
    column_types: Record<string, number>;
    error?: string;
  }[];
}

export interface TimeRangesResult {
  tables: {
    full_name: string;
    name: string;
    time_columns: {
      column: string;
      type: string;
      min: string | null;
      max: string | null;
      error?: string;
    }[];
    error?: string;
  }[];
}

export interface ServiceStatus {
  name: string;
  type: string;
  status: 'connected' | 'error' | 'unavailable';
  details?: Record<string, any>;
  error?: string;
}

export interface SemanticCacheResult {
  hit: boolean;
  response: string | null;
  similarity: number;
  metadata: Record<string, any>;
}

export interface SemanticCacheEntry {
  id: number;
  query_text: string;
  response: string;
  metadata: Record<string, any>;
  similarity: number;
  hit_count: number;
  created_at: string | null;
  last_accessed_at: string | null;
}

export interface SemanticCacheStats {
  total_entries: number;
  total_hits: number;
  avg_hits_per_entry: number;
  oldest_entry: string | null;
  most_recent_access: string | null;
}

export interface SampleIndustry {
  id: string;
  label: string;
  description: string;
  tables: string[];
}

export interface CachedTable {
  full_name: string;
  name: string;
  catalog: string;
  schema: string;
  table_type: string;
  comment: string;
  columns: Column[];
}
