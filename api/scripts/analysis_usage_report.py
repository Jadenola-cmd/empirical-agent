"""分析功能使用报表：按天统计每种分析类型的使用次数与独立访客数（UV）。

用法：
    python analysis_usage_report.py            # 统计全部历史数据
    python analysis_usage_report.py --days 7   # 仅统计最近7天（按北京时间）

数据来源：analysis_success 事件的 props.analysis_types（一次分析可勾选多个类型，按类型拆分计数）。
"""
import argparse
import json
import os
from collections import defaultdict
from datetime import datetime, timedelta, timezone

BASE_DIR = os.path.join(os.path.dirname(__file__), "..", "data")
EVENTS_FILE = os.path.join(BASE_DIR, "events.jsonl")

CST = timezone(timedelta(hours=8))

# 对应 pages/index.js 中 ANALYSIS_REGISTRY 的 title
ANALYSIS_TYPE_LABELS = {
    "descriptive":     "描述性统计",
    "correlation":     "相关系数矩阵",
    "panel_balance":   "面板平衡性检查",
    "ols":             "OLS 回归",
    "panel_fe":        "固定效应",
    "panel_re":        "随机效应",
    "probit":          "Probit 回归",
    "logit":           "Logit 回归",
    "did":             "双重差分 DID",
    "did_event":       "多时点DID事件研究",
    "iv":              "工具变量法 2SLS",
    "moderation":      "调节效应分析",
    "mediation":       "中介效应分析",
    "heterogeneity":   "异质性分析",
    "did_robustness":  "DID稳健性检验",
    "psm":             "倾向得分匹配 PSM",
    "psm_did":         "PSM-DID 基期锁定匹配",
    "pca":             "主成分分析 PCA",
}


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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--days", type=int, default=None, help="仅统计最近N天（按北京时间，含今天）")
    parser.add_argument("--event", default="analysis_success",
                         choices=["analysis_success", "analysis_run"],
                         help="统计依据的事件类型，默认 analysis_success（分析成功完成）")
    args = parser.parse_args()

    events = load_jsonl(EVENTS_FILE)
    events = [e for e in events if e.get("event") == args.event]

    cutoff = None
    if args.days is not None:
        today_cst = datetime.now(CST).date()
        cutoff_date = today_cst - timedelta(days=args.days - 1)
        cutoff = datetime(cutoff_date.year, cutoff_date.month, cutoff_date.day, tzinfo=CST).astimezone(timezone.utc)

    # day -> analysis_type -> {"count": int, "visitors": set}
    stats = defaultdict(lambda: defaultdict(lambda: {"count": 0, "visitors": set()}))

    for e in events:
        ts = datetime.fromisoformat(e["timestamp"])
        if cutoff is not None and ts < cutoff:
            continue
        day = ts.astimezone(CST).date().isoformat()
        visitor = e.get("visitor_id")
        types = (e.get("props") or {}).get("analysis_types") or []
        for t in types:
            stats[day][t]["count"] += 1
            if visitor:
                stats[day][t]["visitors"].add(visitor)

    if not stats:
        print("无数据。")
        return

    for day in sorted(stats.keys()):
        print(f"\n=== {day} ===")
        rows = sorted(stats[day].items(), key=lambda kv: kv[1]["count"], reverse=True)
        day_total = sum(v["count"] for v in stats[day].values())
        day_total_uv = len(set().union(*(v["visitors"] for v in stats[day].values())))
        print(f"{'分析功能':<24}{'中文名':<20}{'次数':>6}{'占比':>8}{'UV':>6}{'UV占比':>9}")
        for analysis_type, v in rows:
            label = ANALYSIS_TYPE_LABELS.get(analysis_type, analysis_type)
            pct = v["count"] / day_total * 100 if day_total else 0
            uv = len(v["visitors"])
            uv_pct = uv / day_total_uv * 100 if day_total_uv else 0
            print(f"{analysis_type:<24}{label:<20}{v['count']:>6}{pct:>7.1f}%{uv:>6}{uv_pct:>8.1f}%")


if __name__ == "__main__":
    main()
