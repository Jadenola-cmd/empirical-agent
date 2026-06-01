import pandas as pd
import numpy as np
from typing import Dict, Any, Tuple


def merge_files(dfs: Dict[str, pd.DataFrame], config: Dict[str, Any]) -> pd.DataFrame:
    """
    合并多个 DataFrame

    config:
      strategy: left | inner | outer | concat（纵向堆叠）
      keys: 合并键列表，如 ["firm_id", "year"]
      files_order: 文件合并顺序
    """
    strategy = config.get("strategy", "inner")
    keys = config.get("keys", [])
    files_order = config.get("files_order", list(dfs.keys()))

    # 按指定顺序排列
    ordered = [dfs[f] for f in files_order if f in dfs]
    # 加入未指定顺序的文件
    for name, df in dfs.items():
        if name not in files_order:
            ordered.append(df)

    if len(ordered) == 1:
        return ordered[0].copy()

    if strategy == "concat":
        # 纵向堆叠（适合同结构数据）
        return pd.concat(ordered, ignore_index=True)

    # 横向合并
    if not keys:
        raise ValueError("横向合并需要指定合并键 keys，如 ['firm_id', 'year']")

    result = ordered[0]
    for df in ordered[1:]:
        # 找出当前两个 df 共有的键
        common_keys = [k for k in keys if k in result.columns and k in df.columns]
        if not common_keys:
            raise ValueError(f"合并键 {keys} 在某个文件中不存在")
        result = result.merge(df, on=common_keys, how=strategy, suffixes=("", "_dup"))
        # 去掉重复列
        dup_cols = [c for c in result.columns if c.endswith("_dup")]
        result = result.drop(columns=dup_cols)

    return result


def clean_data(df: pd.DataFrame, config: Dict[str, Any]) -> Tuple[pd.DataFrame, Dict]:
    """
    数据清洗

    config:
      missing: drop | mean | median | ffill | bfill | zero
      outlier: none | iqr | zscore
      outlier_threshold: float（zscore 的 σ 倍数，默认 3；IQR 的倍数，默认 1.5）
      drop_cols: 删除的列
      rename_cols: 重命名列 {"old": "new"}
    """
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

    # 3. 缺失值处理
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

    # 4. 异常值处理
    outlier_strategy = config.get("outlier", "none")
    threshold = float(config.get("outlier_threshold", 3.0))
    outliers_removed = 0

    if outlier_strategy == "zscore" and numeric_cols:
        from scipy import stats
        z_scores = np.abs(stats.zscore(df[numeric_cols].dropna()))
        mask = (z_scores < threshold).all(axis=1)
        rows_before = len(df)
        df_numeric = df[numeric_cols].dropna()
        valid_idx = df_numeric.index[mask]
        df = df.loc[df.index.isin(valid_idx) | ~df.index.isin(df_numeric.index)]
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
    """生成清洗摘要文字"""
    lines = [
        f"原始数据：{report['rows_before']} 行 × {report['cols_before']} 列",
        f"清洗后：{report['rows_after']} 行 × {report['cols_after']} 列",
        f"处理缺失值：{report.get('missing_handled', 0)} 个",
        f"移除异常值：{report.get('outliers_removed', 0)} 行",
    ]
    for step in report.get("steps", []):
        lines.append(f"• {step['step']}：{step['detail']}")
    return "\n".join(lines)
