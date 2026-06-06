import pandas as pd
import numpy as np
from typing import Dict, Any, Tuple


def merge_files(dfs: Dict[str, pd.DataFrame], config: Dict[str, Any]) -> pd.DataFrame:
    strategy = config.get("strategy", "inner")
    keys = config.get("keys", [])
    files_order = config.get("files_order", list(dfs.keys()))
    field_maps = config.get("field_maps", {})

    # 合并前应用字段映射
    renamed_dfs = {}
    for name, df in dfs.items():
        df = df.copy()
        if name in field_maps and field_maps[name]:
            df = df.rename(columns=field_maps[name])
        renamed_dfs[name] = df

    ordered = [renamed_dfs[f] for f in files_order if f in renamed_dfs]
    for name in renamed_dfs:
        if name not in files_order:
            ordered.append(renamed_dfs[name])

    if len(ordered) == 1:
        return ordered[0].copy()

    if strategy == "concat":
        return pd.concat(ordered, ignore_index=True)

    if not keys:
        raise ValueError("横向合并需要指定合并键 keys，如 ['firm_id', 'year']")

    result = ordered[0]
    for df in ordered[1:]:
        common_keys = [k for k in keys if k in result.columns and k in df.columns]
        if not common_keys:
            raise ValueError(f"合并键 {keys} 在某个文件中不存在，请先用字段映射统一列名")
        result = result.merge(df, on=common_keys, how=strategy, suffixes=("", "_dup"))
        dup_cols = [c for c in result.columns if c.endswith("_dup")]
        result = result.drop(columns=dup_cols)

    return result


def check_merge_type(dfs: Dict[str, pd.DataFrame], keys: list, field_maps: dict = {}) -> Dict:
    if not keys:
        return {"ok": True, "type": "unknown", "details": []}

    details = []
    all_unique = True

    for name, df in dfs.items():
        df = df.copy()
        if name in field_maps and field_maps[name]:
            df = df.rename(columns=field_maps[name])

        available_keys = [k for k in keys if k in df.columns]
        if not available_keys:
            details.append({
                "file": name,
                "has_keys": False,
                "is_unique": False,
                "dup_count": 0,
                "message": f"文件中没有找到键 {keys}"
            })
            all_unique = False
            continue

        total = len(df)
        unique = df[available_keys].drop_duplicates().shape[0]
        is_unique = (total == unique)
        if not is_unique:
            all_unique = False

        details.append({
            "file": name,
            "has_keys": True,
            "is_unique": is_unique,
            "dup_count": total - unique,
            "total_rows": total,
            "unique_rows": unique,
            "message": "键唯一（1端）" if is_unique else f"键重复 {total - unique} 次（N端）"
        })

    unique_counts = [d["is_unique"] for d in details if d["has_keys"]]
    if all(unique_counts):
        merge_type = "1:1"
        warning = None
    elif sum(unique_counts) == len(unique_counts) - 1:
        merge_type = "1:N"
        warning = None
    else:
        merge_type = "N:N"
        warning = "⚠️ 检测到 N:N 合并：多个文件的键均不唯一，将产生笛卡尔积，行数可能爆炸。请确认这是预期行为。"

    return {
        "ok": merge_type != "N:N",
        "type": merge_type,
        "warning": warning,
        "details": details,
    }


def clean_data(df: pd.DataFrame, config: Dict[str, Any]) -> Tuple[pd.DataFrame, Dict]:
    df = df.copy()
    report = {
        "rows_before": len(df),
        "cols_before": len(df.columns),
        "steps": [],
    }

    # 0. 强制文本型列（放在最前，防止股票代码等被当数字处理）
    str_cols = config.get("str_cols", [])
    if str_cols:
        existing = [c for c in str_cols if c in df.columns]
        for col in existing:
            df[col] = df[col].astype(str)
        report["steps"].append({"step": "强制文本型", "detail": f"{existing}"})

    # 1. 删除列
    drop_cols = config.get("drop_cols", [])
    if drop_cols:
        existing = [c for c in drop_cols if c in df.columns]
        df = df.drop(columns=existing)
        report["steps"].append({"step": "删除列", "detail": f"删除了 {existing}"})

    # 2. 重命名（合并后）
    rename_cols = config.get("rename_cols", {})
    if rename_cols:
        df = df.rename(columns=rename_cols)
        report["steps"].append({"step": "重命名列", "detail": str(rename_cols)})

    # 3. 对数变换
    log_vars = config.get("log_vars", [])
    log_created = []
    for col in log_vars:
        if col not in df.columns:
            continue
        series = pd.to_numeric(df[col], errors="coerce")
        new_col = f"ln_{col}"
        has_non_positive = (series <= 0).any()
        if has_non_positive:
            df[new_col] = np.log1p(series.clip(lower=0))
            log_created.append(f"{new_col}=ln(1+{col})")
        else:
            df[new_col] = np.log(series)
            log_created.append(f"{new_col}=ln({col})")
    if log_created:
        report["steps"].append({"step": "对数变换", "detail": "，".join(log_created)})

    # 4. 缺失值处理
    missing_strategy = config.get("missing", "drop")
    numeric_cols = df.select_dtypes(include="number").columns.tolist()
    missing_before = int(df.isnull().sum().sum())

    if missing_strategy == "drop":
        df = df.dropna()
        report["steps"].append({"step": "缺失值处理", "detail": "删除含缺失值的行"})
    elif missing_strategy == "mean":
        df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].mean())
        report["steps"].append({"step": "缺失值处理", "detail": "数值列用均值填充"})
    elif missing_strategy == "median":
        df[numeric_cols] = df[numeric_cols].fillna(df[numeric_cols].median())
        report["steps"].append({"step": "缺失值处理", "detail": "数值列用中位数填充"})
    elif missing_strategy == "ffill":
        df = df.ffill()
        report["steps"].append({"step": "缺失值处理", "detail": "前向填充"})
    elif missing_strategy == "bfill":
        df = df.bfill()
        report["steps"].append({"step": "缺失值处理", "detail": "后向填充"})
    elif missing_strategy == "zero":
        df[numeric_cols] = df[numeric_cols].fillna(0)
        report["steps"].append({"step": "缺失值处理", "detail": "数值列用0填充"})

    missing_after = int(df.isnull().sum().sum())
    report["missing_handled"] = missing_before - missing_after

    # 5. 异常值处理
    outlier_strategy = config.get("outlier", "none")
    threshold = float(config.get("outlier_threshold", 3.0))
    outliers_removed = 0
    numeric_cols = df.select_dtypes(include="number").columns.tolist()

    if outlier_strategy == "zscore" and numeric_cols:
        from scipy import stats
        df_num = df[numeric_cols].dropna()
        z_scores = np.abs(stats.zscore(df_num))
        mask = (z_scores < threshold).all(axis=1)
        valid_idx = df_num.index[mask]
        rows_before = len(df)
        df = df.loc[df.index.isin(valid_idx) | ~df.index.isin(df_num.index)]
        outliers_removed = rows_before - len(df)
        report["steps"].append({
            "step": "异常值处理",
            "detail": f"Z-score法（阈值={threshold}σ），移除 {outliers_removed} 行"
        })

    elif outlier_strategy == "iqr" and numeric_cols:
        rows_before = len(df)
        for col in numeric_cols:
            Q1 = df[col].quantile(0.25)
            Q3 = df[col].quantile(0.75)
            IQR = Q3 - Q1
            df = df[
                df[col].isna() |
                ((df[col] >= Q1 - threshold * IQR) & (df[col] <= Q3 + threshold * IQR))
            ]
        outliers_removed = rows_before - len(df)
        report["steps"].append({
            "step": "异常值处理",
            "detail": f"IQR法（倍数={threshold}），移除 {outliers_removed} 行"
        })

    df = df.reset_index(drop=True)
    report["rows_after"] = len(df)
    report["cols_after"] = len(df.columns)
    report["outliers_removed"] = outliers_removed

    return df, report


def get_cleaning_report(report: Dict) -> str:
    lines = [
        f"原始数据：{report['rows_before']} 行 × {report['cols_before']} 列",
        f"清洗后：{report['rows_after']} 行 × {report['cols_after']} 列",
        f"处理缺失值：{report.get('missing_handled', 0)} 个",
        f"移除异常值：{report.get('outliers_removed', 0)} 行",
    ]
    for step in report.get("steps", []):
        lines.append(f"• {step['step']}：{step['detail']}")
    return "\n".join(lines)