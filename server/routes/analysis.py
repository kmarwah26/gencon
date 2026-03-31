import json
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from openai import AsyncOpenAI
from server.config import get_workspace_client, get_workspace_host, get_auth_headers
import httpx

router = APIRouter(tags=["analysis"])

DEFAULT_MODEL = "databricks-claude-sonnet-4-5"


def _llm_client() -> AsyncOpenAI:
    host = get_workspace_host()
    headers = get_auth_headers()
    token = headers.get("Authorization", "").replace("Bearer ", "")
    return AsyncOpenAI(api_key=token, base_url=f"{host}/serving-endpoints")


class TableListRequest(BaseModel):
    table_identifiers: list[str]
    warehouse_id: str | None = None


class UpdateDescriptionRequest(BaseModel):
    full_name: str  # catalog.schema.table
    comment: str
    warehouse_id: str


class UpdateColumnDescriptionRequest(BaseModel):
    full_name: str  # catalog.schema.table
    column_name: str
    comment: str
    warehouse_id: str


# ── Update descriptions via SQL ──


@router.post("/analysis/update-table-description")
async def update_table_description(req: UpdateDescriptionRequest):
    """Update a table's comment/description using SQL."""
    host = get_workspace_host()
    headers = get_auth_headers()
    # Escape single quotes in comment
    safe_comment = req.comment.replace("'", "''")
    sql = f"COMMENT ON TABLE {req.full_name} IS '{safe_comment}'"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{host}/api/2.0/sql/statements",
                headers=headers,
                json={
                    "warehouse_id": req.warehouse_id,
                    "statement": sql,
                    "wait_timeout": "15s",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            status = data.get("status", {}).get("state", "")
            if status == "FAILED":
                err = data.get("status", {}).get("error", {}).get("message", "Unknown error")
                raise HTTPException(status_code=400, detail=err)
            return {"status": "ok", "full_name": req.full_name}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/analysis/update-column-description")
async def update_column_description(req: UpdateColumnDescriptionRequest):
    """Update a column's comment/description using SQL."""
    host = get_workspace_host()
    headers = get_auth_headers()
    safe_comment = req.comment.replace("'", "''")
    sql = f"ALTER TABLE {req.full_name} ALTER COLUMN `{req.column_name}` COMMENT '{safe_comment}'"
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.post(
                f"{host}/api/2.0/sql/statements",
                headers=headers,
                json={
                    "warehouse_id": req.warehouse_id,
                    "statement": sql,
                    "wait_timeout": "15s",
                },
            )
            resp.raise_for_status()
            data = resp.json()
            status = data.get("status", {}).get("state", "")
            if status == "FAILED":
                err = data.get("status", {}).get("error", {}).get("message", "Unknown error")
                raise HTTPException(status_code=400, detail=err)
            return {"status": "ok", "full_name": req.full_name, "column": req.column_name}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Generate descriptions via LLM ──


class GenerateDescriptionsRequest(BaseModel):
    full_name: str
    table_name: str
    columns: list[dict]  # [{name, type, comment}]
    existing_comment: str = ""


@router.post("/analysis/generate-descriptions")
async def generate_descriptions(req: GenerateDescriptionsRequest):
    """Use LLM to generate table and column descriptions from metadata."""
    col_lines = []
    for c in req.columns:
        line = f"  - {c['name']} ({c.get('type', 'unknown')})"
        if c.get("comment"):
            line += f"  [existing: {c['comment']}]"
        col_lines.append(line)
    col_text = "\n".join(col_lines)

    prompt = (
        f"You are a data documentation specialist. Generate clear, concise descriptions "
        f"for a database table and its columns.\n\n"
        f"Table: {req.full_name}\n"
    )
    if req.existing_comment:
        prompt += f"Current table description: {req.existing_comment}\n"
    prompt += (
        f"\nColumns:\n{col_text}\n\n"
        f"Return a JSON object with:\n"
        f'- "table_description": a 1-2 sentence description of what this table contains and its purpose\n'
        f'- "columns": an object mapping column_name → description (1 short sentence each)\n\n'
        f"For columns that already have descriptions, improve them if needed or keep them.\n"
        f"Be specific and factual based on the naming conventions. Do not be vague.\n"
        f"Return ONLY valid JSON, no markdown fences."
    )

    client = _llm_client()
    try:
        resp = await client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=2048,
            temperature=0.2,
        )
        raw = resp.choices[0].message.content.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()
        if raw.startswith("json"):
            raw = raw[4:].strip()
        result = json.loads(raw)
        return result
    except json.JSONDecodeError:
        return {"table_description": raw, "columns": {}}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Step 2: Validate descriptions ──


@router.post("/analysis/validate-descriptions")
async def validate_descriptions(req: TableListRequest):
    """Check each table and its columns for missing descriptions."""
    w = get_workspace_client()
    results = []

    for full_name in req.table_identifiers:
        parts = full_name.split(".")
        if len(parts) < 3:
            results.append({
                "full_name": full_name,
                "error": "Invalid table name format",
            })
            continue

        catalog, schema, table = parts[0], parts[1], ".".join(parts[2:])
        try:
            t = w.tables.get(full_name)
            cols = t.columns or []
            cols_missing = [
                c.name for c in cols if not c.comment or not c.comment.strip()
            ]
            total_cols = len(cols)
            described_cols = total_cols - len(cols_missing)

            results.append({
                "full_name": full_name,
                "table_name": t.name,
                "has_table_comment": bool(t.comment and t.comment.strip()),
                "table_comment": (t.comment or "").strip(),
                "total_columns": total_cols,
                "described_columns": described_cols,
                "missing_columns": cols_missing,
                "columns": [
                    {
                        "name": c.name,
                        "type": str(c.type_text) if c.type_text else "",
                        "comment": (c.comment or "").strip(),
                        "has_comment": bool(c.comment and c.comment.strip()),
                    }
                    for c in cols
                ],
            })
        except Exception as e:
            results.append({
                "full_name": full_name,
                "error": str(e),
            })

    # Compute summary
    total_tables = len(results)
    tables_with_desc = sum(
        1 for r in results if r.get("has_table_comment", False)
    )
    total_cols = sum(r.get("total_columns", 0) for r in results)
    described_cols = sum(r.get("described_columns", 0) for r in results)

    return {
        "tables": results,
        "summary": {
            "total_tables": total_tables,
            "tables_with_description": tables_with_desc,
            "total_columns": total_cols,
            "columns_with_description": described_cols,
            "description_coverage": round(
                ((tables_with_desc + described_cols) / max(total_tables + total_cols, 1)) * 100, 1
            ),
        },
    }


# ── Shared helpers ──


def _gather_table_metadata(table_identifiers: list[str]):
    """Fetch metadata for a list of tables via Unity Catalog SDK."""
    w = get_workspace_client()
    table_summaries = []
    for full_name in table_identifiers:
        try:
            t = w.tables.get(full_name)
            cols = t.columns or []
            table_summaries.append({
                "full_name": full_name,
                "name": t.name,
                "table_type": str(t.table_type) if t.table_type else "",
                "comment": (t.comment or "").strip(),
                "column_count": len(cols),
                "columns": [
                    {
                        "name": c.name,
                        "type": str(c.type_text) if c.type_text else "unknown",
                        "comment": (c.comment or "").strip(),
                    }
                    for c in cols
                ],
            })
        except Exception as e:
            table_summaries.append({"full_name": full_name, "error": str(e)})
    return table_summaries


async def _run_sql(warehouse_id: str, statement: str):
    """Execute a SQL statement via the SQL Statement API."""
    host = get_workspace_host()
    headers = get_auth_headers()
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(
            f"{host}/api/2.0/sql/statements",
            headers=headers,
            json={
                "warehouse_id": warehouse_id,
                "statement": statement,
                "wait_timeout": "30s",
            },
        )
        if resp.status_code == 200:
            return resp.json()
    return None


# ── Step 3: Analysis (all optional, on-demand) ──


@router.post("/analysis/summary-stats")
async def summary_stats(req: TableListRequest):
    """Get summary stats: row counts, column type distribution per table."""
    table_summaries = _gather_table_metadata(req.table_identifiers)

    results = []
    for ts in table_summaries:
        if ts.get("error"):
            results.append({"full_name": ts["full_name"], "error": ts["error"]})
            continue

        # Column type distribution
        type_counts: dict[str, int] = {}
        for c in ts.get("columns", []):
            base_type = c["type"].split("(")[0].split("<")[0].upper().strip()
            type_counts[base_type] = type_counts.get(base_type, 0) + 1

        entry = {
            "full_name": ts["full_name"],
            "name": ts["name"],
            "table_type": ts["table_type"],
            "comment": ts["comment"],
            "column_count": ts["column_count"],
            "row_count": None,
            "column_types": type_counts,
        }

        # Get row count if warehouse available
        if req.warehouse_id:
            try:
                data = await _run_sql(
                    req.warehouse_id,
                    f"SELECT COUNT(*) as cnt FROM {ts['full_name']}",
                )
                if data:
                    rows = data.get("result", {}).get("data_array", [])
                    if rows and rows[0]:
                        entry["row_count"] = int(rows[0][0])
            except Exception:
                pass

        results.append(entry)

    return {"tables": results}


@router.post("/analysis/time-ranges")
async def time_ranges(req: TableListRequest):
    """Detect date/timestamp columns and query their min/max values."""
    if not req.warehouse_id:
        raise HTTPException(
            status_code=400,
            detail="A SQL warehouse is required to detect time ranges.",
        )

    table_summaries = _gather_table_metadata(req.table_identifiers)
    results = []

    for ts in table_summaries:
        if ts.get("error"):
            results.append({"full_name": ts["full_name"], "error": ts["error"]})
            continue

        # Find date/timestamp columns
        date_cols = [
            c for c in ts.get("columns", [])
            if any(
                dt in c["type"].upper()
                for dt in ["DATE", "TIMESTAMP", "DATETIME"]
            )
        ]

        if not date_cols:
            results.append({
                "full_name": ts["full_name"],
                "name": ts["name"],
                "time_columns": [],
            })
            continue

        time_columns = []
        for col in date_cols:
            try:
                sql = (
                    f"SELECT MIN(`{col['name']}`) as min_val, "
                    f"MAX(`{col['name']}`) as max_val "
                    f"FROM {ts['full_name']} "
                    f"WHERE `{col['name']}` IS NOT NULL"
                )
                data = await _run_sql(req.warehouse_id, sql)
                min_val, max_val = None, None
                if data:
                    rows = data.get("result", {}).get("data_array", [])
                    if rows and rows[0]:
                        min_val = rows[0][0]
                        max_val = rows[0][1] if len(rows[0]) > 1 else None
                time_columns.append({
                    "column": col["name"],
                    "type": col["type"],
                    "min": min_val,
                    "max": max_val,
                })
            except Exception:
                time_columns.append({
                    "column": col["name"],
                    "type": col["type"],
                    "min": None,
                    "max": None,
                    "error": "Failed to query",
                })

        results.append({
            "full_name": ts["full_name"],
            "name": ts["name"],
            "time_columns": time_columns,
        })

    return {"tables": results}


@router.post("/analysis/dataset-description")
async def dataset_description(req: TableListRequest):
    """Generate a concise dataset description suitable for Genie room instructions."""
    table_summaries = _gather_table_metadata(req.table_identifiers)

    # Get row counts if warehouse available
    row_counts = {}
    if req.warehouse_id:
        for ts in table_summaries:
            if ts.get("error"):
                continue
            try:
                data = await _run_sql(
                    req.warehouse_id,
                    f"SELECT COUNT(*) as cnt FROM {ts['full_name']}",
                )
                if data:
                    rows = data.get("result", {}).get("data_array", [])
                    if rows and rows[0]:
                        row_counts[ts["full_name"]] = int(rows[0][0])
            except Exception:
                pass

    # Build context
    context_parts = []
    for ts in table_summaries:
        if ts.get("error"):
            continue
        part = f"Table: {ts['full_name']}"
        if ts.get("comment"):
            part += f"\n  Description: {ts['comment']}"
        part += f"\n  Type: {ts.get('table_type', 'unknown')}"
        rc = row_counts.get(ts["full_name"])
        if rc is not None:
            part += f"\n  Row count: {rc:,}"
        part += f"\n  Columns ({ts['column_count']}):"
        for c in ts.get("columns", []):
            line = f"    - {c['name']} ({c['type']})"
            if c.get("comment"):
                line += f" — {c['comment']}"
            part += f"\n{line}"
        context_parts.append(part)

    context = "\n\n".join(context_parts)

    client = _llm_client()
    prompt = (
        "You are a data analyst writing instructions for an AI assistant (Genie) "
        "that will help business users query these tables.\n\n"
        "Generate a clear, concise description of this dataset that includes:\n"
        "1. A 2-3 sentence overview of what the dataset contains and its business domain\n"
        "2. Key relationships between tables (join keys, foreign keys)\n"
        "3. Important notes about the data (time ranges, granularity, special values)\n"
        "4. Any conventions or business logic the AI should know when writing queries\n\n"
        "Write in a direct, instructional tone — this will be used as instructions "
        "for the AI assistant. Do NOT use markdown headers or bullet points. "
        "Write in plain paragraphs. Keep it under 200 words.\n\n"
        f"Tables:\n\n{context}"
    )

    try:
        resp = await client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=1024,
            temperature=0.3,
        )
        description = resp.choices[0].message.content.strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

    return {"description": description}


# Legacy EDA endpoint (kept for backward compatibility)


@router.post("/analysis/eda")
async def eda_analysis(req: TableListRequest):
    """Run metadata analysis and generate an LLM summary of selected tables."""
    table_summaries = _gather_table_metadata(req.table_identifiers)

    row_counts = {}
    if req.warehouse_id:
        for ts in table_summaries:
            if ts.get("error"):
                continue
            try:
                data = await _run_sql(
                    req.warehouse_id,
                    f"SELECT COUNT(*) as cnt FROM {ts['full_name']}",
                )
                if data:
                    rows = data.get("result", {}).get("data_array", [])
                    if rows and rows[0]:
                        row_counts[ts["full_name"]] = int(rows[0][0])
            except Exception:
                pass

    context_parts = []
    for ts in table_summaries:
        if ts.get("error"):
            context_parts.append(f"Table: {ts['full_name']} - Error: {ts['error']}")
            continue
        part = f"Table: {ts['full_name']}"
        if ts.get("comment"):
            part += f"\n  Description: {ts['comment']}"
        part += f"\n  Type: {ts.get('table_type', 'unknown')}"
        rc = row_counts.get(ts["full_name"])
        if rc is not None:
            part += f"\n  Row count: {rc:,}"
        part += f"\n  Columns ({ts['column_count']}):"
        for c in ts.get("columns", []):
            line = f"    - {c['name']} ({c['type']})"
            if c.get("comment"):
                line += f" — {c['comment']}"
            part += f"\n{line}"
        context_parts.append(part)

    context = "\n\n".join(context_parts)
    client = _llm_client()
    try:
        resp = await client.chat.completions.create(
            model=DEFAULT_MODEL,
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a data analyst. Analyze the following table metadata. Include:\n"
                        "1. **Data Domain**: What domain/business area?\n"
                        "2. **Table Relationships**: How might these relate?\n"
                        "3. **Data Quality Notes**: Observations about descriptions, types.\n"
                        "4. **Suggested Questions**: 3-5 examples.\n"
                        "Keep it concise. Format in markdown."
                    ),
                },
                {"role": "user", "content": f"Analyze these tables:\n\n{context}"},
            ],
            max_tokens=2048,
            temperature=0.3,
        )
        summary = resp.choices[0].message.content.strip()
    except Exception as e:
        summary = f"Unable to generate analysis: {str(e)}"

    tables_meta = []
    for ts in table_summaries:
        tables_meta.append({
            "full_name": ts["full_name"],
            "name": ts.get("name", ts["full_name"].split(".")[-1]),
            "table_type": ts.get("table_type", ""),
            "comment": ts.get("comment", ""),
            "column_count": ts.get("column_count", 0),
            "row_count": row_counts.get(ts["full_name"]),
            "error": ts.get("error"),
        })

    return {"summary": summary, "tables": tables_meta}
