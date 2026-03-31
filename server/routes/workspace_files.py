import base64
from fastapi import APIRouter, HTTPException, Query
from server.config import get_workspace_client, get_workspace_host, get_auth_headers
import httpx

router = APIRouter(tags=["workspace-files"])


@router.get("/workspace/list")
async def list_workspace_path(path: str = Query("/", description="Workspace path to list")):
    """List files and directories in a workspace path."""
    host = get_workspace_host()
    headers = get_auth_headers()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{host}/api/2.0/workspace/list",
                headers=headers,
                params={"path": path},
            )
            resp.raise_for_status()
            data = resp.json()
            objects = data.get("objects", [])
            items = []
            for obj in objects:
                name = obj.get("path", "").rsplit("/", 1)[-1]
                obj_type = obj.get("object_type", "")
                language = obj.get("language", "")
                items.append({
                    "path": obj.get("path", ""),
                    "name": name,
                    "type": obj_type,  # DIRECTORY, FILE, NOTEBOOK
                    "language": language,
                    "is_sql": (
                        language == "SQL"
                        or name.endswith(".sql")
                        or name.endswith(".txt")
                    ),
                })
            # Sort: directories first, then files alphabetically
            items.sort(key=lambda x: (0 if x["type"] == "DIRECTORY" else 1, x["name"].lower()))
            return {"path": path, "items": items}
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 404:
            return {"path": path, "items": [], "error": "Path not found"}
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/workspace/read")
async def read_workspace_file(path: str = Query(..., description="Workspace file path")):
    """Read the content of a workspace file or notebook."""
    host = get_workspace_host()
    headers = get_auth_headers()
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get(
                f"{host}/api/2.0/workspace/export",
                headers=headers,
                params={"path": path, "format": "SOURCE", "direct_download": "true"},
            )
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "")
            if "application/json" in content_type:
                data = resp.json()
                # Base64 encoded content
                raw = data.get("content", "")
                content = base64.b64decode(raw).decode("utf-8", errors="replace")
            else:
                content = resp.text
            return {"path": path, "content": content}
    except httpx.HTTPStatusError as e:
        raise HTTPException(status_code=e.response.status_code, detail=e.response.text)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
