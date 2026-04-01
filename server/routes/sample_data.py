"""
Sample Data Generator — creates realistic industry-specific tables in Unity Catalog.
"""

import asyncio
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from databricks_langchain import ChatDatabricks
from server.config import get_workspace_host, get_auth_headers
import httpx

router = APIRouter(tags=["sample-data"])

LLM_ENDPOINT = "databricks-claude-sonnet-4-5"

# ── Industry templates ──

INDUSTRIES = {
    "retail": {
        "label": "Retail & E-Commerce",
        "description": "Customer orders, products, inventory, and store performance data",
        "tables": ["customers", "products", "orders", "order_items", "stores", "inventory"],
    },
    "finance": {
        "label": "Finance & Banking",
        "description": "Accounts, transactions, loans, and customer portfolio data",
        "tables": ["accounts", "transactions", "customers", "loans", "payments", "branches"],
    },
    "supply_chain": {
        "label": "Supply Chain & Logistics",
        "description": "Suppliers, shipments, warehouses, and procurement data",
        "tables": ["suppliers", "purchase_orders", "shipments", "warehouses", "inventory", "delivery_routes"],
    },
    "manufacturing": {
        "label": "Manufacturing",
        "description": "Production lines, equipment, quality inspections, and work orders",
        "tables": ["production_lines", "work_orders", "equipment", "quality_inspections", "raw_materials", "finished_goods"],
    },
    "healthcare": {
        "label": "Healthcare",
        "description": "Patients, appointments, providers, and billing data",
        "tables": ["patients", "appointments", "providers", "diagnoses", "prescriptions", "billing"],
    },
    "telecom": {
        "label": "Telecommunications",
        "description": "Subscribers, plans, usage, support tickets, and network data",
        "tables": ["subscribers", "plans", "usage_records", "support_tickets", "network_towers", "billing"],
    },
}


class GenerateRequest(BaseModel):
    industry: str
    catalog: str
    schema_name: str
    create_schema: bool = False
    date_start: str = "2024-01-01"
    date_end: str = "2024-12-31"
    row_count: int = 1000
    warehouse_id: str


class GenerateTableRequest(BaseModel):
    industry: str
    table_name: str
    all_tables: list[str]
    catalog: str
    schema_name: str
    date_start: str
    date_end: str
    row_count: int
    warehouse_id: str
    include_descriptions: bool = False


# ── SQL execution helper ──

async def _execute_sql(warehouse_id: str, statement: str, timeout_secs: int = 120) -> dict:
    """Execute a SQL statement via the Statements API with polling."""
    host = get_workspace_host()
    headers = get_auth_headers()

    async with httpx.AsyncClient(timeout=timeout_secs) as client:
        resp = await client.post(
            f"{host}/api/2.0/sql/statements",
            headers=headers,
            json={
                "warehouse_id": warehouse_id,
                "statement": statement,
                "wait_timeout": "0s",  # async — always poll
            },
        )
        data = resp.json()
        stmt_id = data.get("statement_id", "")
        status = data.get("status", {}).get("state", "")

        # Poll until done
        if stmt_id and status in ("PENDING", "RUNNING"):
            for _ in range(90):
                await asyncio.sleep(2)
                poll_resp = await client.get(
                    f"{host}/api/2.0/sql/statements/{stmt_id}",
                    headers=headers,
                )
                if poll_resp.status_code == 200:
                    data = poll_resp.json()
                    status = data.get("status", {}).get("state", "")
                    if status in ("SUCCEEDED", "FAILED", "CANCELED", "CLOSED"):
                        break

        error_msg = data.get("status", {}).get("error", {}).get("message", "")
        return {"status": status, "error": error_msg, "data": data}


# ── Endpoints ──


@router.get("/sample-data/industries")
async def list_industries():
    return {
        "industries": [
            {"id": k, "label": v["label"], "description": v["description"], "tables": v["tables"]}
            for k, v in INDUSTRIES.items()
        ]
    }


@router.post("/sample-data/generate-table")
async def generate_table(req: GenerateTableRequest):
    """Generate a single table: LLM creates schema + seed rows, SQL scales to target count."""
    industry_info = INDUSTRIES.get(req.industry)
    if not industry_info:
        raise HTTPException(status_code=400, detail=f"Unknown industry: {req.industry}")

    full_schema = f"{req.catalog}.{req.schema_name}"
    full_table = f"{full_schema}.{req.table_name}"

    # Determine seed size — LLM generates a small seed, SQL scales up
    seed_rows = min(req.row_count, 10)

    desc_instruction = ""
    if req.include_descriptions:
        desc_instruction = (
            "- Add a COMMENT on the table describing its purpose.\n"
            "- Add COMMENT on each column using: column_name TYPE COMMENT 'description'\n"
        )
    else:
        desc_instruction = "- Do NOT add any COMMENT clauses on the table or columns.\n"

    prompt = f"""Generate Databricks SQL for a {industry_info['label']} "{req.table_name}" table.

Requirements:
- CREATE TABLE IF NOT EXISTS {full_table} (6-10 columns, Databricks types: STRING, INT, DECIMAL(10,2), DATE, TIMESTAMP, DOUBLE)
- INSERT INTO {full_table} VALUES with exactly {seed_rows} rows of realistic data
- Dates between '{req.date_start}' and '{req.date_end}'
- First column: integer ID starting from 1
- Related tables: {', '.join(req.all_tables)} (use consistent FK IDs 1-{seed_rows})
{desc_instruction}
Rules: Return ONLY raw SQL, no markdown/fences/explanation. Semicolons between statements. No backticks around table names. Databricks SQL only."""

    try:
        # Step 1: LLM generates CREATE TABLE + seed INSERT
        llm = ChatDatabricks(endpoint=LLM_ENDPOINT)
        response = await asyncio.to_thread(llm.invoke, prompt)
        sql = response.content.strip()

        # Clean markdown fences
        if sql.startswith("```"):
            lines = sql.split("\n")
            sql = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])
        sql = sql.strip().rstrip("`")

        # Remove backticks around the full table name (LLM sometimes adds them)
        sql = sql.replace(f"`{full_table}`", full_table)
        sql = sql.replace(f"`{full_schema}`", full_schema)

        # Split into statements
        statements = [s.strip() for s in sql.split(";") if s.strip()]
        if not statements:
            raise HTTPException(status_code=500, detail="LLM produced no SQL statements")

        # Step 2: Execute CREATE TABLE
        create_stmt = statements[0]
        result = await _execute_sql(req.warehouse_id, create_stmt)
        if result["status"] != "SUCCEEDED":
            return {
                "table": full_table,
                "status": "FAILED",
                "sql_preview": create_stmt[:500],
                "error": f"CREATE TABLE failed: {result['error']}",
                "executed": [{"statement": "CREATE TABLE", "status": result["status"], "error": result["error"]}],
            }

        # Step 3: Execute INSERT (seed rows)
        executed = [{"statement": "CREATE TABLE", "status": "SUCCEEDED", "error": ""}]

        for stmt in statements[1:]:
            if not stmt.strip().upper().startswith(("INSERT", "ALTER")):
                continue
            result = await _execute_sql(req.warehouse_id, stmt)
            executed.append({
                "statement": stmt[:100] + "...",
                "status": result["status"],
                "error": result["error"],
            })
            if result["status"] != "SUCCEEDED":
                return {
                    "table": full_table,
                    "status": "FAILED",
                    "sql_preview": sql[:500],
                    "error": f"INSERT failed: {result['error']}",
                    "executed": executed,
                }

        # Step 4: Scale up to target row count if needed
        if req.row_count > seed_rows:
            multiplier = max(1, req.row_count // seed_rows)
            remaining = req.row_count - seed_rows
            # UNION ALL the table with itself multiple times
            unions = " UNION ALL ".join([f"SELECT * FROM {full_table}"] * min(multiplier, 20))
            scale_sql = f"""
INSERT INTO {full_table}
SELECT * FROM ({unions}) _u
LIMIT {remaining}
"""
            result = await _execute_sql(req.warehouse_id, scale_sql)
            executed.append({
                "statement": f"Scale to ~{req.row_count} rows",
                "status": result["status"],
                "error": result["error"],
            })

        all_succeeded = all(e["status"] == "SUCCEEDED" for e in executed)
        return {
            "table": full_table,
            "status": "COMPLETED" if all_succeeded else "PARTIAL",
            "sql_preview": sql[:500],
            "executed": executed,
        }

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sample-data/create-schema")
async def create_schema(req: GenerateRequest):
    """Create schema if it doesn't exist, then grant CREATE TABLE to the current principal."""
    try:
        results = []

        # Create schema
        result = await _execute_sql(
            req.warehouse_id,
            f"CREATE SCHEMA IF NOT EXISTS {req.catalog}.{req.schema_name}",
        )
        results.append({
            "action": f"CREATE SCHEMA IF NOT EXISTS {req.catalog}.{req.schema_name}",
            "status": result["status"],
            "error": result["error"],
        })

        # Grant permissions on the schema to self (ensures the app SP can create tables)
        # This is a no-op if the principal already owns the schema
        from server.config import get_workspace_client
        try:
            w = get_workspace_client()
            sp_id = w.config.client_id or ""
            if sp_id:
                grant_result = await _execute_sql(
                    req.warehouse_id,
                    f"GRANT CREATE TABLE, USE SCHEMA ON SCHEMA {req.catalog}.{req.schema_name} TO `{sp_id}`",
                )
                results.append({
                    "action": f"GRANT CREATE TABLE on {req.catalog}.{req.schema_name}",
                    "status": grant_result["status"],
                    "error": grant_result["error"],
                })
        except Exception:
            pass  # Best-effort — may not have GRANT permission

        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
