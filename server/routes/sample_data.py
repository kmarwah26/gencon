"""
Sample Data Generator — creates realistic industry-specific tables in Unity Catalog.
"""

import json
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
    """Generate a single table using LLM-produced SQL."""
    industry_info = INDUSTRIES.get(req.industry)
    if not industry_info:
        raise HTTPException(status_code=400, detail=f"Unknown industry: {req.industry}")

    full_schema = f"{req.catalog}.{req.schema_name}"

    desc_instruction = ""
    if req.include_descriptions:
        desc_instruction = """
7. Add a COMMENT on the table describing its purpose
8. Add COMMENT on each column in the CREATE TABLE definition using the COMMENT keyword after the type
   Example: column_name STRING COMMENT 'Description of this column'
"""
    else:
        desc_instruction = """
7. Do NOT add any COMMENT clauses on the table or columns — leave metadata empty.
"""

    prompt = f"""You are a data engineer creating realistic sample data for a {industry_info['label']} company.

Generate a SQL statement that:
1. Creates (using CREATE TABLE IF NOT EXISTS) and populates the table `{full_schema}.{req.table_name}`
2. Uses INSERT INTO with realistic, diverse sample data
3. Date/timestamp values should be between '{req.date_start}' and '{req.date_end}'
4. Generate approximately {req.row_count} rows
5. Include realistic names, amounts, statuses, and other domain-appropriate values
6. Use appropriate Databricks SQL types (STRING, INT, BIGINT, DOUBLE, DECIMAL(10,2), DATE, TIMESTAMP)
{desc_instruction}
The other tables in this schema are: {', '.join(req.all_tables)}.
Use consistent foreign key references (e.g., customer_id in orders should reference IDs in customers).

Return ONLY the SQL — no markdown, no explanation, no code fences. The SQL should be a complete executable statement.
First CREATE TABLE IF NOT EXISTS with the column definitions, then INSERT INTO with the data.
Use Databricks SQL syntax (not PostgreSQL or MySQL)."""

    try:
        llm = ChatDatabricks(endpoint=LLM_ENDPOINT)
        response = llm.invoke(prompt)
        sql = response.content.strip()

        # Clean up any markdown fences the LLM may have added
        if sql.startswith("```"):
            lines = sql.split("\n")
            sql = "\n".join(lines[1:-1] if lines[-1].strip() == "```" else lines[1:])

        # Split into individual statements and execute each
        statements = [s.strip() for s in sql.split(";") if s.strip()]

        host = get_workspace_host()
        headers = get_auth_headers()

        executed = []
        for stmt in statements:
            async with httpx.AsyncClient(timeout=120) as client:
                resp = await client.post(
                    f"{host}/api/2.0/sql/statements",
                    headers=headers,
                    json={
                        "warehouse_id": req.warehouse_id,
                        "statement": stmt,
                        "wait_timeout": "60s",
                    },
                )
                data = resp.json()
                status = data.get("status", {}).get("state", "")

                # Poll if pending
                stmt_id = data.get("statement_id", "")
                if status == "PENDING" and stmt_id:
                    import asyncio
                    for _ in range(60):
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
                executed.append({
                    "statement": stmt[:200] + ("..." if len(stmt) > 200 else ""),
                    "status": status,
                    "error": error_msg,
                })

        return {
            "table": f"{full_schema}.{req.table_name}",
            "status": "COMPLETED" if all(e["status"] == "SUCCEEDED" for e in executed) else "PARTIAL",
            "sql_preview": sql[:500],
            "executed": executed,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sample-data/create-schema")
async def create_schema(req: GenerateRequest):
    """Create catalog and/or schema if they don't exist."""
    host = get_workspace_host()
    headers = get_auth_headers()

    results = []
    try:
        async with httpx.AsyncClient(timeout=60) as client:
            # Create schema
            resp = await client.post(
                f"{host}/api/2.0/sql/statements",
                headers=headers,
                json={
                    "warehouse_id": req.warehouse_id,
                    "statement": f"CREATE SCHEMA IF NOT EXISTS {req.catalog}.{req.schema_name}",
                    "wait_timeout": "30s",
                },
            )
            data = resp.json()
            results.append({
                "action": f"CREATE SCHEMA {req.catalog}.{req.schema_name}",
                "status": data.get("status", {}).get("state", ""),
                "error": data.get("status", {}).get("error", {}).get("message", ""),
            })

        return {"results": results}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
