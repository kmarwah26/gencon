# Genie-Force - AI/BI Genie Room Manager

A full-stack Databricks App that streamlines creating, managing, and chatting with AI/BI Genie Rooms. Generate sample datasets, build rooms with AI-assisted metadata, cache frequently asked questions with semantic search, and route questions across multiple rooms with a supervisor agent.

![Databricks App](https://img.shields.io/badge/Databricks-App-orange)
![Python](https://img.shields.io/badge/Python-3.11+-blue)
![React](https://img.shields.io/badge/React-19-61DAFB)

## What It Does

### Genie Room Creation

Building a high-quality Genie Room requires well-described tables, clear instructions, and sample queries. Genie-Force automates this with a **5-step creation wizard**:

1. **Setup** -- Pick a name and select tables from Unity Catalog (with search and browse)
2. **Descriptions** -- Validate which tables and columns already have metadata. For any gaps, AI generates descriptions using Foundation Models and writes them directly to Unity Catalog
3. **Analysis** -- Run EDA (row counts, column types, time ranges) to understand the dataset before configuring the room
4. **Instructions** -- Add natural-language instructions and sample question/SQL pairs so Genie knows how to answer
5. **Create** -- Review everything and create the room in one click

You can also **edit existing rooms** -- add/remove tables, update instructions, and manage sample queries after creation.

### Sample Data Generator

Need data to demo or test Genie Rooms? The **Sample Data Generator** creates realistic, industry-specific datasets directly in Unity Catalog:

- **6 industries**: Retail, Finance, Supply Chain, Manufacturing, Healthcare, Telecom
- Each industry generates 5-6 related tables with consistent foreign keys
- **Configurable**: choose the target catalog/schema (or create a new one), date range, and row count
- **Optional AI-generated metadata**: toggle whether tables and columns get descriptive COMMENTs -- useful for testing Genie with and without metadata

### Semantic Cache

Every Genie Room gets a **semantic cache** powered by pgvector on Lakebase. When a user asks a question:

1. The query is embedded using Databricks BGE-large-en (1024 dimensions)
2. A cosine similarity search finds the closest previously asked question in that room's cache
3. If the similarity exceeds the threshold (default 0.85), the cached response is returned instantly -- no Genie API call needed
4. On a cache miss, the Genie response is stored for future lookups

This means your team's frequently asked questions get faster over time. The cache is **room-scoped** so each Genie Room has its own namespace, and you can view hit rates, entry counts, and manage the cache from the chat sidebar.

### Supervisor Agent

The **Supervisor Agent** lets users ask a single question and have it automatically routed to the most relevant Genie Room. It uses a LangGraph supervisor with a Claude-powered LLM to:

- Evaluate all selected rooms against the question
- Route to the best-matching room based on room descriptions
- Show a visual routing flow: which rooms were considered, which was selected, and why
- Display the Genie response with any generated SQL and query results

### Chat

The chat interface supports single-room conversations with:

- SQL query display (collapsible) and tabular result rendering
- Semantic cache hit indicators with similarity scores
- Saved questions (curated Q&A per room, stored in Lakebase)
- Full chat history per user per room

## Quick Start

### Local Development

```bash
git clone https://github.com/kmarwah26/gencon.git
cd gencon

pip install -r requirements.txt        # or: uv sync
cd frontend && npm install && cd ..    # only if modifying frontend

databricks auth login --host https://<workspace-url> --profile gencon
DATABRICKS_PROFILE=gencon uvicorn app:app --reload --port 8000
```

Open http://localhost:8000

### Deploy to Databricks

Three options:

| Method | Guide | Best for |
|--------|-------|----------|
| **Automated Notebook** | [docs/deploy_genco.py](docs/deploy_genco.py) | One-click setup (recommended) |
| **Databricks CLI** | [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Full control, CLI users |
| **Workspace UI + Git** | [docs/DEPLOYMENT_WORKSPACE.md](docs/DEPLOYMENT_WORKSPACE.md) | Browser-only, no local tools |

The notebook handles everything: Lakebase instance, database, app creation, service principal permissions (Genie rooms, Unity Catalog, Lakebase), and deployment.

### Prerequisites

- Databricks workspace with Unity Catalog and serverless compute
- Databricks CLI v0.229+ (for CLI deployment)
- Python 3.11+, Node.js 18+ (for local development)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | FastAPI, asyncpg, Databricks SDK |
| **Frontend** | React 19, TypeScript, Tailwind CSS, Vite |
| **Database** | Lakebase (managed PostgreSQL + pgvector) |
| **AI/ML** | Databricks Foundation Models, LangGraph, LangChain |
| **Embeddings** | Databricks BGE-large-en (1024 dimensions) |
| **Deployment** | Databricks Apps (serverless) |

## License

Internal use.
