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


def _expand_categoricals(sub: pd.DataFrame, x_vars: List[str]) -> tuple:
    """Auto-expand object-dtype x vars to dummies, equivalent to Stata's xi: prefix.
    Returns (updated_sub, new_x_vars, dummy_info) where dummy_info maps
    original_var -> [generated_dummy_col_names].
    """
    cat_cols = [c for c in x_vars if c in sub.columns and pd.api.types.is_object_dtype(sub[c])]
    if not cat_cols:
        return sub, list(x_vars), {}

    dummy_info = {}
    for cv in cat_cols:
        d = pd.get_dummies(sub[cv], prefix=cv, drop_first=True).astype(float)
        sub = pd.concat([sub.drop(columns=[cv]), d], axis=1)
        dummy_info[cv] = list(d.columns)

    new_x = []
    for v in x_vars:
        new_x.extend(dummy_info[v] if v in dummy_info else [v])

    return sub, new_x, dummy_info


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


def run_panel_balance(df: pd.DataFrame, entity_var: str, time_var: str) -> Dict:
    sub = df[[entity_var, time_var]].copy()
    sub[entity_var] = sub[entity_var].astype(str).str.strip()
    sub[time_var] = pd.to_numeric(sub[time_var], errors="coerce")
    sub = sub.dropna()

    n_entities = sub[entity_var].nunique()
    n_times = sub[time_var].nunique()
    expected = n_entities * n_times
    actual = len(sub.drop_duplicates())
    is_balanced = expected == actual

    return {
        "type":         "panel_balance",
        "entity_var":   entity_var,
        "time_var":     time_var,
        "n_entities":   n_entities,
        "n_times":      n_times,
        "expected_obs": expected,
        "actual_obs":   actual,
        "is_balanced":  is_balanced,
        "missing_obs":  expected - actual,
        "notes": (
            "平衡面板：每个个体在每个时间点都有观测，对应 Stata xtdescribe 显示 100% 完整"
            if is_balanced else
            f"非平衡面板：缺失 {expected - actual} 个个体-时间观测组合，"
            "对应 Stata xtdescribe 可查看具体缺失模式；估计面板模型时仍可正常使用，但需在论文中注明"
        ),
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
    # Deduplicate to prevent duplicate-column DataFrame bug
    cols_needed = list(dict.fromkeys([dep_var] + all_x_vars))
    if cluster_var and cluster_var not in cols_needed:
        cols_needed.append(cluster_var)

    sub = df[cols_needed].copy()

    # Convert numeric cols; skip object-dtype cols (they'll be dummified)
    for col in [dep_var] + all_x_vars:
        if col in sub.columns and not pd.api.types.is_object_dtype(sub[col]):
            sub[col] = pd.to_numeric(sub[col], errors="coerce")

    # Expand categorical x vars to dummies (Stata xi: equivalent)
    sub, all_x_vars_final, dummy_info = _expand_categoricals(sub, all_x_vars)

    dropna_cols = [dep_var] + all_x_vars_final
    if cluster_var:
        dropna_cols.append(cluster_var)
    sub = sub.dropna(subset=list(dict.fromkeys(dropna_cols)))

    if len(sub) == 0:
        raise ValueError("转换为数值后数据为空，请检查变量是否为数值类型")

    y = sub[dep_var]
    X = sm.add_constant(sub[all_x_vars_final], has_constant="add")

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

    dummy_vars_flat = [col for cols in dummy_info.values() for col in cols]
    cat_note = (
        f"；{list(dummy_info.keys())} 已自动展开为虚拟变量（drop_first=True，对齐 Stata xi:）"
        if dummy_info else ""
    )

    return {
        "type":            "ols",
        "dep_var":         dep_var,
        "indep_vars":      indep_vars,
        "control_vars":    control_vars,
        "n":               int(res.nobs),
        "r2":              round(float(res.rsquared), 6),
        "r2_adj":          round(float(res.rsquared_adj), 6),
        "f_stat":          round(float(res.fvalue), 4) if res.fvalue else None,
        "f_pvalue":        round(float(res.f_pvalue), 6) if res.f_pvalue else None,
        "df_model":        int(res.df_model),
        "df_resid":        int(res.df_resid),
        "se_type":         se_type,
        "coefficients":    coefs,
        "categorical_vars": list(dummy_info.keys()),
        "dummy_vars":      dummy_vars_flat,
        "time_effects":    False,
        "notes":           f"括号内为t值，{se_type}标准误，***p<0.01, **p<0.05, *p<0.1{cat_note}",
    }


def run_moderation(
    df: pd.DataFrame,
    dep_var: str,
    indep_var: str,
    moderator_var: str,
    control_vars: List[str] = [],
    robust_se: bool = False,
    cluster_var: Optional[str] = None,
) -> Dict:
    """调节效应分析：X、M 中心化后构造交互项 X_c*M_c，复用 run_ols 估计。
    中心化（去均值）是 Aiken & West (1991) 的标准做法，可降低交互项与主效应的多重共线性。
    """
    sub = df.copy()
    x = pd.to_numeric(sub[indep_var], errors="coerce")
    m = pd.to_numeric(sub[moderator_var], errors="coerce")
    x_c_name, m_c_name = f"{indep_var}_c", f"{moderator_var}_c"
    inter_name = f"{indep_var}_x_{moderator_var}"

    sub[x_c_name] = x - x.mean()
    sub[m_c_name] = m - m.mean()
    sub[inter_name] = sub[x_c_name] * sub[m_c_name]

    result = run_ols(
        sub,
        dep_var=dep_var,
        indep_vars=[x_c_name, m_c_name, inter_name],
        control_vars=control_vars,
        robust_se=robust_se,
        cluster_var=cluster_var,
    )
    result["type"] = "moderation"
    result["indep_var"] = indep_var
    result["moderator_var"] = moderator_var
    result["interaction_var"] = inter_name
    result["notes"] += "；解释变量与调节变量已中心化（去均值）后构造交互项，对齐 Aiken & West (1991) 标准做法"
    return result


def run_did(
    df: pd.DataFrame,
    dep_var: str,
    entity_var: str,
    time_var: str,
    treatment_var: str,
    policy_time: float,
    control_vars: List[str] = [],
    robust_se: bool = False,
    cluster_var: Optional[str] = None,
) -> Dict:
    """双重差分（DID），基于个体+时间双向固定效应估计交互项 _did = treatment * post。
    个体FE吸收处理组的时不变特征，时间FE吸收政策前后的共同冲击，仅 _did 系数衡量政策净效应，
    对应 Stata: xtreg y did controls i.year, fe
    """
    sub = df.copy()
    time_numeric = pd.to_numeric(sub[time_var], errors="coerce")
    treat = pd.to_numeric(sub[treatment_var], errors="coerce")
    sub["_post"] = (time_numeric >= policy_time).astype(float)
    sub["_did"] = treat * sub["_post"]

    result = run_panel(
        sub,
        dep_var=dep_var,
        indep_vars=["_did"],
        control_vars=control_vars,
        entity_var=entity_var,
        time_var=time_var,
        model_type="fe",
        robust_se=robust_se,
        cluster_var=cluster_var,
        time_effects=True,
    )
    result["type"] = "did"
    result["did_var"] = "_did"
    result["treatment_var"] = treatment_var
    result["policy_time"] = policy_time

    # 平行趋势检验：仅用政策前样本，检验处理组与对照组在政策前是否存在显著的趋势差异
    parallel_trends = None
    pre = sub[time_numeric < policy_time].copy()
    try:
        if pre[entity_var].nunique() >= 2 and pre[time_var].nunique() >= 2:
            pre["_trend"] = pd.to_numeric(pre[time_var], errors="coerce")
            pre["_treat_trend"] = pd.to_numeric(pre[treatment_var], errors="coerce") * pre["_trend"]
            pt = run_ols(pre, dep_var, indep_vars=[treatment_var, "_trend", "_treat_trend"])
            inter = next(c for c in pt["coefficients"] if c["variable"] == "_treat_trend")
            passed = inter["p_value"] >= 0.1
            parallel_trends = {
                "interaction_coef": inter["coef"],
                "p_value":          inter["p_value"],
                "pass":             passed,
                "conclusion": (
                    "未发现显著的处理组前趋势差异，平行趋势假设成立"
                    if passed else
                    "处理组与对照组在政策前存在显著趋势差异，平行趋势假设可能不成立，DID 结果需谨慎解释"
                ),
            }
    except Exception:
        parallel_trends = None

    result["parallel_trends"] = parallel_trends
    result["notes"] += "；DID 通过个体+时间双向固定效应吸收处理组、时期主效应，仅估计交互项 _did（政策净效应）"
    return result


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
    time_effects: bool = False,
) -> Dict:
    from linearmodels.panel import PanelOLS, RandomEffects
    from numpy.linalg import matrix_rank

    # entity_var / time_var 已作为面板索引，不能同时作为回归变量（会产生重复列）
    all_x_vars = [v for v in (indep_vars + control_vars) if v not in (entity_var, time_var)]
    if not all_x_vars:
        raise ValueError(
            "去除个体/时间索引变量后解释变量为空。"
            f"请勿将个体变量（{entity_var}）或时间变量（{time_var}）选为解释变量。"
        )

    # 去重，避免重复列名导致 sub[col] 返回 DataFrame 而非 Series
    cols_needed = list(dict.fromkeys([dep_var, entity_var, time_var] + all_x_vars))
    if cluster_var and cluster_var not in cols_needed:
        cols_needed.append(cluster_var)

    sub = df[cols_needed].copy()

    # Convert numeric cols; skip object-dtype cols (dummified later)
    for col in [dep_var] + all_x_vars:
        if not pd.api.types.is_object_dtype(sub[col]):
            sub[col] = pd.to_numeric(sub[col], errors="coerce")
    sub[entity_var] = sub[entity_var].astype(str).str.strip()

    # 时间变量：先尝试直接数值化；若全部失败（如"2020-12-31"日期字符串），则解析为日期后提取年份
    time_raw = sub[time_var].copy()
    sub[time_var] = pd.to_numeric(time_raw, errors="coerce")
    if sub[time_var].isna().all():
        try:
            parsed = pd.to_datetime(time_raw, errors="coerce")
            if parsed.notna().any():
                sub[time_var] = parsed.dt.year
        except Exception:
            pass

    # 转换后诊断各列 NaN，便于定位问题
    check_cols = [dep_var] + all_x_vars + [time_var]
    total_rows = len(sub)
    nan_counts = {col: int(sub[col].isna().sum()) for col in check_cols if sub[col].isna().any()}

    sub = sub.dropna(subset=check_cols)

    if len(sub) == 0:
        if nan_counts:
            detail = "；".join(
                f"{col} 有 {n}/{total_rows} 行无法转为数值" for col, n in nan_counts.items()
            )
            raise ValueError(
                f"有效数据为空（共 {total_rows} 行，dropna 后剩 0 行）。"
                f"问题变量：{detail}。"
                "常见原因：该列包含中文字符/单位/百分号/逗号，或在数据清洗时未用均值/中位数填充缺失值。"
            )
        raise ValueError(f"有效数据为空（共 {total_rows} 行），请检查变量选择和缺失值情况")

    # Expand categorical x vars to dummies (after dropna, no NaN in cat cols)
    sub, all_x_vars_final, dummy_info = _expand_categoricals(sub, all_x_vars)

    # 检查面板结构
    n_entities = sub[entity_var].nunique()
    n_times = sub[time_var].nunique()
    if n_entities < 2:
        raise ValueError(f"个体变量 '{entity_var}' 只有 {n_entities} 个唯一值，无法做面板回归（至少需要2个个体）")
    if n_times < 2:
        raise ValueError(f"时间变量 '{time_var}' 只有 {n_times} 个唯一值，无法做面板回归（至少需要2个时间点）")

    sub = sub.set_index([entity_var, time_var])
    y = sub[dep_var]
    X_raw = sub[all_x_vars_final]

    # ── 共线性检测 ──
    dropped = []
    try:
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
            if len(keep) == 0:
                raise ValueError(
                    f"所有解释变量（{all_x_vars}）完全共线，无法估计。"
                    "请检查是否有常数列或变量之间完全线性相关。"
                )
            X_raw = X_raw[keep]
    except ValueError:
        raise
    except Exception as e:
        raise ValueError(f"共线性检测失败：{str(e)}")

    # FE 不加常数项；RE 需要常数项
    X_fe = X_raw
    X_re = sm.add_constant(X_raw, has_constant="add")

    if cluster_var:
        cov_type = "clustered"
        if cluster_var == entity_var:
            cov_kwds = {"cluster_entity": True}
        elif cluster_var == time_var:
            cov_kwds = {"cluster_time": True}
        else:
            raise ValueError(
                f"面板模型仅支持按个体变量（'{entity_var}'）或时间变量（'{time_var}'）聚类，"
                f"暂不支持按任意变量 '{cluster_var}' 聚类。"
            )
    elif robust_se:
        cov_type = "robust"
        cov_kwds = {}
    else:
        cov_type = "unadjusted"
        cov_kwds = {}

    # time_effects 仅对 FE 生效（对应 Stata xtreg, fe absorb(year) / i.year）
    effective_time_effects = time_effects if model_type == "fe" else False

    if model_type == "fe":
        model = PanelOLS(y, X_fe, entity_effects=True, time_effects=effective_time_effects, drop_absorbed=True)
        te_suffix = " i.year" if effective_time_effects else ""
        stata_cmd = f"xtreg {dep_var} {' '.join(X_raw.columns.tolist())}{te_suffix}, fe"
    else:
        model = RandomEffects(y, X_re)
        stata_cmd = f"xtreg {dep_var} {' '.join(X_raw.columns.tolist())}, re"

    res = model.fit(cov_type=cov_type, **cov_kwds)

    # Hausman 检验（内部强制用 unadjusted，与用户 SE 类型解耦）
    hausman = None
    if model_type == "fe":
        try:
            fe_h = PanelOLS(y, X_fe, entity_effects=True, time_effects=effective_time_effects, drop_absorbed=True).fit(cov_type="unadjusted")
            re_h = RandomEffects(y, X_re).fit(cov_type="unadjusted")
            b_fe = fe_h.params
            b_re = re_h.params
            common = b_fe.index.intersection(b_re.index)
            diff = b_fe[common] - b_re[common]
            var_fe = pd.DataFrame(fe_h.cov, index=fe_h.params.index, columns=fe_h.params.index)
            var_re = pd.DataFrame(re_h.cov, index=re_h.params.index, columns=re_h.params.index)
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
            "variable":  name if name != "const" else "_cons",
            "coef":      round(float(res.params[name]), 6),
            "std_error": round(float(res.std_errors[name]), 6),
            "t_stat":    round(float(res.tstats[name]), 4),
            "p_value":   round(p, 6),
            "sig":       sig_stars(p),
        })

    dummy_vars_flat = [c for cols in dummy_info.values() for c in cols if c not in dropped]

    omit_note = f"注：{dropped} 因完全共线性被自动省略（omitted），与 Stata 处理一致。" if dropped else ""
    cat_note = (
        f"；{list(dummy_info.keys())} 已自动展开为虚拟变量（drop_first=True，对齐 Stata xi:）"
        if dummy_info else ""
    )

    return {
        "type":             model_type,
        "dep_var":          dep_var,
        "indep_vars":       indep_vars,
        "control_vars":     control_vars,
        "entity_var":       entity_var,
        "time_var":         time_var,
        "time_effects":     effective_time_effects,
        "n":                int(res.nobs),
        "n_entities":       n_entities,
        "r2_within":        round(float(res.rsquared_within), 6) if hasattr(res, "rsquared_within") else None,
        "r2_between":       round(float(res.rsquared_between), 6) if hasattr(res, "rsquared_between") else None,
        "r2_overall":       round(float(res.rsquared_overall), 6) if hasattr(res, "rsquared_overall") else None,
        "f_stat":           round(float(res.f_statistic.stat), 4) if hasattr(res, "f_statistic") else None,
        "f_pvalue":         round(float(res.f_statistic.pval), 6) if hasattr(res, "f_statistic") else None,
        "se_type":          cov_type,
        "coefficients":     coefs,
        "hausman":          hausman,
        "stata_equivalent": stata_cmd,
        "dropped_vars":     dropped,
        "categorical_vars": list(dummy_info.keys()),
        "dummy_vars":       dummy_vars_flat,
        "notes":            f"括号内为t值，{cov_type}标准误，***p<0.01, **p<0.05, *p<0.1。{omit_note}{cat_note}",
    }
