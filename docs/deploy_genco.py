# Databricks notebook source

# MAGIC %md
# MAGIC # Genco Deployment Notebook
# MAGIC
# MAGIC This notebook deploys the **Genco Genie Room Manager** app to your Databricks workspace.
# MAGIC
# MAGIC **Prerequisites:**
# MAGIC - The Genco source code must already be in a Git folder at `/Workspace/Users/<your-email>/genco`
# MAGIC - The `frontend/dist/` directory must be pre-built and committed to the repo
# MAGIC - Your workspace must have **serverless compute** enabled
# MAGIC
# MAGIC **What this notebook does:**
# MAGIC 1. Creates a Lakebase instance (`genco-cache`)
# MAGIC 2. Creates the `genco` database
# MAGIC 3. Creates the Databricks App
# MAGIC 3b. Mirrors your Genie room permissions to the app's service principal
# MAGIC 3c. Grants the SP read access to all Unity Catalog tables you have access to
# MAGIC 4. Grants the app's service principal access to Lakebase
# MAGIC 5. Attaches Lakebase as a connected resource
# MAGIC 6. Deploys the app
# MAGIC
# MAGIC ---

# COMMAND ----------

# MAGIC %md
# MAGIC ## Install Dependencies

# COMMAND ----------

# MAGIC %pip install databricks-sdk --upgrade -q
dbutils.library.restartPython()

# COMMAND ----------

# MAGIC %md
# MAGIC ## Configuration
# MAGIC
# MAGIC Edit these values if you want to customize names. Defaults work out of the box.

# COMMAND ----------

APP_NAME = "genco"
APP_DESCRIPTION = "Genco - Genie Room Manager"
LAKEBASE_INSTANCE = "genco-cache"
LAKEBASE_CAPACITY = "CU_1"  # CU_1, CU_2, CU_4, CU_8
DATABASE_NAME = "genco"
RESOURCE_NAME = "genco-cache-db"

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
print(f"Source path: /Workspace/Users/{username}/genco")

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

from databricks.sdk.service.apps import App

try:
    app = w.apps.get(name=APP_NAME)
    print(f"App '{APP_NAME}' already exists.")
    print(f"  URL: {app.url}")
    print(f"  State: {app.app_status.state if app.app_status else 'N/A'}")
except Exception:
    print(f"Creating app '{APP_NAME}'...")
    app = w.apps.create_and_wait(
        app=App(
            name=APP_NAME,
            description=APP_DESCRIPTION,
        )
    )
    print(f"  App created!")
    print(f"  URL: {app.url}")

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
        w.groups.patch(
            id=users_group.id,
            schemas=[PatchSchema.URN_IETF_PARAMS_SCIM_API_MESSAGES_2_0_PATCH_OP],
            operations=[
                PatchOp(
                    op="add",
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

# Mirror the deploying user's Genie room permissions to the service principal
print("\nGranting Genie room permissions to service principal...")
print("(Mirroring your permissions so the app has the same access you do)\n")
import requests as _req

_host = w.config.host.rstrip("/")
_headers = w.config.authenticate()
_headers["Content-Type"] = "application/json"

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

_host = w.config.host.rstrip("/")
_headers = w.config.authenticate()
_headers["Content-Type"] = "application/json"

print("Granting Unity Catalog access to service principal...")
print(f"  SP Client ID: {sp_id}\n")

# Find a serverless SQL warehouse to run GRANT statements
warehouses_resp = _req.get(f"{_host}/api/2.0/sql/warehouses", headers=_headers)
warehouses_resp.raise_for_status()
wh_list = warehouses_resp.json().get("warehouses", [])
sql_warehouse_id = None
for wh in wh_list:
    if wh.get("warehouse_type") == "PRO" or wh.get("enable_serverless_compute"):
        if wh.get("state") in ("RUNNING", "STARTING"):
            sql_warehouse_id = wh["id"]
            break
if not sql_warehouse_id and wh_list:
    # Fall back to any available warehouse
    for wh in wh_list:
        if wh.get("state") in ("RUNNING", "STARTING"):
            sql_warehouse_id = wh["id"]
            break

if not sql_warehouse_id:
    print("  WARNING: No running SQL warehouse found. Skipping UC grants.")
    print("  You can manually grant access with: GRANT USE CATALOG ON CATALOG <name> TO `<sp_id>`")
else:
    print(f"  Using warehouse: {sql_warehouse_id}\n")

    def _run_sql(statement, warehouse_id):
        """Execute a SQL statement via the Statement API and return success."""
        resp = _req.post(
            f"{_host}/api/2.0/sql/statements",
            headers=_headers,
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

    # Step 1: List catalogs the current user can see
    ok, result = _run_sql("SHOW CATALOGS", sql_warehouse_id)
    if ok:
        catalogs = [row[0] for row in result.get("result", {}).get("data_array", []) if row]
        print(f"  Found {len(catalogs)} catalogs: {', '.join(catalogs)}\n")

        for catalog in catalogs:
            # Skip system and built-in catalogs
            if catalog in ("system", "samples", "__databricks_internal"):
                continue

            # Grant USE CATALOG + CREATE SCHEMA (for sample data generator)
            ok_cat, err = _run_sql(f"GRANT USE CATALOG ON CATALOG `{catalog}` TO `{sp_id}`", sql_warehouse_id)
            _run_sql(f"GRANT CREATE SCHEMA ON CATALOG `{catalog}` TO `{sp_id}`", sql_warehouse_id)
            if ok_cat:
                print(f"  Granted USE CATALOG + CREATE SCHEMA on '{catalog}'")
            else:
                print(f"  Note (catalog '{catalog}'): {err}")

            # List schemas in this catalog
            ok_schemas, schema_result = _run_sql(f"SHOW SCHEMAS IN `{catalog}`", sql_warehouse_id)
            if not ok_schemas:
                continue

            schemas = [row[0] for row in schema_result.get("result", {}).get("data_array", []) if row]
            for schema in schemas:
                if schema in ("information_schema",):
                    continue

                # Grant USE SCHEMA + CREATE TABLE (for sample data generator)
                ok_sch, _ = _run_sql(
                    f"GRANT USE SCHEMA ON SCHEMA `{catalog}`.`{schema}` TO `{sp_id}`",
                    sql_warehouse_id,
                )
                _run_sql(
                    f"GRANT CREATE TABLE ON SCHEMA `{catalog}`.`{schema}` TO `{sp_id}`",
                    sql_warehouse_id,
                )

                # Grant SELECT + MODIFY on all tables in this schema
                ok_sel, err = _run_sql(
                    f"GRANT SELECT, MODIFY ON SCHEMA `{catalog}`.`{schema}` TO `{sp_id}`",
                    sql_warehouse_id,
                )
                if ok_sel:
                    print(f"    Granted SELECT on '{catalog}'.'{schema}'")
                else:
                    # Fallback: try granting on individual tables
                    ok_tables, tables_result = _run_sql(
                        f"SHOW TABLES IN `{catalog}`.`{schema}`", sql_warehouse_id
                    )
                    if ok_tables:
                        tables = [row[1] for row in tables_result.get("result", {}).get("data_array", []) if row and len(row) > 1]
                        for table in tables:
                            _run_sql(
                                f"GRANT SELECT ON TABLE `{catalog}`.`{schema}`.`{table}` TO `{sp_id}`",
                                sql_warehouse_id,
                            )
                        if tables:
                            print(f"    Granted SELECT on {len(tables)} tables in '{catalog}'.'{schema}'")
    else:
        print(f"  Could not list catalogs: {result}")

    print("\nUnity Catalog grants complete.")

# COMMAND ----------

# MAGIC %md
# MAGIC ## Step 4: Grant the Service Principal Access to Lakebase
# MAGIC
# MAGIC The app's service principal needs PostgreSQL permissions to read/write tables.

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
        f'GRANT ALL PRIVILEGES ON SCHEMA public TO "{sp_id}"',
        f'GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO "{sp_id}"',
        f'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "{sp_id}"',
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

from databricks.sdk.service.apps import AppResource, AppResourceDatabase

# Use the REST API directly to avoid SDK enum issues
import json as _json
import requests as _req

_host = w.config.host.rstrip("/")
_headers = w.config.authenticate()
_resp = _req.patch(
    f"{_host}/api/2.0/apps/{APP_NAME}",
    headers={**_headers, "Content-Type": "application/json"},
    json={
        "resources": [
            {
                "name": RESOURCE_NAME,
                "description": "Lakebase for saved questions and chat history",
                "database": {
                    "instance_name": LAKEBASE_INSTANCE,
                    "database_name": DATABASE_NAME,
                    "permission": "CAN_CONNECT_AND_CREATE",
                },
            }
        ]
    },
)
_resp.raise_for_status()
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
# MAGIC Deploys the source code and starts the app.

# COMMAND ----------

from databricks.sdk.service.apps import AppDeployment, AppDeploymentMode

source_path = f"/Workspace/Users/{username}/genco"
print(f"Deploying from: {source_path}")

deployment = w.apps.deploy_and_wait(
    app_name=APP_NAME,
    app_deployment=AppDeployment(
        source_code_path=source_path,
        mode=AppDeploymentMode.SNAPSHOT,
    ),
)

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
# MAGIC | Blank page / no frontend | `frontend/dist/` is missing — build locally, commit, and pull the Git folder |
# MAGIC | Deploy fails with package errors | Check `requirements.txt` has clean `package>=version` lines |
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
