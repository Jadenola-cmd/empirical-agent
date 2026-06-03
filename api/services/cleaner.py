import pandas as pd
import numpy as np
from typing import Dict, Any, Tuple, List


def merge_files(dfs: Dict[str, pd.DataFrame], config: Dict[str, Any]) -> pd.DataFrame:
    strategy = config.get("strategy", "inner")
    keys = config.get("keys", [])
    files_order = config.get("files_order", list(dfs.keys()))

    ordered = [dfs[f] for f in files_order if f in dfs]
    for name, df in dfs.items():
        if name not in files_order:
            ordered.append(df)

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
            raise ValueError(f"合并键 {keys} 在某个文件中不存在")
        result = result.merge(df, on=common_keys, how=strategy, suffixes=("", "_dup"))
        dup_cols = [c for c in result.columns if c.endswith("_dup")]
        result = result.drop(columns=dup_cols)

    return result


def apply_log_transform(df: pd.DataFrame, log_cols: List[str]) -> Tuple[pd.DataFrame, List[str]]:
    """
    对指定列做自然对数变换，生成 ln_变量名 新列
    自动跳过含0或负值的列（用 log(1+x) 处理），并在报告中说明
    """
    added = []
    warnings = []
    for col in log_cols:
        if col not in df.columns:
            continue
        s = pd.to_numeric(df[col], errors="coerce")
        new_col = f"ln_{col}"
        if (s.dropna() <= 0).any():
            # 有非正值，改用 log(1+x)
            df[new_col] = np.log1p(s.clip(lower=0))
            warnings.append(f"{col} 含0或负值，使用 ln(1+x)")
        else:
            df[new_col] = np.log(s)
        added.append(new_col)
    return df, added, warnings


def clean_data(df: pd.DataFrame, config: Dict[str, Any]) -> Tuple[pd.DataFrame, Dict]:
    df = df.copy()
    report = {
        "rows_before": len(df),
        "cols_before": len(df.columns),
        "steps": [],
    }

    # 1. 删除列
    drop_cols = config.get("drop_cols", [])
    if drop_cols:
        existing = [c for c in drop_cols if c in df.columns]
        df = df.drop(columns=existing)
        report["steps"].append({"step": "删除列", "detail": f"删除了 {existing}"})

    # 2. 重命名
    rename_cols = config.get("rename_cols", {})
    if rename_cols:
        df = df.rename(columns=rename_cols)
        report["steps"].append({"step": "重命名列", "detail": str(rename_cols)})

    # 3. 对数变换（在缺失值处理前执行，保留更多样本）
    log_cols = config.get("log_cols", [])
    if log_cols:
        df, added_cols, log_warnings = apply_log_transform(df, log_cols)
        detail = f"生成列：{added_cols}"
        if log_warnings:
            detail += f"；警告：{'; '.join(log_warnings)}"
        report["steps"].append({"step": "对数变换", "detail": detail})
        report["log_cols_added"] = added_cols

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

    if outlier_strategy == "zscore" and numeric_cols:
        from scipy import stats
        numeric_cols_now = df.select_dtypes(include="number").columns.tolist()
        z_scores = np.abs(stats.zscore(df[numeric_cols_now].dropna()))
        mask = (z_scores < threshold).all(axis=1)
        rows_before = len(df)
        df_numeric = df[numeric_cols_now].dropna()
        valid_idx = df_numeric.index[mask]
        df = df.loc[df.index.isin(valid_idx) | ~df.index.isin(df_numeric.index)]
        outliers_removed = rows_before - len(df)
        report["steps"].append({
            "step": "异常值处理",
            "detail": f"Z-score法（阈值={threshold}σ），移除 {outliers_removed} 行"
        })

    elif outlier_strategy == "iqr" and numeric_cols:
        numeric_cols_now = df.select_dtypes(include="number").columns.tolist()
        rows_before = len(df)
        for col in numeric_cols_now:
            Q1 = df[col].quantile(0.25)
            Q3 = df[col].quantile(0.75)
            IQR = Q3 - Q1
            df = df[(df[col] >= Q1 - threshold * IQR) | df[col].isna() |
                    (df[col] <= Q3 + threshold * IQR)]
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
