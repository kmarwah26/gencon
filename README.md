# Genco - AI/BI Genie Room Manager

A full-stack Databricks App for managing Genie rooms: browse Unity Catalog, create rooms with AI-assisted metadata, chat with Genie, and route questions across multiple rooms with a supervisor agent.

![Databricks App](https://img.shields.io/badge/Databricks-App-orange)
![Python](https://img.shields.io/badge/Python-3.11+-blue)
![React](https://img.shields.io/badge/React-19-61DAFB)

## Features

- **Catalog Explorer** — Browse Unity Catalog hierarchy (catalogs, schemas, tables) with search and cached fallback via Lakebase
- **Create Genie Room** — 5-step wizard: setup, description validation, EDA analysis, SQL instructions, review & create
- **AI Description Generator** — Generate table and column descriptions using Foundation Models (Claude Sonnet 4.5 via Databricks), save directly to Unity Catalog
- **Genie Chat** — Chat interface for any Genie room with SQL results display, saved questions, chat history, and semantic cache lookups
- **Supervisor Agent** — Route questions across multiple Genie rooms with LLM-powered routing (LangGraph) and result synthesis
- **Semantic Cache** — pgvector-based query caching with Databricks BGE-large embeddings to avoid redundant Genie queries
- **Services Dashboard** — Monitor connectivity to Workspace, Unity Catalog, SQL Warehouses, Genie, Lakebase, and Foundation Models
- **Lakebase Persistence** — Saved questions, chat history, room/table cache, and semantic cache stored in managed PostgreSQL

## Architecture

```
gencon/
├── app.py                          # FastAPI entry point (mounts frontend + all API routers)
├── app.yaml                        # Databricks App config (uvicorn, Lakebase resource)
├── requirements.txt                # Python deps (for deployment)
├── pyproject.toml                  # Python project config (uv)
├── server/
│   ├── config.py                   # Dual-mode auth (local CLI profile / deployed service principal)
│   ├── db.py                       # Async Lakebase connection pool (asyncpg + auto token refresh)
│   └── routes/
│       ├── analysis.py             # Description validation, EDA, AI generation
│       ├── cache.py                # Lakebase cache init, sync rooms/tables
│       ├── catalog.py              # Unity Catalog browsing + cached search
│       ├── chat_history.py         # Per-user chat message persistence
│       ├── genie.py                # Genie room CRUD, chat, SQL execution
│       ├── saved_questions.py      # Per-room saved Q&A
│       ├── semantic_cache.py       # Semantic cache API routes
│       ├── supervisor.py           # Multi-room LangGraph supervisor agent
│       ├── user.py                 # Current user + services status
│       ├── warehouses.py           # SQL warehouse listing + start
│       └── workspace_files.py      # Browse/read workspace files
│   └── semantic_cache/
│       ├── cache.py                # SemanticCache class (room-scoped, cosine similarity)
│       ├── embeddings.py           # Databricks BGE-large embedding model
│       └── setup.py                # pgvector extension + table creation
├── frontend/
│   ├── src/                        # React 19 + TypeScript + Tailwind CSS + Vite
│   │   ├── App.tsx                 # Routes and home page
│   │   ├── api.ts                  # Type-safe API client
│   │   ├── store.ts                # Zustand state management
│   │   └── pages/                  # CatalogExplorer, CreateRoom, GenieChat, SupervisorChat, etc.
│   └── dist/                       # Built frontend (committed for deployment)
├── docs/
│   ├── DEPLOYMENT.md               # CLI-based step-by-step deployment guide
│   ├── DEPLOYMENT_WORKSPACE.md     # Workspace-only deployment (no local tools needed)
│   └── deploy_genco.py             # Databricks notebook for fully automated setup
```

## Prerequisites

- **Databricks workspace** with Unity Catalog and serverless compute enabled
- **Databricks CLI** v0.229+ authenticated to your workspace
- **Python** 3.11+
- **Node.js** 18+ and npm (only needed for frontend development)
- **uv** (recommended) or pip for Python dependency management

## Quick Start (Local Development)

### 1. Clone and install

```bash
git clone https://github.com/kmarwah26/gencon.git
cd gencon

# Python dependencies
pip install -r requirements.txt
# or with uv:
uv sync

# Frontend dependencies (only needed if modifying frontend)
cd frontend && npm install && cd ..
```

### 2. Authenticate with Databricks

```bash
databricks auth login --host https://<workspace-url> --profile gencon
```

### 3. Run locally

```bash
DATABRICKS_PROFILE=gencon uvicorn app:app --reload --port 8000
```

Open http://localhost:8000

### 4. (Optional) Frontend development

To modify the frontend with hot reload:

```bash
cd frontend
npm run dev   # Runs on port 5173 with proxy to :8000
```

After making changes, rebuild:

```bash
cd frontend && npm run build
```

## Deployment

Three deployment options are available:

| Method | Guide | Best for |
|--------|-------|----------|
| **Databricks CLI** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Full control, experienced CLI users |
| **Workspace UI + Git** | [docs/DEPLOYMENT_WORKSPACE.md](docs/DEPLOYMENT_WORKSPACE.md) | No local tools needed, browser-only |
| **Automated Notebook** | [docs/deploy_genco.py](docs/deploy_genco.py) | One-click setup, handles permissions automatically |

The notebook method is recommended for first-time deployment — it automatically:
- Creates the Lakebase instance and database
- Creates the Databricks App
- Mirrors your Genie room permissions to the app's service principal
- Grants Unity Catalog access to the service principal
- Attaches Lakebase as a connected resource
- Deploys the app

## Configuration

### Environment Variables

| Variable | Source | Description |
|----------|--------|-------------|
| `DATABRICKS_PROFILE` | Local only | CLI profile name |
| `DATABRICKS_HOST` | Auto (deployed) | Workspace hostname |
| `DATABRICKS_APP_NAME` | Auto (deployed) | Indicates deployed mode |
| `PGHOST` | Lakebase resource | Database host |
| `PGPORT` | Lakebase resource | Database port (5432) |
| `PGDATABASE` | Lakebase resource | Database name |
| `PGUSER` | Lakebase resource | Database user (service principal) |
| `PGSSLMODE` | app.yaml | SSL mode (require) |

### app.yaml

The `app.yaml` configures the Databricks App runtime:
- **Command:** `uvicorn app:app --host 0.0.0.0 --port 8000`
- **Resource:** Lakebase instance `genco-cache` with database `genco`
- **Env vars:** `PGHOST` is injected from the Lakebase resource; `PGPORT`, `PGDATABASE`, and `PGSSLMODE` are set as static values

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/me` | GET | Current user info |
| `/api/services` | GET | Connected services status |
| `/api/catalogs` | GET | List Unity Catalogs |
| `/api/catalogs/{cat}/schemas` | GET | List schemas in a catalog |
| `/api/catalogs/{cat}/schemas/{sch}/tables` | GET | List tables in a schema |
| `/api/catalog-search?q=` | GET | Search tables by name or namespace |
| `/api/warehouses` | GET | List SQL warehouses |
| `/api/warehouses/{id}/start` | POST | Start a SQL warehouse |
| `/api/genie/rooms` | GET/POST | List or create Genie rooms |
| `/api/genie/rooms/{id}` | GET/PUT/DELETE | Get, update, or delete a room |
| `/api/genie/rooms/{id}/conversations` | POST | Start a conversation |
| `/api/execute-sql` | POST | Execute SQL via warehouse |
| `/api/analysis/validate-descriptions` | POST | Check description coverage |
| `/api/analysis/generate-descriptions` | POST | AI-generate table/column descriptions |
| `/api/analysis/eda` | POST | Metadata analysis |
| `/api/analysis/update-table-description` | POST | Update table description in UC |
| `/api/analysis/update-column-description` | POST | Update column description in UC |
| `/api/supervisor/ask` | POST | Multi-room supervisor query |
| `/api/cache/init` | POST | Initialize Lakebase cache tables |
| `/api/cache/sync-rooms` | POST | Sync Genie rooms to cache |
| `/api/cache/sync-tables` | POST | Sync catalog tables to cache |
| `/api/cache/rooms` | GET | Get cached rooms |
| `/api/cache/tables` | GET | Get cached tables |
| `/api/saved-questions/{room_id}` | GET/POST | List or add saved questions for a room |
| `/api/chat-history/{room_id}` | GET/POST | List or add chat messages for a room |
| `/api/semantic-cache/init` | POST | Initialize semantic cache (pgvector) |
| `/api/semantic-cache/set` | POST | Store query/response in cache |
| `/api/semantic-cache/lookup` | POST | Look up similar cached query |
| `/api/semantic-cache/search` | POST | Search cached queries |
| `/api/semantic-cache/stats` | GET | Cache statistics |
| `/api/workspace/list` | GET | List workspace files |
| `/api/workspace/read` | GET | Read a workspace file |
| `/api/db-health` | GET | Lakebase connectivity diagnostic |

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, asyncpg, Databricks SDK |
| **Frontend** | React 19, TypeScript, Tailwind CSS, Vite, Zustand |
| **Database** | Lakebase (managed PostgreSQL + pgvector) |
| **AI/ML** | Databricks Foundation Models, LangGraph, LangChain |
| **Embeddings** | Databricks BGE-large-en (1024 dimensions) |
| **Deployment** | Databricks Apps (serverless) |

## License

Internal use.
