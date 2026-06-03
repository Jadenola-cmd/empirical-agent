import pandas as pd
import numpy as np
import statsmodels.api as sm
from scipy import stats
from typing import List, Optional, Dict, Any


def sig_stars(p: float) -> str:
    if p < 0.01:  return "***"
    if p < 0.05:  return "**"
    if p < 0.1:   return "*"
    return ""


def run_descriptive(df: pd.DataFrame, numeric_cols: List[str]) -> Dict:
    result = []
    for col in numeric_cols:
        s = df[col].dropna()
        if len(s) == 0:
            continue
        result.append({
            "name":   col,
            "obs":    int(s.count()),
            "mean":   round(float(s.mean()), 6),
            "sd":     round(float(s.std(ddof=1)), 6),
            "min":    round(float(s.min()), 6),
            "p25":    round(float(s.quantile(0.25)), 6),
            "median": round(float(s.median()), 6),
            "p75":    round(float(s.quantile(0.75)), 6),
            "max":    round(float(s.max()), 6),
            "skew":   round(float(s.skew()), 6),
            "kurt":   round(float(s.kurt()), 6),
        })
    return {
        "type": "descriptive",
        "vars": result,
        "notes": "样本标准差（ddof=1），与 Stata summarize 一致",
    }


def run_correlation(df: pd.DataFrame, numeric_cols: List[str]) -> Dict:
    sub = df[numeric_cols].dropna()
    n = len(sub)
    matrix = []
    for i, vi in enumerate(numeric_cols):
        row = []
        for j, vj in enumerate(numeric_cols):
            if i == j:
                row.append({"coef": 1.0, "p_value": 0.0, "sig": "", "n": int(sub[vi].count())})
            else:
                coef, p = stats.pearsonr(sub[vi], sub[vj])
                row.append({
                    "coef":    round(float(coef), 6),
                    "p_value": round(float(p), 6),
                    "sig":     sig_stars(p),
                    "n":       n,
                })
        matrix.append(row)
    return {
        "type":   "correlation",
        "method": "pearson",
        "vars":   numeric_cols,
        "matrix": matrix,
        "notes":  "***p<0.01, **p<0.05, *p<0.1，与 Stata pwcorr 一致",
    }


def run_ols(
    df: pd.DataFrame,
    dep_var: str,
    indep_vars: List[str],
    control_vars: List[str] = [],
    robust_se: bool = False,
    cluster_var: Optional[str] = None,
) -> Dict:
    all_x_vars = indep_vars + control_vars
    cols_needed = [dep_var] + all_x_vars
    if cluster_var:
        cols_needed.append(cluster_var)

    sub = df[cols_needed].dropna().copy()
=======
    # 强制转换为数值，非数值变 NaN 后再删除
>>>>>>> b11b39409eb50702ba532cf56bc27e7d379cda26
    for col in cols_needed:
        sub[col] = pd.to_numeric(sub[col], errors="coerce")
    sub = sub.dropna()
    y = sub[dep_var]
    X = sm.add_constant(sub[all_x_vars], has_constant="add")

    model = sm.OLS(y, X)

    if cluster_var:
        groups = sub[cluster_var]
        res = model.fit(cov_type="cluster", cov_kwds={"groups": groups})
        se_type = f"clustered({cluster_var})"
    elif robust_se:
        res = model.fit(cov_type="HC1")
        se_type = "robust(HC1)"
    else:
        res = model.fit()
        se_type = "conventional"

    coefs = []
    for name in res.params.index:
        p = float(res.pvalues[name])
        coefs.append({
            "variable":   name if name != "const" else "_cons",
            "coef":       round(float(res.params[name]), 6),
            "std_error":  round(float(res.bse[name]), 6),
            "t_stat":     round(float(res.tvalues[name]), 4),
            "p_value":    round(p, 6),
            "sig":        sig_stars(p),
            "ci_lower":   round(float(res.conf_int().loc[name, 0]), 6),
            "ci_upper":   round(float(res.conf_int().loc[name, 1]), 6),
        })

    return {
        "type":        "ols",
        "dep_var":     dep_var,
        "indep_vars":  indep_vars,
        "control_vars": control_vars,
        "n":           int(res.nobs),
        "r2":          round(float(res.rsquared), 6),
        "r2_adj":      round(float(res.rsquared_adj), 6),
        "f_stat":      round(float(res.fvalue), 4) if res.fvalue else None,
        "f_pvalue":    round(float(res.f_pvalue), 6) if res.f_pvalue else None,
        "df_model":    int(res.df_model),
        "df_resid":    int(res.df_resid),
        "se_type":     se_type,
        "coefficients": coefs,
        "notes":       f"括号内为t值，{se_type}标准误，***p<0.01, **p<0.05, *p<0.1",
    }


def run_panel(
    df: pd.DataFrame,
    dep_var: str,
    indep_vars: List[str],
    control_vars: List[str] = [],
    entity_var: str = "firm_id",
    time_var: str = "year",
    model_type: str = "fe",
    robust_se: bool = False,
    cluster_var: Optional[str] = None,
) -> Dict:
    from linearmodels.panel import PanelOLS, RandomEffects
    from numpy.linalg import matrix_rank

    all_x_vars = indep_vars + control_vars
    cols_needed = [dep_var, entity_var, time_var] + all_x_vars
    if cluster_var:
        cols_needed.append(cluster_var)

    sub = df[cols_needed].dropna().copy()
    for col in cols_needed:
        sub[col] = pd.to_numeric(sub[col], errors="coerce")
    sub = sub.dropna()

    sub = sub.set_index([entity_var, time_var])
    y = sub[dep_var]
    X_raw = sub[all_x_vars]

<<<<<<< HEAD
    # ── 共线性检测：逐列贪心保留，对齐 Stata omit 行为 ──
    dropped = []
    X_arr = X_raw.values.astype(float)
    rank = matrix_rank(X_arr)
    if rank < X_raw.shape[1]:
        keep = []
        for col in X_raw.columns:
            candidate = keep + [col]
            test = X_raw[candidate].values.astype(float)
            if matrix_rank(test) > len(keep):
                keep.append(col)
            else:
                dropped.append(col)
        # 保护：至少保留1个变量，否则整体报错更清晰
        if len(keep) == 0:
            raise ValueError(
                f"所有解释变量（{all_x_vars}）完全共线，无法估计。"
                "请检查是否有常数列或变量之间完全线性相关。"
            )
    }
