# Genie-Force Deployment Guide (Workspace + Git Only)

Deploy Genie-Force entirely from within your Databricks workspace — no local tools required. All you need is a browser and a Git repo.

---

## Prerequisites

- A Databricks workspace with **serverless compute** enabled
- The Genie-Force source code in a Git repository (GitHub, GitLab, Azure DevOps, etc.)
- The `frontend/dist/` directory **must be committed** to the repo (this is the pre-built frontend)

> **Important:** Before pushing to Git, build the frontend locally once (`cd frontend && npm install && npm run build`) and commit the `frontend/dist/` folder. This is required because the Databricks workspace does not have Node.js to build the frontend at deploy time.

---

## Step 1: Add a Git Folder in the Workspace

1. In your Databricks workspace, go to **Workspace** in the left sidebar
2. Navigate to your user folder: `/Users/<your-email>/`
3. Click the **kebab menu (...)** > **Create** > **Git folder**
4. Enter the Git repo URL and select the branch (e.g., `main`)
5. Click **Create Git folder**

The repo will be cloned to `/Workspace/Users/<your-email>/genco`.

---

## Step 2: Create a Lakebase Instance

1. In the left sidebar, go to **Compute** > **Lakebase**
2. Click **Create instance**
3. Configure:
   - **Name:** `genco-cache`
   - **Capacity:** `CU_1` (sufficient for small teams)
   - **Enable native login:** checked
4. Click **Create**
5. Wait for the status to show **Available** (2-5 minutes)

---

## Step 3: Create the Application Database

1. On the Lakebase instance page, click **Open psql** (or **Query editor**)
2. Run:

```sql
CREATE DATABASE genco;
```

---

## Step 4: Create the Databricks App

1. In the left sidebar, go to **Compute** > **Apps**
2. Click **Create app**
3. Configure:
   - **Name:** `genco`
   - **Description:** `Genie-Force - AI/BI Genie Room Manager`
4. Click **Create**

---

## Step 5: Add the Lakebase Resource

1. On the app page, click **Settings** (or **Edit**)
2. Under **Resources**, click **Add resource**
3. Select **Database**
4. Configure:
   - **Resource name:** `genco-cache-db`
   - **Instance:** `genco-cache`
   - **Database:** `genco`
   - **Permission:** `Can connect and create`
5. Click **Save**

---

## Step 6: Grant the Service Principal Access to Lakebase

The app has a service principal that needs Postgres permissions.

1. On the app page, note the **Service principal** name (e.g., `app-xxxxx genco`)
2. Go to **Compute** > **Lakebase** > **genco-cache**
3. Open the psql console and connect to the `genco` database
4. Find the service principal's client ID:
   - Go to **Settings** > **Identity and access** > **Service principals**
   - Find the app's service principal and copy its **Application ID** (UUID)
5. Run the following SQL, replacing `<SP_CLIENT_ID>` with the UUID:

```sql
\connect genco

GRANT ALL PRIVILEGES ON DATABASE genco TO "<SP_CLIENT_ID>";
GRANT ALL PRIVILEGES ON SCHEMA public TO "<SP_CLIENT_ID>";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO "<SP_CLIENT_ID>";
```

> **Tip:** If you don't have psql access from the UI, you can run this from a notebook instead. See the "Alternative: Notebook Setup" section below.

---

## Step 7: Deploy the App

1. Go to **Compute** > **Apps** > **genco**
2. Click **Deploy**
3. Set **Source code path** to: `/Workspace/Users/<your-email>/genco`
4. Click **Deploy**
5. Wait for the status to show **Running** (~30-60 seconds)

---

## Step 8: Open the App

Once deployed, click the **App URL** shown on the app page. The URL looks like:

```
https://genco-<workspace-id>.aws.databricksapps.com
```

---

## Updating the App

When you push new code to your Git repo:

1. Go to **Workspace** > your Git folder
2. Click **Pull** to sync the latest changes from the remote
3. Go to **Compute** > **Apps** > **genco**
4. Click **Deploy** again with the same source code path

> **Remember:** If frontend code changed, the `frontend/dist/` folder must be rebuilt and committed to Git before pulling.

---

## Alternative: Notebook Setup

If you prefer to automate Steps 2-7 from a notebook, create a new Python notebook and run:

```python
# Cell 1: Install Databricks CLI in the notebook environment
%pip install databricks-cli

# Cell 2: Create Lakebase instance
import subprocess, json, time

def run(cmd):
    result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Error: {result.stderr}")
    return result.stdout.strip()

# Create instance
run("databricks database create-database-instance genco-cache --capacity=CU_1 --enable-pg-native-login --no-wait")

# Wait for available
for i in range(20):
    out = run("databricks database get-database-instance genco-cache")
    if out:
        data = json.loads(out)
        if data.get("state") == "AVAILABLE":
            print("Lakebase instance ready!")
            break
    print(f"Waiting... ({i+1})")
    time.sleep(15)

# Cell 3: Create database
run('databricks psql genco-cache -- -c "CREATE DATABASE genco;"')

# Cell 4: Create app
run('databricks apps create genco --description "Genie-Force - AI/BI Genie Room Manager"')

# Cell 5: Get service principal ID and grant access
app_info = json.loads(run("databricks apps get genco --output json"))
sp_id = app_info["service_principal_client_id"]
print(f"Service Principal: {sp_id}")

run(f'''databricks psql genco-cache -- -d genco -c "
GRANT ALL PRIVILEGES ON DATABASE genco TO \\"{sp_id}\\";
GRANT ALL PRIVILEGES ON SCHEMA public TO \\"{sp_id}\\";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO \\"{sp_id}\\";
"''')

# Cell 6: Attach Lakebase resource
run('''databricks apps update genco --json '{
  "resources": [{
    "name": "genco-cache-db",
    "description": "Lakebase for saved questions and chat history",
    "database": {
      "instance_name": "genco-cache",
      "database_name": "genco",
      "permission": "CAN_CONNECT_AND_CREATE"
    }
  }]
}' ''')

# Cell 7: Deploy
import os
username = json.loads(run("databricks current-user me --output json"))["userName"]
run(f"databricks apps deploy genco --source-code-path /Workspace/Users/{username}/genco")

# Cell 8: Get app URL
app = json.loads(run("databricks apps get genco --output json"))
print(f"\nApp URL: {app['url']}")
print(f"Status: {app['app_status']['state']}")
```

---

## Verifying the Deployment

| Check | How |
|---|---|
| App is running | **Compute** > **Apps** > **genco** shows **Running** |
| Lakebase connected | Open the app, go to chat, sidebar shows "No saved questions yet" (not "Database not connected") |
| Logs | Append `/logz` to the app URL |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| App shows "Not Available" | Ensure `app.yaml` has `--port 8000` and `requirements.txt` is valid |
| "Database not connected" | Re-check Steps 5 and 6 — resource must be attached and SP must have grants |
| Blank page / no frontend | `frontend/dist/` is missing from the Git repo — build and commit it |
| Deploy fails with package errors | Check `requirements.txt` has clean `package>=version` format |
| "role does not exist" | The SP needs to connect once first, or manually create the role in psql |

---

## Cleanup

1. **Delete the app:** Compute > Apps > genco > Delete
2. **Delete Lakebase:** Compute > Lakebase > genco-cache > Delete
3. **Remove Git folder:** Workspace > right-click genco > Delete
