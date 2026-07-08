"""
Sample Data Generator — creates realistic industry-specific tables in Unity Catalog.
"""

import asyncio
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from openai import AsyncOpenAI
from server.config import get_workspace_host, get_auth_headers
import httpx


def _llm_client() -> AsyncOpenAI:
    """LLM client over the workspace's OpenAI-compatible serving endpoints.

    Replaces the old databricks_langchain.ChatDatabricks dependency (which pulled in the
    fragile langchain/MCP stack); mirrors server/routes/analysis.py._llm_client.
    """
    host = get_workspace_host()
    token = get_auth_headers().get("Authorization", "").replace("Bearer ", "")
    return AsyncOpenAI(api_key=token, base_url=f"{host}/serving-endpoints")


router = APIRouter(tags=["sample-data"])

LLM_ENDPOINT = "databricks-claude-sonnet-4-5"

# ── Industry templates ──

INDUSTRIES = {
    "retail": {
        "label": "Retail & E-Commerce",
        "description": "Customer orders, products, inventory, and store performance data",
        "tables": ["customers", "products", "orders", "order_items", "stores", "inventory"],
        "categories": [
            {
                "id": "craft_brewery",
                "label": "Craft Brewery",
                "description": "Anheuser-Busch craft brewery (Goose Island). Customers are bars, restaurants, individuals; stores are taprooms.",
                "allowed_products": [
                    "Goose Island IPA", "Goose Island 312 Urban Wheat Ale", "Goose Island Bourbon County Stout",
                    "Goose Island Sofie", "Goose Island Matilda", "Goose Island Honkers Ale",
                    "Goose Island Green Line Pale Ale", "Goose Island Lager", "Goose Island Summer Hours",
                    "Goose Island Next Coast IPA",
                ],
            },
            {
                "id": "brewpub",
                "label": "Brewpub & Taproom",
                "description": "Anheuser-Busch brewpub with house beers and pub food. Beers served as flights, pints, growlers alongside pub food. Stores are taproom locations.",
                "allowed_products": [
                    "Budweiser Pint", "Bud Light Pint", "Michelob ULTRA Pint", "Stella Artois Pint",
                    "Goose Island IPA Pint", "Goose Island 312 Pint", "Busch Light Pint",
                    "Natural Light Pint", "Beer Flight (4x5oz)", "Goose Island IPA Growler",
                    "Budweiser Growler", "Bud Light Growler", "Michelob ULTRA Growler",
                    "Stella Artois Growler", "Smash Burger", "Beer-Battered Fish & Chips",
                    "Soft Pretzel & Beer Cheese", "Loaded Nachos", "Buffalo Wings", "Brewpub Caesar Salad",
                ],
            },
            {
                "id": "beer_distributor",
                "label": "Beer Distributor",
                "description": "Wholesale distributor of Anheuser-Busch products only. Cases and kegs sold to bars, restaurants, retailers. Customers are licensed accounts; orders are bulk; inventory is by SKU and keg size.",
                "allowed_products": [
                    "Budweiser 24-pack Cans", "Bud Light 24-pack Cans", "Bud Light 30-pack Cans",
                    "Michelob ULTRA 24-pack Bottles", "Stella Artois 24-pack Bottles", "Busch 30-pack Cans",
                    "Busch Light 30-pack Cans", "Natural Light 30-pack Cans", "Michelob Golden Light 24-pack",
                    "Bud Light Seltzer Variety 12-pack", "Goose Island IPA 12-pack",
                    "Budweiser 1/2 Barrel Keg", "Bud Light 1/2 Barrel Keg",
                    "Michelob ULTRA 1/6 Barrel Keg", "Stella Artois 1/2 Barrel Keg",
                    "Busch Light 1/2 Barrel Keg", "Goose Island IPA 1/6 Barrel Keg",
                    "Bud Light 12-pack Bottles", "Budweiser 12-pack Bottles", "Michelob ULTRA 18-pack Cans",
                ],
            },
            {
                "id": "bottle_shop",
                "label": "Bottle Shop",
                "description": "Specialty beer retailer carrying Anheuser-Busch brands only. Packaged cans and bottles, growler fills. Customers are individuals.",
                "allowed_products": [
                    "Budweiser 6-pack Bottles", "Bud Light 6-pack Bottles", "Michelob ULTRA 6-pack Bottles",
                    "Stella Artois 6-pack Bottles", "Busch 6-pack Cans", "Busch Light 6-pack Cans",
                    "Natural Light 6-pack Cans", "Michelob Golden Light 6-pack",
                    "Goose Island IPA 6-pack", "Goose Island 312 6-pack",
                    "Goose Island Bourbon County Stout 4-pack", "Goose Island Honkers Ale 6-pack",
                    "Bud Light Seltzer Variety Pack", "Bud Light Lime 6-pack",
                    "Goose Island IPA Growler Fill", "Budweiser Growler Fill", "Bud Light Growler Fill",
                    "Michelob ULTRA Growler Fill", "Stella Artois Growler Fill", "Goose Island 312 Growler Fill",
                ],
            },
            {
                "id": "homebrew_supply",
                "label": "Homebrew Supply",
                "description": "Homebrew shop selling ingredients, equipment, and clone recipe kits for Anheuser-Busch beers only. Customers are hobbyist brewers.",
                "allowed_products": [
                    "Budweiser Clone Recipe Kit", "Bud Light Clone Recipe Kit",
                    "Michelob ULTRA Clone Recipe Kit", "Stella Artois Clone Recipe Kit",
                    "Goose Island IPA Clone Recipe Kit", "Busch Light Clone Recipe Kit",
                    "Goose Island Bourbon County Stout Clone Kit", "2-Row Pale Malt 50lb Sack",
                    "Munich Malt 10lb", "Crystal 60L Malt 5lb", "Cascade Hops 1oz",
                    "Centennial Hops 1oz", "Saaz Hops 1oz", "Hallertau Hops 1oz",
                    "Safale US-05 Dry Yeast", "Wyeast 1056 American Ale Yeast",
                    "6.5gal Glass Carboy", "5gal Corny Keg", "Auto-Siphon", "Wort Chiller",
                ],
            },
        ],
    },
    "finance": {
        "label": "Finance & Banking",
        "description": "Accounts, transactions, loans, and customer portfolio data",
        "tables": ["accounts", "transactions", "customers", "loans", "payments", "branches"],
        "categories": [
            {
                "id": "retail_banking",
                "label": "Retail Banking",
                "description": "Consumer bank with checking/savings accounts, debit cards, mortgages, and auto loans. Customers are individuals; branches are local; transactions are everyday purchases, ATM withdrawals, and bill pay.",
            },
            {
                "id": "credit_union",
                "label": "Credit Union",
                "description": "Member-owned community financial institution. Smaller branch footprint, personal/auto loans, lower fees. Customers are members; balances and loan amounts are modest.",
            },
            {
                "id": "digital_neobank",
                "label": "Digital Neobank",
                "description": "App-only consumer bank with no traditional branches (one HQ entry). Younger customers, instant peer-to-peer payments, no-fee checking, micro-investing.",
            },
            {
                "id": "wealth_management",
                "label": "Wealth Management",
                "description": "Private bank serving high-net-worth clients. Portfolio accounts with large balances, dedicated advisors as 'branches', loans for real estate / margin, large transactions.",
            },
            {
                "id": "investment_bank",
                "label": "Investment Bank",
                "description": "Institutional bank serving corporate and fund clients. Trading accounts, large block transactions, syndicated loans, capital markets payments. Branches are major financial-center offices.",
            },
        ],
    },
    "supply_chain": {
        "label": "Supply Chain & Logistics",
        "description": "Suppliers, shipments, warehouses, and procurement data",
        "tables": ["suppliers", "purchase_orders", "shipments", "warehouses", "inventory", "delivery_routes"],
        "categories": [
            {
                "id": "ecommerce_3pl",
                "label": "E-commerce 3PL",
                "description": "Third-party logistics fulfilling orders for online retailers. Parcel shipments, fast inventory turnover, regional fulfillment centers, last-mile delivery routes.",
            },
            {
                "id": "cold_chain",
                "label": "Cold Chain",
                "description": "Temperature-controlled logistics for pharma, vaccines, and frozen food. Refrigerated trucks and warehouses, strict temperature tracking, time-sensitive shipments.",
            },
            {
                "id": "automotive_parts",
                "label": "Automotive Parts Distribution",
                "description": "Distributor moving auto parts from manufacturers to dealerships and repair shops. Just-in-time delivery, parts catalog SKUs, regional warehouses, daily route trucks.",
            },
            {
                "id": "grocery_distribution",
                "label": "Grocery Distribution",
                "description": "Wholesale grocery distribution to supermarkets and restaurants. Perishables, frequent restocking runs, regional DCs, refrigerated and dry inventory.",
            },
            {
                "id": "industrial_mro",
                "label": "Industrial MRO",
                "description": "Maintenance, repair, and operations supply for factories and facilities. B2B customers, broad SKU range (fasteners, lubricants, safety gear), scheduled and emergency orders.",
            },
        ],
    },
    "manufacturing": {
        "label": "Manufacturing",
        "description": "Production lines, equipment, quality inspections, and work orders",
        "tables": ["production_lines", "work_orders", "equipment", "quality_inspections", "raw_materials", "finished_goods"],
        "categories": [
            {
                "id": "automotive",
                "label": "Automotive Manufacturing",
                "description": "Vehicle assembly plant. Body, paint, and final-assembly lines; engines and transmissions; steel/aluminum/plastic raw materials; finished cars and trucks; robotic equipment.",
            },
            {
                "id": "electronics",
                "label": "Electronics Manufacturing",
                "description": "PCB assembly and consumer electronics. SMT lines, pick-and-place machines, semiconductors and capacitors as raw materials, finished phones/laptops/wearables, AOI quality inspections.",
            },
            {
                "id": "pharmaceutical",
                "label": "Pharmaceutical Manufacturing",
                "description": "Drug production under GMP. Tablet/injectable production lines, batch records as work orders, active ingredients and excipients, finished medicines, stringent QC and stability tests.",
            },
            {
                "id": "food_beverage",
                "label": "Food & Beverage Manufacturing",
                "description": "Food and drink processing. Bottling, canning, and packaging lines; ingredients like sugar/flour/concentrate; finished SKUs; FDA-style inspections and lot codes.",
            },
            {
                "id": "aerospace",
                "label": "Aerospace Manufacturing",
                "description": "Aircraft and aerospace component manufacturing. Precision CNC lines, low-volume high-cost work orders, titanium/composite raw materials, finished airframe parts, FAA-grade inspections.",
            },
        ],
    },
    "healthcare": {
        "label": "Healthcare",
        "description": "Patients, appointments, providers, and billing data",
        "tables": ["patients", "appointments", "providers", "diagnoses", "prescriptions", "billing"],
        "categories": [
            {
                "id": "hospital",
                "label": "Hospital System",
                "description": "Acute-care hospital with inpatient and outpatient services. Many providers across specialties, complex diagnoses (ICD-10), high-dollar billing, procedures and admissions.",
            },
            {
                "id": "primary_care",
                "label": "Primary Care Clinic",
                "description": "Family/internal medicine practice. Routine annual visits, common diagnoses (hypertension, diabetes), everyday prescriptions, modest billing amounts, small provider roster.",
            },
            {
                "id": "specialty_clinic",
                "label": "Specialty Clinic",
                "description": "Focused specialty practice (e.g. cardiology, orthopedics, dermatology). Specialty-specific diagnoses and procedures, referral-driven appointments, sub-specialist providers.",
            },
            {
                "id": "mental_health",
                "label": "Mental Health Practice",
                "description": "Behavioral health practice. Recurring therapy sessions, psychiatric diagnoses, SSRIs and other psych prescriptions, mix of therapists and psychiatrists, session-based billing.",
            },
            {
                "id": "telehealth",
                "label": "Telehealth Provider",
                "description": "Virtual-only healthcare service. Video-visit appointments, broad geographic patient base, common acute-care diagnoses, e-prescriptions, flat-fee or subscription billing.",
            },
        ],
    },
    "telecom": {
        "label": "Telecommunications",
        "description": "Subscribers, plans, usage, support tickets, and network data",
        "tables": ["subscribers", "plans", "usage_records", "support_tickets", "network_towers", "billing"],
        "categories": [
            {
                "id": "mobile_carrier",
                "label": "Mobile Carrier",
                "description": "Consumer wireless carrier. Postpaid and prepaid plans with voice/text/data, large cell-tower network, usage in minutes/messages/GB, device financing on bills.",
            },
            {
                "id": "isp",
                "label": "Residential ISP",
                "description": "Home broadband provider (fiber/cable). Tiered speed plans, modem/router CPE, outage and slow-speed support tickets, neighborhood node 'towers', monthly flat-rate billing.",
            },
            {
                "id": "mvno",
                "label": "MVNO",
                "description": "Mobile virtual network operator reselling another carrier's network. Low-cost prepaid plans, simple flat usage, fewer support tickets, partner-network towers, no-contract billing.",
            },
            {
                "id": "enterprise_telecom",
                "label": "Enterprise Telecom",
                "description": "B2B telecom serving corporate clients. MPLS/SD-WAN/dedicated-line plans, business accounts, SLA-driven support tickets, fiber POP sites as 'towers', large monthly invoices.",
            },
            {
                "id": "satellite_internet",
                "label": "Satellite Internet",
                "description": "LEO/GEO satellite broadband for rural and remote users. Dish-based CPE, ground-station 'towers', weather-related support tickets, data-cap usage plans, equipment-fee billing.",
            },
        ],
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
    category: str | None = None


# ── SQL execution helper ──

async def _execute_sql(request, warehouse_id: str, statement: str, timeout_secs: int = 120) -> dict:
    """Execute a SQL statement via the Statements API with polling (as the user)."""
    host = get_workspace_host()
    headers = get_auth_headers(request)

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
            {
                "id": k,
                "label": v["label"],
                "description": v["description"],
                "tables": v["tables"],
                "categories": v.get("categories", []),
            }
            for k, v in INDUSTRIES.items()
        ]
    }


@router.post("/sample-data/generate-table")
async def generate_table(req: GenerateTableRequest, request: Request):
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

    # Optional sub-category theming (e.g. retail → craft brewery): biases the LLM
    # to produce on-theme product names, customers, etc.
    theme_instruction = ""
    if req.category:
        cat = next(
            (c for c in industry_info.get("categories", []) if c["id"] == req.category),
            None,
        )
        if cat:
            theme_instruction = (
                f"- Theme: {cat['label']}. {cat['description']} "
                f"Make all data (names, descriptions, categories, amounts) realistic for this business type.\n"
            )
            allowed = cat.get("allowed_products") or []
            if allowed:
                allowed_list = "\n".join(f"  * {p}" for p in allowed)
                theme_instruction += (
                    f"- ALLOWED PRODUCT NAMES (use ONLY names from this list for any product, item, SKU, "
                    f"or inventory column — do NOT invent new product names, do NOT use any other brand):\n{allowed_list}\n"
                    f"- FORBIDDEN BRANDS (never appear in any column, never reference): "
                    f"Heineken USA, Constellation Brands, Blue Moon, Molson Coors, Diageo, Guinness, "
                    f"Shock Top, Elysian, Karbach, Wicked Weed, Breckenridge, Devils Backbone, "
                    f"10 Barrel, Four Peaks, Estrella Jalisco, Hoegaarden, Leffe, Becks, Beck's. "
                    f"If you are about to write any of these names, replace with a name from the ALLOWED list above.\n"
                )

    prompt = f"""Generate Databricks SQL for a {industry_info['label']} "{req.table_name}" table.

{('THEME (HIGHEST PRIORITY — overrides any generic ' + industry_info['label'] + ' assumptions):' + chr(10) + theme_instruction + chr(10)) if theme_instruction else ''}Requirements:
- CREATE TABLE IF NOT EXISTS {full_table} (6-10 columns, Databricks types: STRING, INT, DECIMAL(10,2), DATE, TIMESTAMP, DOUBLE)
- INSERT INTO {full_table} VALUES with exactly {seed_rows} rows of realistic data
- Dates between '{req.date_start}' and '{req.date_end}'
- First column: integer ID starting from 1
- Related tables: {', '.join(req.all_tables)} (use consistent FK IDs 1-{seed_rows})
{desc_instruction}
Rules: Return ONLY raw SQL, no markdown/fences/explanation. Semicolons between statements. No backticks around table names. Databricks SQL only."""

    try:
        # Step 1: LLM generates CREATE TABLE + seed INSERT
        llm = _llm_client()
        response = await llm.chat.completions.create(
            model=LLM_ENDPOINT,
            messages=[{"role": "user", "content": prompt}],
            max_tokens=4096,
            temperature=0.3,
        )
        sql = response.choices[0].message.content.strip()

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
        result = await _execute_sql(request, req.warehouse_id, create_stmt)
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
            result = await _execute_sql(request, req.warehouse_id, stmt)
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
            result = await _execute_sql(request, req.warehouse_id, scale_sql)
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
async def create_schema(req: GenerateRequest, request: Request):
    """Create schema if it doesn't exist, then grant CREATE TABLE to the current principal."""
    try:
        results = []

        # Create schema
        result = await _execute_sql(
            request,
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
        # Use the SP client here specifically to read the app's own client_id —
        # the grant below targets the app service principal, not the user.
        from server.config import get_workspace_client
        try:
            w = get_workspace_client()
            sp_id = w.config.client_id or ""
            if sp_id:
                grant_result = await _execute_sql(
                    request,
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
