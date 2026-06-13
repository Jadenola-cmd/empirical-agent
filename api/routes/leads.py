from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional, Any
import json
import os
import logging
from datetime import datetime, timezone
from routes.activation import get_shared_code

logger = logging.getLogger("empirical")

router = APIRouter()

LEADS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "leads.jsonl")
EVENTS_FILE = os.path.join(os.path.dirname(__file__), "..", "data", "events.jsonl")


class LeadRequest(BaseModel):
    contact: str
    source: Optional[str] = None


class EventRequest(BaseModel):
    event: str
    source: Optional[str] = None
    visitor_id: Optional[str] = None
    props: Optional[dict[str, Any]] = None


@router.post("/submit")
async def submit_lead(req: LeadRequest):
    contact = req.contact.strip()
    record = {
        "contact": contact,
        "source": req.source,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    os.makedirs(os.path.dirname(LEADS_FILE), exist_ok=True)
    with open(LEADS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    logger.info("[lead] contact=%s source=%s", contact, req.source or "-")
    return {"success": True, "activation_code": get_shared_code()}


@router.post("/event")
async def log_event(req: EventRequest):
    record = {
        "event": req.event,
        "source": req.source,
        "visitor_id": req.visitor_id,
        "props": req.props,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    os.makedirs(os.path.dirname(EVENTS_FILE), exist_ok=True)
    with open(EVENTS_FILE, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")
    logger.info("[event] %s visitor=%s props=%s", req.event, req.visitor_id or "-", req.props)
    return {"success": True}
