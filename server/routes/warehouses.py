from fastapi import APIRouter, HTTPException
from server.config import get_workspace_client

router = APIRouter(tags=["warehouses"])


@router.get("/warehouses")
async def list_warehouses():
    try:
        w = get_workspace_client()
        warehouses = []
        for wh in w.warehouses.list():
            warehouses.append({
                "id": wh.id,
                "name": wh.name,
                "state": str(wh.state) if wh.state else "",
                "cluster_size": wh.cluster_size or "",
            })
        return {"warehouses": warehouses}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/warehouses/{warehouse_id}/start")
async def start_warehouse(warehouse_id: str):
    try:
        w = get_workspace_client()
        w.warehouses.start(warehouse_id)
        return {"started": True, "warehouse_id": warehouse_id}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
