from fastapi import APIRouter, HTTPException, Query
from pathlib import Path
import os, re
from collections import defaultdict
from datetime import datetime

router = APIRouter()

LOG_PATHS = [
    Path.home() / ".pm2/logs/empirical-api-out.log",
    Path("/root/.pm2/logs/empirical-api-out.log"),
    Path("/www/empirical-agent/api/logs/out.log"),
]
TAIL_LINES = 20_000

_UPLOAD_RE  = re.compile(r"(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}.*\[upload\] files=(.+)")
_ANALYZE_RE = re.compile(r"(\d{4}-\d{2}-\d{2}) \d{2}:\d{2}:\d{2}.*\[analyze\] types=(\S+) dep=(\S+) errors=(\S+) ai=(\S+)")


def _tail(path: Path, n: int) -> list[str]:
    """读取文件最后 n 行，避免大文件全量加载。"""
    with open(path, "rb") as f:
        f.seek(0, 2)
        size = f.tell()
        buf, chunk = b"", 65536
        pos = size
        while pos > 0 and buf.count(b"\n") <= n:
            pos = max(0, pos - chunk)
            f.seek(pos)
            buf = f.read(min(chunk, size - pos)) + buf
    lines = buf.decode("utf-8", errors="replace").splitlines()
    return lines[-n:]


def _parse_logs(lines: list[str]) -> dict:
    uploads_by_day   = defaultdict(int)
    analyzes_by_day  = defaultdict(int)
    type_counter     = defaultdict(int)
    error_counter    = defaultdict(int)
    ai_count         = 0
    total_uploads    = 0
    total_analyzes   = 0

    for line in lines:
        m = _UPLOAD_RE.search(line)
        if m:
            total_uploads += 1
            uploads_by_day[m.group(1)] += 1
            continue

        m = _ANALYZE_RE.search(line)
        if m:
            day, types, dep, errors, ai = m.group(1), m.group(2), m.group(3), m.group(4), m.group(5)
            total_analyzes += 1
            analyzes_by_day[day] += 1
            for t in types.split(","):
                type_counter[t] += 1
            if errors != "none":
                for e in errors.split(","):
                    error_counter[e] += 1
            if ai.lower() == "true":
                ai_count += 1

    all_days = sorted(set(list(uploads_by_day) + list(analyzes_by_day)))
    daily = [
        {"date": d, "uploads": uploads_by_day[d], "analyzes": analyzes_by_day[d]}
        for d in all_days[-14:]  # 只返回最近 14 天
    ]

    return {
        "total_uploads":   total_uploads,
        "total_analyzes":  total_analyzes,
        "conversion_rate": f"{total_analyzes/total_uploads*100:.1f}%" if total_uploads else "—",
        "ai_usage_rate":   f"{ai_count/total_analyzes*100:.1f}%" if total_analyzes else "—",
        "top_features":    sorted(type_counter.items(), key=lambda x: -x[1]),
        "error_types":     sorted(error_counter.items(), key=lambda x: -x[1]),
        "daily_last14":    daily,
    }


@router.get("/health")
def health():
    return {"status": "ok"}


@router.get("/admin/stats")
def admin_stats(key: str = Query(default="")):
    admin_key = os.environ.get("ADMIN_KEY", "")
    if admin_key and key != admin_key:
        raise HTTPException(status_code=403, detail="invalid key")

    log_path = next((p for p in LOG_PATHS if p.exists()), None)
    if log_path is None:
        return {
            "error": "日志文件未找到",
            "searched": [str(p) for p in LOG_PATHS],
        }

    lines = _tail(log_path, TAIL_LINES)
    stats = _parse_logs(lines)
    stats["log_file"]   = str(log_path)
    stats["lines_read"] = len(lines)
    stats["generated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    return stats
