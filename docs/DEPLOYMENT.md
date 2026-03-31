# Genco Deployment Guide

Deploy the Genco Genie Room Manager app to any Databricks workspace using the Databricks CLI.

---

## Prerequisites

| Requirement | Version | Install |
|---|---|---|
| Databricks CLI | v0.229.0+ | [Install guide](https://docs.databricks.com/dev-tools/cli/install.html) |
| Node.js | 18+ | [nodejs.org](https://nodejs.org) |
| Python | 3.11+ | [python.org](https://www.python.org) |
| uv (Python package manager) | Latest | `curl -LsSf https://astral.sh/uv/install.sh \| sh` |
| PostgreSQL client (psql) | 16+ | `brew install postgresql@16` (macOS) |

Your Databricks workspace must have **serverless compute** enabled.

---

## Step 1: Get the Source Code

Clone or copy the Genco project to your local machine:

```bash
git clone <repo-url> genco
cd genco
```

Verify the project structure:

```
genco/
├── app.yaml              # Databricks App config
├── app.py                # FastAPI entry point
├── requirements.txt      # Python dependencies
├── pyproject.toml        # uv project config
├── server/               # Backend
│   ├── config.py         # Dual-mode auth (local / deployed)
│   ├── db.py             # Lakebase connection pool
│   └── routes/           # API endpoints
├── frontend/             # React + TypeScript + TailwindCSS
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
└── docs/
    └── DEPLOYMENT.md     # This file
```

---

## Step 2: Authenticate with Your Workspace

Log in to your Databricks workspace using the CLI. Replace `<workspace-url>` with your workspace URL and choose a profile name:

```bash
databricks auth login \
  --host https://<workspace-url> \
  --profile my-profile
```

Verify authentication:

```bash
databricks current-user me -p my-profile
```

You should see your user details (email, display name, etc.).

---

## Step 3: Build the Frontend

Install Node.js dependencies and create the production build:

```bash
cd frontend
npm install
npm run build
cd ..
```

This outputs the compiled frontend to `frontend/dist/`. This directory is included in the deployment — do **not** delete it.

---

## Step 4: Create a Lakebase Instance

Genco uses Lakebase (managed PostgreSQL) to persist saved questions and chat history.

### 4a. Create the instance

```bash
databricks database create-database-instance genco-cache \
  --capacity=CU_1 \
  --enable-pg-native-login \
  --no-wait \
  -p my-profile
```

**Capacity options:**

| Capacity | Resources | Use Case |
|---|---|---|
| `CU_1` | ~2 GB RAM | Development / small teams |
| `CU_2` | ~4 GB RAM | Light production |
| `CU_4` | ~8 GB RAM | Production |
| `CU_8` | ~16 GB RAM | Heavy production |

### 4b. Wait for the instance to become available

This typically takes 2-5 minutes:

```bash
# Check status
databricks database get-database-instance genco-cache -p my-profile

# Or poll until ready
while [ "$(databricks database get-database-instance genco-cache -p my-profile 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('state',''))" 2>/dev/null)" != "AVAILABLE" ]; do
  echo "Waiting for Lakebase instance..."
  sleep 15
done
echo "Lakebase instance is ready!"
```

### 4c. Create the application database

```bash
databricks psql genco-cache -p my-profile -- -c "CREATE DATABASE genco;"
```

> **Note:** The application tables (`saved_questions`, `chat_history`) are created automatically on first use. No manual schema setup is needed.

---

## Step 5: Create the Databricks App

```bash
databricks apps create genco \
  --description "Genco - Genie Room Manager" \
  -p my-profile
```

This registers the app and provisions a service principal for it.

---

## Step 6: Get the App's Service Principal ID

The app needs a Postgres role in Lakebase. First, retrieve the service principal client ID:

```bash
databricks apps get genco -p my-profile
```

Look for the `service_principal_client_id` field in the output. It looks like a UUID (e.g., `3dd40362-beb4-416a-a6a8-baf3f41dabcd`).

Save it to a variable for the next steps:

```bash
SP_ID=$(databricks apps get genco -p my-profile --output json | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['service_principal_client_id'])")
echo "Service Principal ID: $SP_ID"
```

---

## Step 7: Grant Lakebase Access to the Service Principal

The app's service principal needs permissions to connect to Lakebase and create/manage tables:

```bash
databricks psql genco-cache -p my-profile -- -d genco -c "
GRANT ALL PRIVILEGES ON DATABASE genco TO \"${SP_ID}\";
GRANT ALL PRIVILEGES ON SCHEMA public TO \"${SP_ID}\";
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO \"${SP_ID}\";
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL PRIVILEGES ON TABLES TO \"${SP_ID}\";
"
```

You should see four `GRANT` / `ALTER DEFAULT PRIVILEGES` confirmations.

---

## Step 8: Attach Lakebase as a Connected Resource

This tells the Databricks App to inject Lakebase connection details (`PGHOST`, `PGUSER`, etc.) as environment variables at runtime:

```bash
databricks apps update genco --json '{
  "resources": [
    {
      "name": "genco-cache-db",
      "description": "Lakebase for saved questions and chat history",
      "database": {
        "instance_name": "genco-cache",
        "database_name": "genco",
        "permission": "CAN_CONNECT_AND_CREATE"
      }
    }
  ]
}' -p my-profile
```

Verify the resource is attached:

```bash
databricks apps get genco -p my-profile --output json | \
  python3 -c "import sys,json; d=json.load(sys.stdin); print(json.dumps(d.get('resources',[]), indent=2))"
```

---

## Step 9: Upload Application Files

Determine your workspace username and sync the project files:

```bash
USERNAME=$(databricks current-user me -p my-profile --output json | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])")

databricks sync . /Users/${USERNAME}/genco \
  --exclude node_modules \
  --exclude .venv \
  --exclude __pycache__ \
  --exclude .git \
  --exclude .claude \
  --exclude "frontend/src" \
  --exclude "frontend/public" \
  --exclude "frontend/node_modules" \
  --exclude ".DS_Store" \
  --exclude "*.pyc" \
  -p my-profile
```

Wait for the `Initial Sync Complete` message.

---

## Step 10: Deploy

```bash
USERNAME=$(databricks current-user me -p my-profile --output json | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['userName'])")

databricks apps deploy genco \
  --source-code-path /Workspace/Users/${USERNAME}/genco \
  -p my-profile
```

The deployment takes ~30-60 seconds. Wait for `"state": "SUCCEEDED"` in the output.

---

## Step 11: Open the App

Get the app URL:

```bash
databricks apps get genco -p my-profile --output json | \
  python3 -c "import sys,json; print(json.load(sys.stdin)['url'])"
```

Open the URL in your browser. You're done!

---

## Verifying the Deployment

### Check app status

```bash
databricks apps get genco -p my-profile --output json | \
  python3 -c "
import sys,json
d=json.load(sys.stdin)
print('App state:', d['app_status']['state'])
print('URL:', d['url'])
print('Resources:', len(d.get('resources',[])), 'attached')
"
```

### View application logs

Append `/logz` to your app URL to access real-time logs:

```
https://<your-app-url>/logz
```

### Test Lakebase connectivity

The saved questions and chat history features depend on Lakebase. To verify, open the app, navigate to a Genie room chat, and check the left sidebar — if the "Saved" tab shows "No saved questions yet" (not "Database not connected"), Lakebase is working.

---

## Updating the App

After making code changes:

```bash
# 1. Rebuild frontend (if you changed frontend code)
cd frontend && npm run build && cd ..

# 2. Sync files
databricks sync . /Users/${USERNAME}/genco \
  --exclude node_modules \
  --exclude .venv \
  --exclude __pycache__ \
  --exclude .git \
  --exclude .claude \
  --exclude "frontend/src" \
  --exclude "frontend/public" \
  --exclude "frontend/node_modules" \
  --exclude ".DS_Store" \
  --exclude "*.pyc" \
  -p my-profile

# 3. Redeploy
databricks apps deploy genco \
  --source-code-path /Workspace/Users/${USERNAME}/genco \
  -p my-profile
```

---

## Troubleshooting

| Problem | Cause | Fix |
|---|---|---|
| `App Not Available` | App not listening on port 8000 | Check `app.yaml` has `--port 8000` |
| `Database not connected` in sidebar | Lakebase resource not attached or SP missing permissions | Re-run Steps 7 and 8, then redeploy |
| `password authentication failed` | OAuth token expired (local dev only) | Restart the backend — token auto-refreshes |
| `role "..." does not exist` | SP role not created in Postgres | Run Step 7 again |
| Frontend shows blank page | `frontend/dist/` not included in sync | Rebuild (`npm run build`) and re-sync |
| `Error installing packages` | Bad `requirements.txt` format | Ensure simple `package>=version` lines |

---

## Cleanup

To remove the app and Lakebase instance:

```bash
# Delete the app
databricks apps delete genco -p my-profile

# Delete the Lakebase instance (PERMANENT — deletes all data)
databricks database delete-database-instance genco-cache -p my-profile
```
