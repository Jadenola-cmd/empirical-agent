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
<<<<<<< HEAD
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
=======
    # 自动移除完全共线的列
    from numpy.linalg import matrix_rank
    import numpy as np
    X_arr = X_raw.values.astype(float)
    rank = matrix_rank(X_arr)
    if rank < X_raw.shape[1]:
        # 逐列检测，移除导致共线的列
        keep = []
        dropped = []
        for i, col in enumerate(X_raw.columns):
            test = X_raw[keep + [col]].values.astype(float)
>>>>>>> b11b39409eb50702ba532cf56bc27e7d379cda26
            if matrix_rank(test) > len(keep):
                keep.append(col)
            else:
                dropped.append(col)
<<<<<<< HEAD
        # 保护：至少保留1个变量，否则整体报错更清晰
        if len(keep) == 0:
            raise ValueError(
                f"所有解释变量（{all_x_vars}）完全共线，无法估计。"
                "请检查是否有常数列或变量之间完全线性相关。"
            )
=======
>>>>>>> b11b39409eb50702ba532cf56bc27e7d379cda26
        X_raw = X_raw[keep]

    X = sm.add_constant(X_raw, has_constant="add")

    if cluster_var:
        cov_type = "clustered"
        cov_kwds = {"cluster_entity": True}
    elif robust_se:
        cov_type = "robust"
        cov_kwds = {}
    else:
        cov_type = "unadjusted"
        cov_kwds = {}

    if model_type == "fe":
        model = PanelOLS(y, X, entity_effects=True, time_effects=False)
        stata_cmd = f"xtreg {dep_var} {' '.join(X_raw.columns.tolist())}, fe"
    else:
        model = RandomEffects(y, X)
        stata_cmd = f"xtreg {dep_var} {' '.join(X_raw.columns.tolist())}, re"

    res = model.fit(cov_type=cov_type, check_rank=False, **cov_kwds)

    # Hausman 检验
    hausman = None
    if model_type == "fe":
        try:
            re_model = RandomEffects(y, X)
            re_res = re_model.fit(cov_type="unadjusted")
            b_fe = res.params
            b_re = re_res.params
            common = b_fe.index.intersection(b_re.index)
            diff = b_fe[common] - b_re[common]
            var_fe = pd.DataFrame(res.cov, index=res.params.index, columns=res.params.index)
            var_re = pd.DataFrame(re_res.cov, index=re_res.params.index, columns=re_res.params.index)
            V = var_fe.loc[common, common] - var_re.loc[common, common]
            chi2 = float(diff @ np.linalg.pinv(V.values) @ diff)
            df_h = len(common)
            p_h = float(1 - stats.chi2.cdf(chi2, df_h))
            hausman = {
                "chi2":       round(chi2, 4),
                "df":         df_h,
                "p_value":    round(p_h, 6),
                "conclusion": "拒绝随机效应，建议使用固定效应" if p_h < 0.05 else "不拒绝随机效应"
            }
        except Exception:
            hausman = None

    coefs = []
    for name in res.params.index:
        p = float(res.pvalues[name])
        coefs.append({
            "variable":   name if name != "const" else "_cons",
            "coef":       round(float(res.params[name]), 6),
            "std_error":  round(float(res.std_errors[name]), 6),
            "t_stat":     round(float(res.tstats[name]), 4),
            "p_value":    round(p, 6),
            "sig":        sig_stars(p),
        })

    omit_note = ""
    if dropped:
        omit_note = f"注：{dropped} 因完全共线性被自动省略（omitted），与 Stata 处理一致。"

    return {
        "type":          model_type,
        "dep_var":       dep_var,
        "indep_vars":    indep_vars,
        "control_vars":  control_vars,
        "entity_var":    entity_var,
        "time_var":      time_var,
        "n":             int(res.nobs),
        "n_entities":    int(res.estimated_effects.shape[0]) if hasattr(res, "estimated_effects") else None,
        "r2_within":     round(float(res.rsquared_within), 6) if hasattr(res, "rsquared_within") else None,
        "r2_between":    round(float(res.rsquared_between), 6) if hasattr(res, "rsquared_between") else None,
        "r2_overall":    round(float(res.rsquared_overall), 6) if hasattr(res, "rsquared_overall") else None,
        "f_stat":        round(float(res.f_statistic.stat), 4) if hasattr(res, "f_statistic") else None,
        "f_pvalue":      round(float(res.f_statistic.pval), 6) if hasattr(res, "f_statistic") else None,
        "se_type":       cov_type,
        "coefficients":  coefs,
        "hausman":       hausman,
        "stata_equivalent": stata_cmd,
<<<<<<< HEAD
        "dropped_vars":  dropped,
        "notes": f"括号内为t值，{cov_type}标准误，***p<0.01, **p<0.05, *p<0.1。{omit_note}",
=======
        "dropped_vars": dropped,  # 新增
        "notes": f"括号内为t值，{cov_type}标准误，***p<0.01, **p<0.05, *p<0.1" + 
                 (f"。注：{dropped} 因完全共线性被自动移除，与 Stata 处理一致" if dropped else ""),
>>>>>>> b11b39409eb50702ba532cf56bc27e7d379cda26
    }
