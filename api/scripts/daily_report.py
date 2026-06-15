"""每日数据日报：统计前一天的访问/转化数据，以飞书卡片消息推送到群机器人。

用法：python daily_report.py
依赖环境变量：FEISHU_WEBHOOK_URL

建议通过 crontab 每天定时执行，例如每天 9:00：
    0 9 * * * cd /www/empirical-agent/api && venv/bin/python scripts/daily_report.py >> logs/daily_report.log 2>&1
"""
import json
import os
import sys
import urllib.request
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone

from dotenv import load_dotenv

load_dotenv(os.path.join(os.path.dirname(__file__), "..", ".env"))

sys.path.insert(0, os.path.dirname(__file__))
from analysis_usage_report import ANALYSIS_TYPE_LABELS  # noqa: E402

BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
EVENTS_FILE = os.path.join(BASE_DIR, "events.jsonl")
LEADS_FILE = os.path.join(BASE_DIR, "leads.jsonl")

CST = timezone(timedelta(hours=8))

EVENT_LABELS = {
    "page_view": "访问页面",
    "file_uploaded": "上传文件",
    "clean_completed": "完成清洗",
    "analysis_run": "运行分析",
    "analysis_success": "分析成功",
    "analysis_error": "分析出错",
    "export_clicked": "点击导出",
    "interpret_used": "AI解读",
    "trial_modal_shown": "试用弹窗展示",
    "trial_modal_submitted": "试用申请提交",
    "trial_modal_skipped": "试用弹窗跳过",
}

# 核心转化漏斗（按顺序），用唯一访客数统计每一步的转化率
FUNNEL_STEPS = [
    ("page_view", "访问页面"),
    ("file_uploaded", "上传文件"),
    ("clean_completed", "完成清洗"),
    ("analysis_run", "运行分析"),
    ("analysis_success", "分析成功"),
    ("export_clicked", "点击导出"),
]


def load_jsonl(path):
    records = []
    if not os.path.exists(path):
        return records
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return records


def in_target_day(ts_str, day_start_utc, day_end_utc):
    ts = datetime.fromisoformat(ts_str)
    return day_start_utc <= ts < day_end_utc


def build_card(target_date):
    """target_date: 北京时间日期 (date 对象)，统计该日 00:00-24:00。"""
    day_start_cst = datetime(target_date.year, target_date.month, target_date.day, tzinfo=CST)
    day_end_cst = day_start_cst + timedelta(days=1)
    day_start_utc = day_start_cst.astimezone(timezone.utc)
    day_end_utc = day_end_cst.astimezone(timezone.utc)

    events = [e for e in load_jsonl(EVENTS_FILE) if in_target_day(e["timestamp"], day_start_utc, day_end_utc)]
    leads = [l for l in load_jsonl(LEADS_FILE) if in_target_day(l["timestamp"], day_start_utc, day_end_utc)]

    visitors = {e.get("visitor_id") for e in events if e.get("visitor_id")}
    ev_counter = Counter(e["event"] for e in events)
    pv = ev_counter.get("page_view", 0)

    def unique_visitors(event_type):
        return {e.get("visitor_id") for e in events if e["event"] == event_type and e.get("visitor_id")}

    elements = [{
        "tag": "markdown",
        "content": (
            f"**UV（独立访客）** {len(visitors)}　|　**PV（页面浏览）** {pv}　|　"
            f"**事件总数** {len(events)}　|　**新增试用线索** {len(leads)}"
        ),
    }]

    funnel_counts = {}
    if events:
        elements.append({"tag": "hr"})
        elements.append({"tag": "markdown", "content": "**核心转化漏斗**（按独立访客数）"})

        funnel_rows = []
        prev_count = None
        for event_type, label in FUNNEL_STEPS:
            count = len(unique_visitors(event_type))
            funnel_counts[event_type] = count
            rate = "—" if prev_count is None else (f"{count / prev_count * 100:.0f}%" if prev_count > 0 else "—")
            funnel_rows.append({"step": label, "uv": count, "rate": rate})
            prev_count = count
        elements.append({
            "tag": "table",
            "page_size": 10,
            "row_height": "low",
            "header_style": {"bold": True, "background_style": "grey", "text_align": "left"},
            "columns": [
                {"name": "step", "display_name": "环节", "data_type": "text"},
                {"name": "uv", "display_name": "独立访客数", "data_type": "number", "horizontal_align": "right"},
                {"name": "rate", "display_name": "转化率", "data_type": "text", "horizontal_align": "right"},
            ],
            "rows": funnel_rows,
        })

        elements.append({"tag": "hr"})
        elements.append({"tag": "markdown", "content": "**功能使用排名**（按事件次数）"})
        rank_rows = [
            {"name": EVENT_LABELS.get(event_type, event_type), "count": count}
            for event_type, count in ev_counter.most_common()
        ]
        elements.append({
            "tag": "table",
            "page_size": 15,
            "row_height": "low",
            "header_style": {"bold": True, "background_style": "grey", "text_align": "left"},
            "columns": [
                {"name": "name", "display_name": "功能", "data_type": "text"},
                {"name": "count", "display_name": "次数", "data_type": "number", "horizontal_align": "right"},
            ],
            "rows": rank_rows,
        })

        # 分析功能使用情况（按 analysis_success 拆分 analysis_types，统计 PV/UV 及占比）
        analysis_events = [e for e in events if e["event"] == "analysis_success"]
        if analysis_events:
            type_stats = defaultdict(lambda: {"count": 0, "visitors": set()})
            for e in analysis_events:
                visitor = e.get("visitor_id")
                types = (e.get("props") or {}).get("analysis_types") or []
                for t in types:
                    type_stats[t]["count"] += 1
                    if visitor:
                        type_stats[t]["visitors"].add(visitor)

            total_count = sum(v["count"] for v in type_stats.values())
            total_uv = len(set().union(*(v["visitors"] for v in type_stats.values())))

            usage_rows = []
            for analysis_type, v in sorted(type_stats.items(), key=lambda kv: kv[1]["count"], reverse=True):
                count = v["count"]
                uv = len(v["visitors"])
                usage_rows.append({
                    "name": ANALYSIS_TYPE_LABELS.get(analysis_type, analysis_type),
                    "pv": count,
                    "pv_pct": f"{count / total_count * 100:.0f}%" if total_count else "—",
                    "uv": uv,
                    "uv_pct": f"{uv / total_uv * 100:.0f}%" if total_uv else "—",
                })

            elements.append({"tag": "hr"})
            elements.append({"tag": "markdown", "content": "**分析功能使用情况**（按当日 analysis_success 事件统计）"})
            elements.append({
                "tag": "table",
                "page_size": 20,
                "row_height": "low",
                "header_style": {"bold": True, "background_style": "grey", "text_align": "left"},
                "columns": [
                    {"name": "name", "display_name": "分析功能", "data_type": "text"},
                    {"name": "pv", "display_name": "PV", "data_type": "number", "horizontal_align": "right"},
                    {"name": "pv_pct", "display_name": "PV占比", "data_type": "text", "horizontal_align": "right"},
                    {"name": "uv", "display_name": "UV", "data_type": "number", "horizontal_align": "right"},
                    {"name": "uv_pct", "display_name": "UV占比", "data_type": "text", "horizontal_align": "right"},
                ],
                "rows": usage_rows,
            })

        # 申请试用弹窗
        shown = ev_counter.get("trial_modal_shown", 0)
        submitted = ev_counter.get("trial_modal_submitted", 0)
        skipped = ev_counter.get("trial_modal_skipped", 0)
        if shown:
            rate = f"{submitted / shown * 100:.0f}%"
            elements.append({"tag": "hr"})
            elements.append({
                "tag": "markdown",
                "content": (
                    f"**\"申请试用\"弹窗**\n展示 {shown} 次，提交 {submitted} 次，跳过 {skipped} 次"
                    f"　→　转化率约 {rate}"
                ),
            })

        # 异常
        errors = [e for e in events if e["event"] == "analysis_error"]
        if errors:
            elements.append({"tag": "hr"})
            error_lines = "\n".join(
                f"- {e.get('props', {}).get('error', '未知错误')}" for e in errors
            )
            elements.append({
                "tag": "markdown",
                "content": f"**异常**（{len(errors)} 次 analysis_error）\n{error_lines}",
            })

        # 亮点摘要
        elements.append({"tag": "hr"})
        top_uv = funnel_counts.get("page_view", 0)
        upload_uv = funnel_counts.get("file_uploaded", 0)
        run_uv = funnel_counts.get("analysis_run", 0)
        success_uv = funnel_counts.get("analysis_success", 0)
        highlight_parts = []
        if top_uv:
            upload_rate = upload_uv / top_uv * 100
            highlight_parts.append(f"{top_uv} 个访客中有 {upload_uv} 人上传文件尝试使用（转化率约 {upload_rate:.0f}%）")
        if run_uv:
            highlight_parts.append(f"进入分析流程的 {run_uv} 人中有 {success_uv} 人成功完成分析")
        if leads:
            highlight_parts.append(f"新增 {len(leads)} 条试用申请线索")
        if highlight_parts:
            elements.append({"tag": "markdown", "content": "**亮点**：" + "；".join(highlight_parts) + "。"})
    else:
        elements.append({"tag": "hr"})
        elements.append({"tag": "markdown", "content": "昨日无访问数据。"})

    if leads:
        elements.append({"tag": "hr"})
        lead_lines = "\n".join(f"- {l.get('contact')}（来源 {l.get('source') or '-'}）" for l in leads)
        elements.append({"tag": "markdown", "content": f"**试用线索**\n{lead_lines}"})

    return {
        "msg_type": "interactive",
        "card": {
            "schema": "2.0",
            "config": {"wide_screen_mode": True},
            "header": {
                "title": {"tag": "plain_text", "content": f"📊 empirical-agent 日报 · {target_date.isoformat()}"},
                "template": "blue",
            },
            "body": {"elements": elements},
        },
    }


def send_to_feishu(card_payload):
    webhook_url = os.environ.get("FEISHU_WEBHOOK_URL")
    if not webhook_url:
        raise RuntimeError("环境变量 FEISHU_WEBHOOK_URL 未设置")
    payload = json.dumps(card_payload).encode("utf-8")
    req = urllib.request.Request(
        webhook_url, data=payload, headers={"Content-Type": "application/json"}, method="POST"
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        result = json.loads(resp.read().decode("utf-8"))
    if result.get("code") != 0:
        raise RuntimeError(f"飞书推送失败: {result}")
    return result


if __name__ == "__main__":
    yesterday = (datetime.now(CST) - timedelta(days=1)).date()
    card_payload = build_card(yesterday)
    send_to_feishu(card_payload)
