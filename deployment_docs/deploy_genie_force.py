# Databricks notebook source

# MAGIC %md
# MAGIC # Genie-Force Deployment Notebook
# MAGIC
# MAGIC This notebook deploys the **Genie-Force** app to your Databricks workspace.
# MAGIC
# MAGIC **Prerequisites:**
# MAGIC - This notebook can run from anywhere in the workspace — it does **not** need to
# MAGIC   live inside a Workspace Git folder. The app deploys straight from the Git repo
# MAGIC   configured below (`GIT_REPO_URL` / `GIT_BRANCH`).
# MAGIC - The `frontend/dist/` directory must be pre-built and committed to that repo
# MAGIC - Your workspace must have **serverless compute** enabled
# MAGIC - At least one SQL warehouse must exist (it will be auto-started if stopped)
# MAGIC - If the repo is **private**, the app's service principal needs a Git credential
# MAGIC   configured for your Git provider (public repos need nothing)
# MAGIC
# MAGIC **What this notebook does:**
# MAGIC 1. Creates a Lakebase instance (`genco-cache`)
# MAGIC 2. Creates the `genco` database
# MAGIC 3. Creates the Databricks App + grants SP access to warehouses, Genie rooms, and Unity Catalog
# MAGIC 3c. Configures On-Behalf-Of-User (OBO) authorization scopes so each person's own
# MAGIC     permissions apply to Genie / SQL / Unity Catalog / Lakeview-dashboard calls
# MAGIC 4. Grants the app's service principal access to Lakebase
# MAGIC 5. Attaches Lakebase as a connected resource
# MAGIC 6. Deploys the app
# MAGIC
# MAGIC The app's Lakebase tables (`saved_questions`, `chat_history`, `semantic_cache`,
# MAGIC row-level `filters`, `kpis`, and `genco_dashboards`) are created automatically on first
# MAGIC use — the SP grants in Step 4 give it CREATE on the `public` schema so this just works.
# MAGIC
# MAGIC ---

# COMMAND ----------

# MAGIC %md
# MAGIC ## Install Dependencies

# COMMAND ----------

# MAGIC %pip install databricks-sdk psycopg2-binary --upgrade -q
dbutils.library.restartPython()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration
# MAGIC
# MAGIC Edit these values if you want to customize names. Defaults work out of the box.

# COMMAND ----------

APP_NAME = "genco"
APP_DESCRIPTION = "Genie-Force - AI/BI Genie Room Manager"
LAKEBASE_INSTANCE = "genco-cache"
LAKEBASE_CAPACITY = "CU_1"  # CU_1, CU_2, CU_4, CU_8
DATABASE_NAME = "genco"
RESOURCE_NAME = "genco-cache-db"

# Git source for the app. Databricks Apps deploy directly from a Git repo — no
# Workspace Git folder / Repos clone is needed, and this is required in workspaces
# where the admin policy is "only allow app deployments from Git". The repo below
# is public, so no Git credentials are needed on the app's service principal.
GIT_REPO_URL = "https://github.com/kmarwah26/gencon.git"
GIT_BRANCH = "main"
GIT_PROVIDER = "gitHub"  # gitHub | gitLab | bitbucketCloud | azureDevOpsServices

# On-Behalf-Of-User (OBO) OAuth scopes the app requests. Each user consents on first
# visit, and user-facing Databricks calls then run with that user's own permissions.
# Mirror these in app.yaml's `user_authorization.scopes` block.
USER_API_SCOPES = [
    "sql",               # SQL Statement API: EDA, KPI exec, filter queries, execute-sql
    "sql.warehouses",    # Warehouse list/start
    "catalog.catalogs",  # Unity Catalog: list catalogs
    "catalog.schemas",   # Unity Catalog: list schemas (catalog.catalogs alone 403s on /schemas)
    "catalog.tables",    # Unity Catalog: list tables + columns
    "dashboards.genie",  # Genie rooms: list/create/edit/delete, conversations, query results
    "sql.dashboards",    # Lakeview dashboards: create/publish/share/embed
    "files",             # Workspace files browser (list/export notebooks & SQL files)
    "serving.serving-endpoints",  # Ask Everything: list + query the Agent Bricks supervisor endpoint
]

# COMMAND ----------

# MAGIC %md
# MAGIC ## Initialize SDK

# COMMAND ----------

import time
import uuid
from databricks.sdk import WorkspaceClient

w = WorkspaceClient()

# Get current user for paths
me = w.current_user.me()
username = me.user_name
print(f"Logged in as: {username}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 1: Create the Lakebase Instance
# MAGIC
# MAGIC Creates a managed PostgreSQL instance for storing saved questions and chat history.

# COMMAND ----------

from databricks.sdk.service.database import DatabaseInstance

# Check if instance already exists
try:
    instance = w.database.get_database_instance(name=LAKEBASE_INSTANCE)
    print(f"Lakebase instance '{LAKEBASE_INSTANCE}' already exists (state: {instance.state})")
except Exception:
    print(f"Creating Lakebase instance '{LAKEBASE_INSTANCE}' with capacity {LAKEBASE_CAPACITY}...")
    instance = w.database.create_database_instance(
        DatabaseInstance(
            name=LAKEBASE_INSTANCE,
            capacity=LAKEBASE_CAPACITY,
        )
    )
    print(f"  Instance creation initiated.")

# Wait for AVAILABLE
for attempt in range(40):
    instance = w.database.get_database_instance(name=LAKEBASE_INSTANCE)
    state = str(instance.state)
    if "AVAILABLE" in state:
        print(f"Lakebase instance is ready!")
        print(f"  Endpoint: {instance.read_write_dns}")
        break
    print(f"  Waiting for Lakebase... (state: {state}, attempt {attempt + 1})")
    time.sleep(15)
else:
    print("WARNING: Timed out waiting for Lakebase instance.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 2: Create the Application Database
# MAGIC
# MAGIC Connects to the Lakebase instance and creates the `genco` database.
# MAGIC Tables (`saved_questions`, `chat_history`) are auto-created by the app on first use.

# COMMAND ----------

import psycopg2

# Get connection details
instance = w.database.get_database_instance(name=LAKEBASE_INSTANCE)
host = instance.read_write_dns

# Generate OAuth token for authentication
cred = w.database.generate_database_credential(
    request_id=str(uuid.uuid4()),
    instance_names=[LAKEBASE_INSTANCE],
)
token = cred.token

# Connect to default database first to create our database
try:
    conn = psycopg2.connect(
        host=host,
        port=5432,
        database="databricks_postgres",
        user=username,
        password=token,
        sslmode="require",
    )
    conn.autocommit = True
    cur = conn.cursor()
    cur.execute(f"SELECT 1 FROM pg_database WHERE datname = '{DATABASE_NAME}'")
    if cur.fetchone():
        print(f"Database '{DATABASE_NAME}' already exists.")
    else:
        cur.execute(f"CREATE DATABASE {DATABASE_NAME}")
        print(f"Database '{DATABASE_NAME}' created successfully.")
    cur.close()
    conn.close()
except Exception as e:
    print(f"Note: {e}")
    print("This may be fine if the database already exists.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3: Create the Databricks App
# MAGIC
# MAGIC Registers the app and provisions a service principal.

# COMMAND ----------

from databricks.sdk.service.apps import App, GitRepository

# The app is bound to a Git repo at creation. This is what lets us deploy from Git
# (Step 6) in workspaces that forbid Workspace-snapshot deploys.
_git_repo = GitRepository(url=GIT_REPO_URL, provider=GIT_PROVIDER)

try:
    app = w.apps.get(name=APP_NAME)
    print(f"App '{APP_NAME}' already exists.")
    print(f"  URL: {app.url}")
    print(f"  State: {app.app_status.state if app.app_status else 'N/A'}")
    # Ensure the existing app points at the Git repo (older deploys may lack it,
    # which makes every subsequent update fail with "Git repository is required").
    if not getattr(app, "git_repository", None):
        try:
            w.apps.update(name=APP_NAME, app=App(name=APP_NAME, git_repository=_git_repo))
            print(f"  Attached Git repo to existing app: {GIT_REPO_URL} ({GIT_BRANCH})")
        except Exception as e:
            print(f"  Note: could not attach Git repo to existing app: {e}")
except Exception:
    print(f"Creating app '{APP_NAME}'...")
    app = w.apps.create_and_wait(
        app=App(
            name=APP_NAME,
            description=APP_DESCRIPTION,
            git_repository=_git_repo,
            # Set OBO scopes at creation so a brand-new app requests them from the
            # first visit. Step 3c re-asserts them (and covers already-existing apps).
            user_api_scopes=USER_API_SCOPES,
        )
    )
    print(f"  App created!")
    print(f"  URL: {app.url}")
    print(f"  Git repo: {GIT_REPO_URL} ({GIT_BRANCH})")

sp_id = app.service_principal_client_id
sp_numeric_id = str(app.service_principal_id)
print(f"  Service Principal Client ID: {sp_id}")
print(f"  Service Principal Numeric ID: {sp_numeric_id}")

# Add the SP to the "users" group so it can access Genie API and workspace resources
print("\nAdding service principal to 'users' group...")
groups = list(w.groups.list(filter='displayName eq "users"'))
if groups:
    users_group = groups[0]
    try:
        from databricks.sdk.service.iam import Patch, PatchOp, PatchSchema
        # PatchOp is an enum (ADD/REMOVE/REPLACE); the SCIM operation object is
        # `Patch(op=..., path=..., value=...)`. The old code called PatchOp(op="add"),
        # which raised "EnumType.__call__() got an unexpected keyword argument 'op'".
        w.groups.patch(
            id=users_group.id,
            schemas=[PatchSchema.URN_IETF_PARAMS_SCIM_API_MESSAGES_2_0_PATCH_OP],
            operations=[
                Patch(
                    op=PatchOp.ADD,
                    path="members",
                    value=[{"value": sp_numeric_id}],
                )
            ],
        )
        print(f"  Added SP to 'users' group (id: {users_group.id})")
    except Exception as e:
        if "already exists" in str(e).lower() or "conflict" in str(e).lower():
            print(f"  SP is already in 'users' group.")
        else:
            print(f"  Note: {e}")
            print("  You may need to manually add the SP to the 'users' group in Admin Settings.")
else:
    print("  WARNING: Could not find 'users' group. Add the SP manually in Admin Settings > Groups.")

# Grant CAN USE on all SQL warehouses to the service principal
print("\nGranting SQL warehouse access to service principal...")
import requests as _req

_host = w.config.host.rstrip("/")
_headers = w.config.authenticate()
_headers["Content-Type"] = "application/json"

try:
    wh_resp = _req.get(f"{_host}/api/2.0/sql/warehouses", headers=_headers)
    wh_resp.raise_for_status()
    for wh in wh_resp.json().get("warehouses", []):
        wh_id = wh["id"]
        wh_name = wh.get("name", wh_id)
        try:
            _req.put(
                f"{_host}/api/2.0/permissions/sql/warehouses/{wh_id}",
                headers=_headers,
                json={
                    "access_control_list": [
                        {
                            "service_principal_name": sp_id,
                            "permission_level": "CAN_USE",
                        }
                    ]
                },
            ).raise_for_status()
            print(f"  Granted CAN_USE on warehouse '{wh_name}'")
        except Exception as e:
            print(f"  Note (warehouse '{wh_name}'): {e}")
except Exception as e:
    print(f"  Could not list warehouses: {e}")
    print("  You may need to grant CAN_USE on a SQL warehouse manually.")

# Mirror the deploying user's Genie room permissions to the service principal
print("\nGranting Genie room permissions to service principal...")
print("(Mirroring your permissions so the app has the same access you do)\n")

try:
    # List all Genie rooms visible to current user
    resp = _req.get(f"{_host}/api/2.0/genie/spaces", headers=_headers)
    resp.raise_for_status()
    spaces = resp.json().get("spaces", resp.json().get("genie_spaces", []))
    for s in spaces:
        room_id = s.get("space_id", s.get("id", ""))
        title = s.get("title", "Untitled")
        try:
            # Get current user's permission level on this room
            perm_resp = _req.get(
                f"{_host}/api/2.0/permissions/genie/{room_id}",
                headers=_headers,
            )
            perm_resp.raise_for_status()
            perm_data = perm_resp.json()

            # Find the deploying user's highest permission level
            user_perm = "CAN_MANAGE"  # default fallback
            for acl in perm_data.get("access_control_list", []):
                principal = acl.get("user_name", "") or acl.get("group_name", "")
                if principal == username:
                    # Get the highest permission from all_permissions
                    for p in acl.get("all_permissions", []):
                        if not p.get("inherited", False):
                            user_perm = p.get("permission_level", user_perm)
                            break
                    break

            _req.put(
                f"{_host}/api/2.0/permissions/genie/{room_id}",
                headers=_headers,
                json={
                    "access_control_list": [
                        {
                            "service_principal_name": sp_id,
                            "permission_level": user_perm,
                        }
                    ]
                },
            ).raise_for_status()
            print(f"  Granted {user_perm} on '{title}' ({room_id})")
        except Exception as e:
            print(f"  Failed for '{title}': {e}")
    if not spaces:
        print("  No existing Genie rooms found. Create rooms after deployment.")
except Exception as e:
    print(f"  Could not list Genie rooms: {e}")
    print("  You may need to grant permissions manually in each room's sharing settings.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3b: Grant Unity Catalog Access to the Service Principal
# MAGIC
# MAGIC Grants the app's service principal read access and write access (for sample data generation)
# MAGIC to Unity Catalog tables. Uses the SQL Statement API to run GRANT statements.

# COMMAND ----------

import requests as _req
from concurrent.futures import ThreadPoolExecutor, as_completed

print("Granting Unity Catalog access to service principal...")
print(f"  SP Client ID: {sp_id}\n")

# Find a running SQL warehouse to run GRANT statements
_host = w.config.host.rstrip("/")
_wh_headers = {**w.config.authenticate(), "Content-Type": "application/json"}
warehouses_resp = _req.get(f"{_host}/api/2.0/sql/warehouses", headers=_wh_headers)
warehouses_resp.raise_for_status()
wh_list = warehouses_resp.json().get("warehouses", [])
sql_warehouse_id = None

# Prefer a running serverless/PRO warehouse
for wh in wh_list:
    if wh.get("state") in ("RUNNING", "STARTING"):
        sql_warehouse_id = wh["id"]
        break

# If none running, start the first available warehouse and wait
if not sql_warehouse_id and wh_list:
    start_wh = wh_list[0]
    sql_warehouse_id = start_wh["id"]
    print(f"  No running warehouse found. Starting '{start_wh.get('name', sql_warehouse_id)}'...")
    try:
        _req.post(
            f"{_host}/api/2.0/sql/warehouses/{sql_warehouse_id}/start",
            headers=_wh_headers,
        )
        for _attempt in range(30):
            time.sleep(10)
            _status_resp = _req.get(f"{_host}/api/2.0/sql/warehouses/{sql_warehouse_id}", headers={**w.config.authenticate(), "Content-Type": "application/json"})
            if _status_resp.ok and _status_resp.json().get("state") == "RUNNING":
                print(f"  Warehouse is now RUNNING.")
                break
        else:
            print(f"  WARNING: Warehouse did not start in time. UC grants may fail.")
    except Exception as e:
        print(f"  Could not start warehouse: {e}")

if not sql_warehouse_id:
    print("  WARNING: No running SQL warehouse found. Skipping UC grants.")
    print("  You can manually grant access with: GRANT USE CATALOG ON CATALOG <name> TO `<sp_id>`")
else:
    print(f"  Using warehouse: {sql_warehouse_id}\n")

    def _run_sql(statement, warehouse_id):
        """Execute a SQL statement via the Statement API and return success."""
        resp = _req.post(
            f"{_host}/api/2.0/sql/statements",
            headers={**w.config.authenticate(), "Content-Type": "application/json"},
            json={
                "warehouse_id": warehouse_id,
                "statement": statement,
                "wait_timeout": "30s",
            },
        )
        data = resp.json()
        status = data.get("status", {}).get("state", "")
        if status == "SUCCEEDED":
            return True, data
        else:
            error = data.get("status", {}).get("error", {}).get("message", str(data))
            return False, error

    def _grant_catalog(catalog):
        """Grant all permissions on a catalog and its schemas (runs in a thread)."""
        results = []

        # Grant USE CATALOG + CREATE SCHEMA
        ok_cat, err = _run_sql(f"GRANT USE CATALOG, CREATE SCHEMA ON CATALOG `{catalog}` TO `{sp_id}`", sql_warehouse_id)
        if ok_cat:
            results.append(f"  Granted USE CATALOG + CREATE SCHEMA on '{catalog}'")
        else:
            results.append(f"  Note (catalog '{catalog}'): {err}")
            return results

        # List schemas and batch-grant on each
        ok_schemas, schema_result = _run_sql(f"SHOW SCHEMAS IN `{catalog}`", sql_warehouse_id)
        if not ok_schemas:
            return results

        schemas = [row[0] for row in schema_result.get("result", {}).get("data_array", []) if row]
        schemas = [s for s in schemas if s != "information_schema"]

        if not schemas:
            return results

        # Grant on all schemas in parallel using a single combined SQL per schema
        for schema in schemas:
            _run_sql(
                f"GRANT USE SCHEMA, CREATE TABLE, SELECT, MODIFY ON SCHEMA `{catalog}`.`{schema}` TO `{sp_id}`",
                sql_warehouse_id,
            )
        results.append(f"    Granted permissions on {len(schemas)} schemas in '{catalog}'")
        return results

    # List catalogs
    ok, result = _run_sql("SHOW CATALOGS", sql_warehouse_id)
    if ok:
        catalogs = [row[0] for row in result.get("result", {}).get("data_array", []) if row]
        catalogs = [c for c in catalogs if c not in ("system", "samples", "__databricks_internal")]
        print(f"  Found {len(catalogs)} catalogs: {', '.join(catalogs)}\n")

        # Process catalogs in parallel (up to 4 at a time)
        with ThreadPoolExecutor(max_workers=4) as executor:
            futures = {executor.submit(_grant_catalog, cat): cat for cat in catalogs}
            for future in as_completed(futures):
                for line in future.result():
                    print(line)
    else:
        print(f"  Could not list catalogs: {result}")

    print("\nUnity Catalog grants complete.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 3c: Configure On-Behalf-Of-User (OBO) Authorization Scopes
# MAGIC
# MAGIC The app runs user-facing Databricks calls (Genie, SQL, Unity Catalog, Lakeview
# MAGIC dashboards, workspace files) **on behalf of the logged-in user**, so each person's own
# MAGIC permissions apply (row filters, column masks, grants) rather than the service
# MAGIC principal's. That requires declaring the OAuth scopes the app needs; users then consent
# MAGIC on first visit.
# MAGIC
# MAGIC These scopes are **not** reliably applied from `app.yaml` for an app that already
# MAGIC exists, so we set them explicitly via the Apps API here. (Lakeview dashboard
# MAGIC create/publish still runs on the service principal — see `server/routes/dashboards.py`.)

# COMMAND ----------

from databricks.sdk.service.apps import App, GitRepository

print(f"Setting OBO scopes on app '{APP_NAME}':")
for s in USER_API_SCOPES:
    print(f"  - {s}")

# Use the SDK update (PATCH under the hood). The old raw PUT fallback always 404'd
# ("No API found for PUT /apps/..."), and a raw PATCH fails with "Git repository is
# required" unless git_repository is included — so we always pass it along.
try:
    w.apps.update(
        name=APP_NAME,
        app=App(
            name=APP_NAME,
            user_api_scopes=USER_API_SCOPES,
            git_repository=GitRepository(url=GIT_REPO_URL, provider=GIT_PROVIDER),
        ),
    )
except Exception as e:
    print(f"  update failed: {e}")

# Verify by RE-FETCHING the app rather than trusting the update's echoed response.
# An update can appear to succeed yet not persist the scopes; re-reading is the only
# way to know what will actually be requested from users. Report the exact missing set.
applied = list(w.apps.get(name=APP_NAME).user_api_scopes or [])
missing = [s for s in USER_API_SCOPES if s not in applied]
scopes_ok = not missing

print(f"\n  Scopes now on app: {applied}")
if scopes_ok:
    print("  All requested OBO scopes are set.")
else:
    print(f"\n  WARNING: these scopes did NOT stick: {missing}")
    print("  Set them via the App's Authorization settings (UI: Apps > app > Edit >")
    print("  User authorization > Add scope), or from a workspace notebook:")
    print(f"    w.apps.update(name='{APP_NAME}', app=App(name='{APP_NAME}',")
    print(f"        user_api_scopes={USER_API_SCOPES},")
    print(f"        git_repository=GitRepository(url='{GIT_REPO_URL}', provider='{GIT_PROVIDER}')))")

print("\n  NOTE: Existing users must RE-CONSENT on their next visit after scopes change")
print("  (open the app > help '?' menu > Sign out & re-authorize, or an incognito window).")
print("  Without a scope delta there is no consent prompt and the 403 persists.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4: Grant the Service Principal Access to Lakebase
# MAGIC
# MAGIC First we register the SP as a Lakebase **instance role** — without it the app
# MAGIC can't even authenticate to Postgres (symptom: "Database not available" / the pool
# MAGIC fails to create), because SQL `GRANT`s assume the role already exists. As a
# MAGIC `DATABRICKS_SUPERUSER` the SP can also read/write tables created by the deploying
# MAGIC user and create its own. We then re-assert SQL grants as belt-and-suspenders.

# COMMAND ----------

# Create the SP's Lakebase instance role so it can authenticate to Postgres. This is the
# step that prevents "Database not available" on a fresh workspace — the SQL GRANTs below
# are not sufficient on their own because they silently no-op if the role doesn't exist.
from databricks.sdk.service.database import (
    DatabaseInstanceRole,
    DatabaseInstanceRoleIdentityType,
    DatabaseInstanceRoleMembershipRole,
)

try:
    _existing_roles = [r.name for r in w.database.list_database_instance_roles(instance_name=LAKEBASE_INSTANCE)]
except Exception as e:
    _existing_roles = []
    print(f"  Could not list instance roles: {e}")

if sp_id in _existing_roles:
    print(f"  Lakebase instance role for SP '{sp_id}' already exists.")
else:
    try:
        w.database.create_database_instance_role(
            instance_name=LAKEBASE_INSTANCE,
            database_instance_role=DatabaseInstanceRole(
                name=sp_id,
                identity_type=DatabaseInstanceRoleIdentityType.SERVICE_PRINCIPAL,
                membership_role=DatabaseInstanceRoleMembershipRole.DATABRICKS_SUPERUSER,
            ),
        )
        print(f"  Created DATABRICKS_SUPERUSER instance role for SP '{sp_id}'.")
    except Exception as e:
        print(f"  Could not create instance role (may already exist): {e}")

# NOTE: app stop/start cycles can de-provision this federated role — if the app later
# reports "Database not available", re-run this cell to recreate it.

# COMMAND ----------

# Refresh token (previous one may have expired)
cred = w.database.generate_database_credential(
    request_id=str(uuid.uuid4()),
    instance_names=[LAKEBASE_INSTANCE],
)
token = cred.token

try:
    conn = psycopg2.connect(
        host=host,
        port=5432,
        database=DATABASE_NAME,
        user=username,
        password=token,
        sslmode="require",
    )
    conn.autocommit = True
    cur = conn.cursor()

    grants = [
        f'GRANT ALL PRIVILEGES ON DATABASE {DATABASE_NAME} TO "{sp_id}"',
        # USAGE + CREATE so the SP can create its own tables on first use. Without
        # CREATE on `public`, lazy "CREATE TABLE IF NOT EXISTS" fails with
        # "permission denied for schema public" and the app then errors with
        # 'relation "..." does not exist'.
        f'GRANT ALL PRIVILEGES ON SCHEMA public TO "{sp_id}"',
        # Access to any objects that already exist (e.g. created during local dev
        # against this same Lakebase). Sequences matter for serial PKs (e.g.
        # semantic_cache.id) — without them INSERTs fail.
        f'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "{sp_id}"',
        f'GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO "{sp_id}"',
        # Future objects created by the SP itself are SP-owned (full access). Also
        # auto-grant objects created by *this deploying user* so tables made via
        # local dev stay accessible to the app's service principal.
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "{sp_id}"',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "{sp_id}"',
        f'ALTER DEFAULT PRIVILEGES FOR ROLE "{username}" IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "{sp_id}"',
        f'ALTER DEFAULT PRIVILEGES FOR ROLE "{username}" IN SCHEMA public GRANT ALL PRIVILEGES ON SEQUENCES TO "{sp_id}"',
    ]

    for sql in grants:
        try:
            cur.execute(sql)
            print(f"  OK: {sql[:60]}...")
        except Exception as e:
            print(f"  Note: {e}")

    cur.close()
    conn.close()
    print("Permissions granted to service principal.")
except Exception as e:
    print(f"Error granting permissions: {e}")
    print("You may need to grant these manually via the Lakebase psql console.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 5: Attach Lakebase as a Connected Resource
# MAGIC
# MAGIC This injects `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER` env vars into the app at runtime.

# COMMAND ----------

# Attach the Lakebase resource via the SDK update (PATCH). We include git_repository
# so the update succeeds on Git-only workspaces ("Git repository is required" otherwise).
from databricks.sdk.service.apps import App, AppResource, AppResourceDatabase, GitRepository

updated = False
try:
    w.apps.update(
        name=APP_NAME,
        app=App(
            name=APP_NAME,
            git_repository=GitRepository(url=GIT_REPO_URL, provider=GIT_PROVIDER),
            resources=[
                AppResource(
                    name=RESOURCE_NAME,
                    description="Lakebase for saved questions and chat history",
                    database=AppResourceDatabase(
                        instance_name=LAKEBASE_INSTANCE,
                        database_name=DATABASE_NAME,
                        permission="CAN_CONNECT_AND_CREATE",
                    ),
                )
            ],
        ),
    )
    updated = True
    print("  Resource attached via SDK update")
except Exception as e:
    print(f"  SDK update failed: {e}")

if not updated:
    print("  WARNING: Could not attach Lakebase resource automatically.")
    print(f"  Manually add resource '{RESOURCE_NAME}' in the app settings UI:")
    print(f"    Instance: {LAKEBASE_INSTANCE}, Database: {DATABASE_NAME}, Permission: CAN_CONNECT_AND_CREATE")

updated_app = w.apps.get(name=APP_NAME)

resources = updated_app.resources or []
print(f"Resources attached: {len(resources)}")
for r in resources:
    db = r.database
    if db:
        print(f"  - {r.name}: {db.instance_name} / {db.database_name}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 6: Deploy the App
# MAGIC
# MAGIC Deploys the app **from the Git repo** (`GIT_REPO_URL` @ `GIT_BRANCH`). No Workspace
# MAGIC Git folder or snapshot is used, so this works in Git-only workspaces. Make sure any
# MAGIC code changes (including a rebuilt `frontend/dist/`) are pushed to that branch first.

# COMMAND ----------

from databricks.sdk.service.apps import AppDeployment, GitSource, GitRepository

# Deploy directly from the Git repo (branch GIT_BRANCH). No Workspace snapshot —
# this is what works in workspaces with "only allow app deployments from Git".
print(f"Deploying from Git: {GIT_REPO_URL} @ {GIT_BRANCH}")

# Ensure the app's compute is in a deployable state. The compute_status states are
# ACTIVE / STARTING / STOPPED / STOPPING / UPDATING / DELETING / ERROR (there is no
# "RUNNING" — that's app_status, not compute_status). Deploy is fine when compute is
# ACTIVE (running) or STOPPED; while it's transitioning (STARTING/STOPPING/UPDATING) a
# start() call is rejected with "compute is in ACTIVE state", so we only start from a
# STOPPED state and otherwise wait for the transition to finish.
SETTLED = ("ACTIVE", "STOPPED", "ERROR")

def _compute_state():
    a = w.apps.get(name=APP_NAME)
    return str(a.compute_status.state) if a.compute_status else ""

compute_state = _compute_state()
print(f"  Compute state: {compute_state}")

if "STOPPED" in compute_state:
    print("  Compute is stopped. Starting it first...")
    try:
        w.apps.start(name=APP_NAME)
    except Exception as e:
        print(f"  Note: {e}")

# Wait for compute to settle into a deployable state (ACTIVE / STOPPED) before deploying.
for _attempt in range(30):
    compute_state = _compute_state()
    if any(s in compute_state for s in SETTLED):
        print(f"  Compute is {compute_state}")
        break
    print(f"  Waiting for compute to settle... (state: {compute_state}, attempt {_attempt + 1})")
    time.sleep(10)
else:
    print("  WARNING: Compute did not settle. Attempting deploy anyway...")

# The repo is already bound at the app level (Step 3), so the documented deploy
# form is just the branch. Some API versions want the repo echoed inside git_source,
# so fall back to that if the branch-only form is rejected.
def _deploy(git_source):
    return w.apps.deploy_and_wait(
        app_name=APP_NAME,
        app_deployment=AppDeployment(git_source=git_source),
    )

try:
    deployment = _deploy(GitSource(branch=GIT_BRANCH))
except Exception as e:
    print(f"  Branch-only deploy failed ({e}); retrying with explicit git_repository...")
    deployment = _deploy(GitSource(
        git_repository=GitRepository(url=GIT_REPO_URL, provider=GIT_PROVIDER),
        branch=GIT_BRANCH,
    ))

status = deployment.status
print(f"  Deploy state: {status.state if status else 'N/A'}")
print(f"  Message: {status.message if status else 'N/A'}")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Deployment Complete!

# COMMAND ----------

app = w.apps.get(name=APP_NAME)

print("=" * 60)
print(f"  App Name:    {app.name}")
print(f"  App URL:     {app.url}")
print(f"  State:       {app.app_status.state if app.app_status else 'N/A'}")
print(f"  Compute:     {app.compute_status.state if app.compute_status else 'N/A'}")
print(f"  Resources:   {len(app.resources or [])} attached")
print(f"  Logs:        {app.url}/logz")
print("=" * 60)

# COMMAND ----------

# MAGIC %md
# MAGIC ## Troubleshooting
# MAGIC
# MAGIC | Problem | Fix |
# MAGIC |---|---|
# MAGIC | App shows "Not Available" | Ensure `app.yaml` has `--port 8000` |
# MAGIC | "Database not connected" in sidebar | Re-run Steps 4 and 5 above, then redeploy (Step 6) |
# MAGIC | Blank page / no frontend | `frontend/dist/` is missing on the deployed branch — build locally, commit, and push to `GIT_BRANCH`, then redeploy |
# MAGIC | "Git repository is required" on update/deploy | The app has no Git repo bound — re-run Step 3 (it attaches `GIT_REPO_URL` to the existing app) |
# MAGIC | "compute is in ACTIVE state" when starting | Compute is mid-transition; wait for it to reach ACTIVE/STOPPED (Step 6 now waits automatically) |
# MAGIC | Deploy fails with package errors | Check `requirements.txt` has clean `package>=version` lines |
# MAGIC | Genie/SQL calls 403 for a user | They haven't consented to the OBO scopes — have them reload the app and approve, or re-run Step 3c |
# MAGIC | "Save to dashboard" / charts fail | Confirm the SP can reach a running SQL warehouse (Step 3) and `sql.dashboards` is in the OBO scopes (Step 3c) |
# MAGIC
# MAGIC **To view logs:** append `/logz` to the app URL shown above.
# MAGIC
# MAGIC ---
# MAGIC
# MAGIC ## Cleanup
# MAGIC
# MAGIC Uncomment and run the cells below to delete everything.

# COMMAND ----------

# # Uncomment to delete the app
# w.apps.delete(name=APP_NAME)
# print(f"App '{APP_NAME}' deleted.")

# COMMAND ----------

# # Uncomment to delete the Lakebase instance (PERMANENT - deletes all data!)
# w.database.delete_database_instance(name=LAKEBASE_INSTANCE)
# print(f"Lakebase instance '{LAKEBASE_INSTANCE}' deleted.")
