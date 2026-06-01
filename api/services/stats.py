import pandas as pd
import numpy as np
import statsmodels.api as sm
from scipy import stats
from typing import List, Optional, Dict, Any


# ── 显著性星号（与 Stata 一致）──
def sig_stars(p: float) -> str:
    if p < 0.01:  return "***"
    if p < 0.05:  return "**"
    if p < 0.1:   return "*"
    return ""


# ── 1. 描述性统计（对齐 Stata summarize, detail）──
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
            "sd":     round(float(s.std(ddof=1)), 6),   # Stata 用 ddof=1
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


# ── 2. 相关系数矩阵（对齐 Stata pwcorr, sig）──
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


# ── 3. OLS 回归（对齐 Stata regress）──
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
    # 强制转换为数值，非数值变 NaN 后再删除
    for col in cols_needed:
        sub[col] = pd.to_numeric(sub[col], errors="coerce")
    sub = sub.dropna()
    y = sub[dep_var]
    X = sm.add_constant(sub[all_x_vars], has_constant="add")

    model = sm.OLS(y, X)

    # 标准误类型
    if cluster_var:
        groups = sub[cluster_var]
        res = model.fit(cov_type="cluster", cov_kwds={"groups": groups})
        se_type = f"clustered({cluster_var})"
    elif robust_se:
        res = model.fit(cov_type="HC1")   # Stata robust = HC1
        se_type = "robust(HC1)"
    else:
        res = model.fit()
        se_type = "conventional"

    # 系数列表
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


# ── 4. 面板回归（对齐 Stata xtreg, fe/re）──
def run_panel(
    df: pd.DataFrame,
    dep_var: str,
    indep_vars: List[str],
    control_vars: List[str] = [],
    entity_var: str = "firm_id",
    time_var: str = "year",
    model_type: str = "fe",   # "fe" | "re"
    robust_se: bool = False,
    cluster_var: Optional[str] = None,
) -> Dict:
    from linearmodels.panel import PanelOLS, RandomEffects, BetweenOLS

    all_x_vars = indep_vars + control_vars
    cols_needed = [dep_var, entity_var, time_var] + all_x_vars
    if cluster_var:
        cols_needed.append(cluster_var)

    sub = df[cols_needed].dropna().copy()
    for col in cols_needed:
        sub[col] = pd.to_numeric(sub[col], errors="coerce")
    sub = sub.dropna()

    # 设置面板索引（entity + time）
    sub = sub.set_index([entity_var, time_var])

    y = sub[dep_var]
    X = sm.add_constant(sub[all_x_vars], has_constant="add")

    # 协方差类型
    if cluster_var:
        # cluster_var 在设置面板索引后需要用 entity 作为聚类
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
        stata_cmd = f"xtreg {dep_var} {' '.join(all_x_vars)}, fe"
    else:
        model = RandomEffects(y, X)
        stata_cmd = f"xtreg {dep_var} {' '.join(all_x_vars)}, re"

    res = model.fit(cov_type=cov_type, **cov_kwds)

    # Hausman 检验（FE vs RE，仅在 FE 时顺带运行）
    hausman = None
    if model_type == "fe":
        try:
            re_model = RandomEffects(y, X)
            re_res = re_model.fit(cov_type="unadjusted")
            # 手动 Hausman 检验
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

    # 系数
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
        "notes":         f"括号内为t值，{cov_type}标准误，***p<0.01, **p<0.05, *p<0.1",
    }
