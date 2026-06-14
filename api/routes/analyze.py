from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import math, logging
import concurrent.futures
import numpy as np
import pandas as pd

logger = logging.getLogger("empirical")
from services.stats import (
    run_descriptive,
    run_correlation,
    run_ols,
    run_panel,
    run_panel_balance,
    run_moderation,
    run_mediation,
    run_did,
    run_did_robustness,
    run_did_event_study,
    run_heterogeneity,
    run_iv,
    run_pca,
    run_probit,
    run_logit,
    run_psm,
    run_psm_did,
)
from services.interpreter import interpret_results
from services.session_store import load_cleaned, save_cleaned
from routes.activation import is_valid_code

router = APIRouter()

# 需激活码解锁的高级分析类型（2026-06-13 方案：单一共享码统一解锁，详见 docs/STATUS.md）
# 范围：本次新增的高级功能（PSM/DID稳健性检验/Probit/Logit）；已上线的免费功能不纳入锁定
RESTRICTED_ANALYSIS_TYPES: set = {"psm", "did_robustness", "probit", "logit", "psm_did"}

# 单次分析请求超时熔断：避免某个分析组合在大数据上长时间占满 CPU 拖垮整机
# （2026-06-12 曾出现 panel_fe/pca/did/moderation/heterogeneity 组合卡死近9小时）
ANALYSIS_TIMEOUT_SECONDS = 90
_analysis_executor = concurrent.futures.ThreadPoolExecutor(max_workers=2)


def _sanitize(obj):
    """Recursively replace inf/nan with None so FastAPI can serialize to JSON."""
    if isinstance(obj, (float, np.floating)):
        val = float(obj)
        return None if (math.isnan(val) or math.isinf(val)) else val
    if isinstance(obj, np.ndarray):
        return _sanitize(obj.tolist())
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, (list, tuple)):
        return [_sanitize(v) for v in obj]
    return obj


class AnalysisRequest(BaseModel):
    cleaned_session_id: Optional[str] = None
    data: Optional[List[Dict[str, Any]]] = None
    analysis_types: List[str]
    variables: Optional[List[str]] = None
    dep_var: Optional[str] = None
    indep_vars: Optional[List[str]] = None
    control_vars: Optional[List[str]] = None
    robust_se: Optional[bool] = False
    cluster_var: Optional[str] = None
    entity_var: Optional[str] = None
    time_var: Optional[str] = None
    time_effects: Optional[bool] = False
    moderator_var: Optional[str] = None
    treatment_var: Optional[str] = None
    policy_time: Optional[float] = None
    mediator_var: Optional[str] = None
    group_var: Optional[str] = None
    group_method: Optional[str] = "median"
    endog_vars: Optional[List[str]] = None
    instrument_vars: Optional[List[str]] = None
    n_components: Optional[int] = None
    standardize: Optional[bool] = True
    treat_time_var: Optional[str] = None
    window_pre: Optional[int] = 3
    window_post: Optional[int] = 3
    interpret: Optional[bool] = False
    custom_question: Optional[str] = None
    activation_code: Optional[str] = None
    psm_neighbors: Optional[int] = 1
    psm_caliper: Optional[float] = None


def _gen_analyze_do(req: AnalysisRequest) -> str:
    lines = ["", "* ── 实证分析（自动生成）──"]

    if "descriptive" in req.analysis_types:
        vars_str = " ".join(req.variables) if req.variables else "_all"
        lines.append(f"summarize {vars_str}, detail")

    if "correlation" in req.analysis_types:
        vars_str = " ".join(req.variables) if req.variables else "_all"
        lines.append(f"pwcorr {vars_str}, sig star(0.1)")

    if "ols" in req.analysis_types and req.dep_var:
        all_x = (req.indep_vars or []) + (req.control_vars or [])
        if req.cluster_var:
            se_opt = f", cluster({req.cluster_var})"
        elif req.robust_se:
            se_opt = ", robust"
        else:
            se_opt = ""
        lines.append(f"reg {req.dep_var} {' '.join(all_x)}{se_opt}")

    for _bin_type in ("probit", "logit"):
        if _bin_type in req.analysis_types and req.dep_var:
            all_x = (req.indep_vars or []) + (req.control_vars or [])
            if req.cluster_var:
                se_opt = f", vce(cluster {req.cluster_var})"
            elif req.robust_se:
                se_opt = ", vce(robust)"
            else:
                se_opt = ""
            lines.append(f"{_bin_type} {req.dep_var} {' '.join(all_x)}{se_opt}")
            lines.append("margins, dydx(*)  // 平均边际效应（AME）")

    if "psm" in req.analysis_types and req.dep_var and req.treatment_var:
        covariates = (req.indep_vars or []) + (req.control_vars or [])
        k = req.psm_neighbors or 1
        caliper_opt = f" caliper({req.psm_caliper})" if req.psm_caliper is not None else ""
        lines.append("* 倾向得分匹配 PSM（需 ssc install psmatch2）")
        lines.append(f"psmatch2 {req.treatment_var} {' '.join(covariates)}, outcome({req.dep_var}) neighbor({k}){caliper_opt} logit")
        lines.append("pstest " + " ".join(covariates) + "  // 平衡性检验（标准化均值差）")

    if "psm_did" in req.analysis_types and req.dep_var and req.entity_var and req.time_var and req.treatment_var:
        covariates = (req.indep_vars or []) + (req.control_vars or [])
        k = req.psm_neighbors or 1
        caliper_opt = f" caliper({req.psm_caliper})" if req.psm_caliper is not None else ""
        se_opt = f", cluster({req.cluster_var})" if req.cluster_var else (", robust" if req.robust_se else "")
        lines.append("* PSM-DID 基期锁定匹配（需 ssc install psmatch2；以下为基期截面示例，多block需逐个重复）")
        if req.treat_time_var:
            lines.append(f"gen _baseline_year = {req.treat_time_var} - 1  // 交错处理：各处理组个体按各自基期分别匹配")
        else:
            pt = req.policy_time if req.policy_time is not None else "{政策年份}"
            lines.append(f"local baseline_year = {pt} - 1")
            lines.append("gen _baseline_year = `baseline_year'")
        lines.append("* 在 _baseline_year 截面上对处理组与从未受处理个体做PSM匹配：")
        lines.append(f"psmatch2 {req.treatment_var} {' '.join(covariates)} if year == _baseline_year, outcome({req.dep_var}) neighbor({k}){caliper_opt} logit")
        lines.append("pstest " + " ".join(covariates) + "  // 平衡性检验（标准化均值差）")
        lines.append("* 保留匹配成功的处理组个体及其匹配对照个体，还原为面板后做双向固定效应DID：")
        lines.append("gen _post = (year >= _treat_time)")
        lines.append(f"gen _did = {req.treatment_var} * _post")
        lines.append(f"xtset {req.entity_var} {req.time_var}")
        lines.append(f"xtreg {req.dep_var} _did {' '.join(req.control_vars or [])} i.{req.time_var}, fe{se_opt}")

    if "panel_fe" in req.analysis_types and req.dep_var:
        all_x = (req.indep_vars or []) + (req.control_vars or [])
        lines.append(f"xtset {req.entity_var} {req.time_var}")
        if req.cluster_var:
            se_opt = f", cluster({req.cluster_var})"
        elif req.robust_se:
            se_opt = ", robust"
        else:
            se_opt = ""
        lines.append(f"xtreg {req.dep_var} {' '.join(all_x)}, fe{se_opt}")

    if "panel_balance" in req.analysis_types and req.entity_var and req.time_var:
        lines.append(f"xtset {req.entity_var} {req.time_var}")
        lines.append("xtdescribe")

    if "moderation" in req.analysis_types and req.dep_var and req.indep_vars and req.moderator_var:
        x, m = req.indep_vars[0], req.moderator_var
        lines.append(f"summarize {x}")
        lines.append(f"gen {x}_c = {x} - r(mean)")
        lines.append(f"summarize {m}")
        lines.append(f"gen {m}_c = {m} - r(mean)")
        lines.append(f"gen {x}_x_{m} = {x}_c * {m}_c")
        all_x = [f"{x}_c", f"{m}_c", f"{x}_x_{m}"] + (req.control_vars or [])
        se_opt = f", cluster({req.cluster_var})" if req.cluster_var else (", robust" if req.robust_se else "")
        lines.append(f"reg {req.dep_var} {' '.join(all_x)}{se_opt}")

    if "did_event" in req.analysis_types and req.dep_var and req.entity_var and req.time_var and req.treatment_var:
        wp = req.window_pre if req.window_pre is not None else 3
        wpo = req.window_post if req.window_post is not None else 3
        se_opt = f", cluster({req.cluster_var})" if req.cluster_var else (", robust" if req.robust_se else "")
        if req.treat_time_var:
            lines.append(f"* 多时点DID事件研究（交错处理，处理时间列：{req.treat_time_var}）：")
            lines.append(f"gen _rel_time = {req.time_var} - {req.treat_time_var}")
        else:
            pt = req.policy_time if req.policy_time is not None else "{政策年份}"
            lines.append(f"* 多时点DID事件研究（同质处理，政策时点：{pt}）：")
            lines.append(f"gen _treat_time = {req.treatment_var} * {pt}")
            lines.append(f"gen _rel_time = {req.time_var} - _treat_time if {req.treatment_var} == 1")
        lines.append(f"* 构造事件窗口虚拟变量（基期 t=-1 省略）：")
        lines.append(f"forvalues p = -{wp}/-2 {{")
        lines.append(f"    gen _evt_m`=abs(`p')' = (_rel_time == `p')")
        lines.append(f"}}")
        lines.append(f"gen _evt_0 = (_rel_time == 0)")
        lines.append(f"forvalues p = 1/{wpo} {{")
        lines.append(f"    gen _evt_p`p' = (_rel_time == `p')")
        lines.append(f"}}")
        all_evts = [f"_evt_m{p}" for p in range(wp, 1, -1)] + ["_evt_0"] + [f"_evt_p{p}" for p in range(1, wpo + 1)]
        all_x = all_evts + (req.control_vars or [])
        lines.append(f"xtset {req.entity_var} {req.time_var}")
        lines.append(f"xtreg {req.dep_var} {' '.join(all_x)} i.{req.time_var}, fe{se_opt}")

    if "did" in req.analysis_types and req.dep_var and req.entity_var and req.time_var and req.treatment_var:
        pt = req.policy_time if req.policy_time is not None else "{政策年份}"
        all_x = ["did"] + (req.control_vars or [])
        se_opt = f", cluster({req.cluster_var})" if req.cluster_var else (", robust" if req.robust_se else "")
        lines.append(f"gen post = ({req.time_var} >= {pt})")
        lines.append(f"gen did = {req.treatment_var} * post")
        lines.append(f"xtset {req.entity_var} {req.time_var}")
        lines.append(f"xtreg {req.dep_var} {' '.join(all_x)} i.{req.time_var}, fe{se_opt}")
        lines.append("* 平行趋势检验（仅用政策前样本）：")
        lines.append(f"reg {req.dep_var} {req.treatment_var} c.{req.time_var}##c.{req.treatment_var} if {req.time_var} < {pt}")

    if "did_robustness" in req.analysis_types and req.dep_var and req.entity_var and req.time_var and req.treatment_var:
        pt = req.policy_time if req.policy_time is not None else "{政策年份}"
        all_x = ["did"] + (req.control_vars or [])
        se_opt = f", cluster({req.cluster_var})" if req.cluster_var else (", robust" if req.robust_se else "")
        lines.append("* DID稳健性检验：安慰剂检验（随机分配处理组，重复N次后比较真实系数与随机分布）：")
        lines.append(f"* 以下为单次示例，可循环执行并保存 _b[placebo_did] 后绘制分布图")
        lines.append(f"gen post = ({req.time_var} >= {pt})")
        lines.append(f"bysort {req.entity_var}: gen _placebo_treat = ({req.entity_var} <= ({req.entity_var}的随机子集))  // 示例，需自定义随机分组逻辑")
        lines.append(f"gen placebo_did = _placebo_treat * post")
        lines.append(f"xtset {req.entity_var} {req.time_var}")
        lines.append(f"xtreg {req.dep_var} placebo_did {' '.join(req.control_vars or [])} i.{req.time_var}, fe{se_opt}")
        lines.append("* 剔除政策当期重新估计：")
        lines.append(f"xtreg {req.dep_var} {' '.join(all_x)} i.{req.time_var} if {req.time_var} != {pt}, fe{se_opt}")

    if "mediation" in req.analysis_types and req.dep_var and req.indep_vars and req.mediator_var:
        x, m = req.indep_vars[0], req.mediator_var
        all_x = [x] + (req.control_vars or [])
        all_xm = [x, m] + (req.control_vars or [])
        se_opt = f", cluster({req.cluster_var})" if req.cluster_var else (", robust" if req.robust_se else "")
        lines.append("* 中介效应分析（Baron & Kenny 1986 三步法）：")
        lines.append(f"reg {req.dep_var} {' '.join(all_x)}{se_opt}  // step1: 总效应 c")
        lines.append(f"reg {m} {' '.join(all_x)}{se_opt}  // step2: 路径 a")
        lines.append(f"reg {req.dep_var} {' '.join(all_xm)}{se_opt}  // step3: 路径 b 与直接效应 c'")

    if "heterogeneity" in req.analysis_types and req.dep_var and req.indep_vars and req.group_var:
        all_x = (req.indep_vars or []) + (req.control_vars or [])
        se_opt = f", cluster({req.cluster_var})" if req.cluster_var else (", robust" if req.robust_se else "")
        method = req.group_method or "median"
        lines.append("* 异质性分析（按分组变量拆分样本分别估计）：")
        if method == "category":
            lines.append(f"levelsof {req.group_var}, local(grps)")
            lines.append(f"foreach g of local grps {{")
            lines.append(f"    reg {req.dep_var} {' '.join(all_x)} if {req.group_var} == `g'{se_opt}")
            lines.append(f"}}")
        elif method == "quantile":
            lines.append(f"xtile _grp = {req.group_var}, nq(3)")
            lines.append(f"forvalues g = 1/3 {{")
            lines.append(f"    reg {req.dep_var} {' '.join(all_x)} if _grp == `g'{se_opt}")
            lines.append(f"}}")
        else:
            lines.append(f"summarize {req.group_var}, detail")
            lines.append(f"gen _grp_high = ({req.group_var} > r(p50))")
            lines.append(f"reg {req.dep_var} {' '.join(all_x)} if _grp_high == 0{se_opt}  // 低于中位数组")
            lines.append(f"reg {req.dep_var} {' '.join(all_x)} if _grp_high == 1{se_opt}  // 高于中位数组")

    if "iv" in req.analysis_types and req.dep_var and req.endog_vars and req.instrument_vars:
        se_opt = f", vce(cluster {req.cluster_var})" if req.cluster_var else (", vce(robust)" if req.robust_se else "")
        lines.append(
            f"ivregress 2sls {req.dep_var} {' '.join(req.control_vars or [])} "
            f"({' '.join(req.endog_vars)} = {' '.join(req.instrument_vars)}){se_opt}"
        )
        lines.append("estat firststage  // 第一阶段 F 统计量，弱工具变量检验")
        if len(req.instrument_vars) > len(req.endog_vars):
            lines.append("estat overid  // 过度识别检验（Sargan/Hansen J）")

    if "pca" in req.analysis_types and req.variables:
        cov_opt = "" if (req.standardize is None or req.standardize) else ", covariance"
        lines.append(f"factortest {' '.join(req.variables)}  // KMO 与 Bartlett 球形检验（需 ssc install factortest），用于判断变量是否适合做主成分分析")
        lines.append(f"pca {' '.join(req.variables)}{cov_opt}")
        lines.append("predict pc1 pc2 pc3 pc4 pc5 pc6  // 按需保留的主成分个数调整变量名数量")
        lines.append("* 综合得分 = 各保留主成分按方差贡献率加权汇总，例如保留2个主成分：")
        lines.append("* gen comp_score = (w1/(w1+w2))*pc1 + (w2/(w1+w2))*pc2")
        lines.append("* 其中 w1、w2 为 pca 输出中各主成分的方差贡献率（Proportion）")

    if "panel_re" in req.analysis_types and req.dep_var:
        all_x = (req.indep_vars or []) + (req.control_vars or [])
        lines.append(f"xtset {req.entity_var} {req.time_var}")
        lines.append(f"xtreg {req.dep_var} {' '.join(all_x)}, re")
        lines.append("* Hausman 检验（FE vs RE）：")
        lines.append(f"quietly xtreg {req.dep_var} {' '.join(all_x)}, fe")
        lines.append("estimates store fe")
        lines.append(f"quietly xtreg {req.dep_var} {' '.join(all_x)}, re")
        lines.append("estimates store re")
        lines.append("hausman fe re")

    return "\n".join(lines)


@router.post("/run")
def run_analysis(req: AnalysisRequest):
    restricted_requested = [t for t in req.analysis_types if t in RESTRICTED_ANALYSIS_TYPES]
    if restricted_requested and not is_valid_code(req.activation_code):
        raise HTTPException(
            status_code=403,
            detail=f"以下分析为高级功能，需输入激活码解锁：{restricted_requested}",
        )

    if req.cleaned_session_id:
        try:
            df = load_cleaned(req.cleaned_session_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    elif req.data:
        df = pd.DataFrame(req.data)
    else:
        raise HTTPException(status_code=400, detail="数据不能为空，请提供 cleaned_session_id 或 data")

    df_full = df  # 保留完整清洗数据的引用，供 PCA 综合得分写回新变量时使用

    if req.variables:
        missing_cols = [v for v in req.variables if v not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"变量不存在：{missing_cols}")
        # Bug3 Fix: 面板分析必须保留 entity_var / time_var，即使用户没有在 variables 里选它们
        keep = list(req.variables)
        if any(t in req.analysis_types for t in ("panel_fe", "panel_re", "panel_balance", "did", "did_robustness", "did_event", "heterogeneity", "psm_did")):
            if req.entity_var and req.entity_var not in keep:
                keep.append(req.entity_var)
            if req.time_var and req.time_var not in keep:
                keep.append(req.time_var)
        if any(t in req.analysis_types for t in ("did", "did_robustness", "psm")) and req.treatment_var and req.treatment_var not in keep:
            keep.append(req.treatment_var)
        if any(t in req.analysis_types for t in ("did_event", "psm_did")):
            if req.treatment_var and req.treatment_var not in keep:
                keep.append(req.treatment_var)
            if req.treat_time_var and req.treat_time_var not in keep:
                keep.append(req.treat_time_var)
        if "moderation" in req.analysis_types and req.moderator_var and req.moderator_var not in keep:
            keep.append(req.moderator_var)
        if "mediation" in req.analysis_types and req.mediator_var and req.mediator_var not in keep:
            keep.append(req.mediator_var)
        if "heterogeneity" in req.analysis_types and req.group_var and req.group_var not in keep:
            keep.append(req.group_var)
        if "iv" in req.analysis_types:
            for v in (req.endog_vars or []) + (req.instrument_vars or []):
                if v not in keep:
                    keep.append(v)
        df = df[keep]

    numeric_cols = df.select_dtypes(include="number").columns.tolist()

    try:
        results, errors = _analysis_executor.submit(
            _run_all_analyses, req, df, df_full, numeric_cols
        ).result(timeout=ANALYSIS_TIMEOUT_SECONDS)
    except concurrent.futures.TimeoutError:
        logger.error(
            "[analyze] timeout types=%s dep=%s after %ss",
            ",".join(req.analysis_types),
            req.dep_var or "-",
            ANALYSIS_TIMEOUT_SECONDS,
        )
        raise HTTPException(
            status_code=504,
            detail=f"分析超时（超过 {ANALYSIS_TIMEOUT_SECONDS} 秒未完成），请尝试减少同时勾选的分析类型或缩减数据量后重试",
        )

    interpretation = None
    if req.interpret and results:
        try:
            interpretation = interpret_results(results, req.custom_question)
        except Exception as e:
            interpretation = {"text": f"AI解读失败：{str(e)}"}

    do_analyze = _gen_analyze_do(req)

    logger.info(
        "[analyze] types=%s dep=%s errors=%s ai=%s",
        ",".join(req.analysis_types),
        req.dep_var or "-",
        ",".join(errors.keys()) if errors else "none",
        req.interpret,
    )

    return _sanitize({
        "success": True,
        "results": results,
        "errors": errors if errors else None,
        "interpretation": interpretation,
        "do_analyze": do_analyze,
    })


def _run_all_analyses(req: "AnalysisRequest", df: pd.DataFrame, df_full: pd.DataFrame, numeric_cols: List[str]):
    results = {}
    errors = {}

    for analysis_type in req.analysis_types:
        try:
            if analysis_type == "descriptive":
                results["descriptive"] = run_descriptive(df, numeric_cols)

            elif analysis_type == "correlation":
                results["correlation"] = run_correlation(df, numeric_cols)

            elif analysis_type == "ols":
                if not req.dep_var:
                    raise ValueError("OLS 需要指定被解释变量 dep_var")
                all_x = (req.indep_vars or []) + (req.control_vars or [])
                if not all_x:
                    raise ValueError("OLS 需要指定解释变量 indep_vars")
                results["ols"] = run_ols(
                    df,
                    dep_var=req.dep_var,
                    indep_vars=req.indep_vars or [],
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "panel_balance":
                if not req.entity_var or not req.time_var:
                    raise ValueError("面板平衡性检查需要指定 entity_var / time_var")
                results["panel_balance"] = run_panel_balance(df, req.entity_var, req.time_var)

            elif analysis_type == "moderation":
                if not req.dep_var:
                    raise ValueError("调节效应分析需要指定被解释变量 dep_var")
                if not req.indep_vars:
                    raise ValueError("调节效应分析需要指定解释变量 X（取第一个）")
                if not req.moderator_var:
                    raise ValueError("调节效应分析需要指定调节变量 moderator_var")
                results["moderation"] = run_moderation(
                    df,
                    dep_var=req.dep_var,
                    indep_var=req.indep_vars[0],
                    moderator_var=req.moderator_var,
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "mediation":
                if not req.dep_var:
                    raise ValueError("中介效应分析需要指定被解释变量 dep_var")
                if not req.indep_vars:
                    raise ValueError("中介效应分析需要指定解释变量 X（取第一个）")
                if not req.mediator_var:
                    raise ValueError("中介效应分析需要指定中介变量 mediator_var")
                results["mediation"] = run_mediation(
                    df,
                    dep_var=req.dep_var,
                    indep_var=req.indep_vars[0],
                    mediator_var=req.mediator_var,
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "heterogeneity":
                if not req.dep_var:
                    raise ValueError("异质性分析需要指定被解释变量 dep_var")
                if not req.indep_vars:
                    raise ValueError("异质性分析需要指定核心解释变量 indep_vars")
                if not req.group_var:
                    raise ValueError("异质性分析需要指定分组变量 group_var")
                results["heterogeneity"] = run_heterogeneity(
                    df,
                    dep_var=req.dep_var,
                    indep_vars=req.indep_vars or [],
                    control_vars=req.control_vars or [],
                    group_var=req.group_var,
                    group_method=req.group_method or "median",
                    entity_var=req.entity_var if req.entity_var else None,
                    time_var=req.time_var if req.time_var else None,
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "did":
                if not req.dep_var or not req.entity_var or not req.time_var:
                    raise ValueError("DID 需要指定 dep_var / entity_var / time_var")
                if not req.treatment_var:
                    raise ValueError("DID 需要指定处理组变量 treatment_var")
                if req.policy_time is None:
                    raise ValueError("DID 需要指定政策时点 policy_time")
                results["did"] = run_did(
                    df,
                    dep_var=req.dep_var,
                    entity_var=req.entity_var,
                    time_var=req.time_var,
                    treatment_var=req.treatment_var,
                    policy_time=req.policy_time,
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "psm":
                if not req.dep_var:
                    raise ValueError("PSM 需要指定被解释变量 dep_var")
                if not req.treatment_var:
                    raise ValueError("PSM 需要指定处理组变量 treatment_var")
                covariates = (req.indep_vars or []) + (req.control_vars or [])
                if not covariates:
                    raise ValueError("PSM 需要指定用于估计倾向得分的协变量（解释变量/控制变量）")
                results["psm"] = run_psm(
                    df,
                    dep_var=req.dep_var,
                    treatment_var=req.treatment_var,
                    covariates=covariates,
                    n_neighbors=req.psm_neighbors or 1,
                    caliper=req.psm_caliper,
                )

            elif analysis_type == "psm_did":
                if not req.dep_var or not req.entity_var or not req.time_var:
                    raise ValueError("PSM-DID 需要指定 dep_var / entity_var / time_var")
                if not req.treatment_var:
                    raise ValueError("PSM-DID 需要指定处理组变量 treatment_var")
                if req.treat_time_var is None and req.policy_time is None:
                    raise ValueError("PSM-DID 需要指定政策时点（同质处理填 policy_time，交错处理填 treat_time_var）")
                covariates = (req.indep_vars or []) + (req.control_vars or [])
                if not covariates:
                    raise ValueError("PSM-DID 需要指定用于估计倾向得分的协变量（解释变量/控制变量）")
                results["psm_did"] = run_psm_did(
                    df,
                    entity_var=req.entity_var,
                    time_var=req.time_var,
                    dep_var=req.dep_var,
                    treatment_var=req.treatment_var,
                    covariates=covariates,
                    treat_time_var=req.treat_time_var,
                    policy_time=req.policy_time,
                    n_neighbors=req.psm_neighbors or 1,
                    caliper=req.psm_caliper,
                    window_pre=req.window_pre if req.window_pre is not None else 3,
                    window_post=req.window_post if req.window_post is not None else 5,
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "did_robustness":
                if not req.dep_var or not req.entity_var or not req.time_var:
                    raise ValueError("DID稳健性检验需要指定 dep_var / entity_var / time_var")
                if not req.treatment_var:
                    raise ValueError("DID稳健性检验需要指定处理组变量 treatment_var")
                if req.policy_time is None:
                    raise ValueError("DID稳健性检验需要指定政策时点 policy_time")
                results["did_robustness"] = run_did_robustness(
                    df,
                    dep_var=req.dep_var,
                    entity_var=req.entity_var,
                    time_var=req.time_var,
                    treatment_var=req.treatment_var,
                    policy_time=req.policy_time,
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "did_event":
                if not req.dep_var or not req.entity_var or not req.time_var:
                    raise ValueError("多时点DID需要指定 dep_var / entity_var / time_var")
                if not req.treatment_var:
                    raise ValueError("多时点DID需要指定处理组变量 treatment_var")
                if req.treat_time_var is None and req.policy_time is None:
                    raise ValueError("多时点DID需要指定政策时点（同质处理填 policy_time，交错处理填 treat_time_var）")
                results["did_event"] = run_did_event_study(
                    df,
                    dep_var=req.dep_var,
                    entity_var=req.entity_var,
                    time_var=req.time_var,
                    treatment_var=req.treatment_var,
                    policy_time=req.policy_time,
                    treat_time_var=req.treat_time_var,
                    window_pre=req.window_pre if req.window_pre is not None else 3,
                    window_post=req.window_post if req.window_post is not None else 3,
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "iv":
                if not req.dep_var:
                    raise ValueError("工具变量法需要指定被解释变量 dep_var")
                if not req.endog_vars:
                    raise ValueError("工具变量法需要指定内生解释变量 endog_vars")
                if not req.instrument_vars:
                    raise ValueError("工具变量法需要指定工具变量 instrument_vars")
                if len(req.instrument_vars) < len(req.endog_vars):
                    raise ValueError("工具变量数不能少于内生变量数（识别条件不满足）")
                results["iv"] = run_iv(
                    df,
                    dep_var=req.dep_var,
                    endog_vars=req.endog_vars,
                    instrument_vars=req.instrument_vars,
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type == "pca":
                if not req.variables or len(req.variables) < 2:
                    raise ValueError("主成分分析需要至少选择 2 个变量")
                pca_result = run_pca(
                    df,
                    variables=req.variables,
                    n_components=req.n_components,
                    standardize=req.standardize if req.standardize is not None else True,
                )
                # 将综合得分按行写回完整清洗数据，生成新变量并存为新的 cleaned_session_id，
                # 使其可在后续回归分析中作为变量直接选用（而不仅仅是展示结果）
                cs = pca_result.get("composite_score")
                if cs and cs.get("values") and req.cleaned_session_id:
                    score_col = "pca_score"
                    suffix = 2
                    while score_col in df_full.columns:
                        score_col = f"pca_score_{suffix}"
                        suffix += 1
                    score_map = {item["row"]: item["score"] for item in cs["values"]}
                    df_full = df_full.copy()
                    df_full[score_col] = df_full.index.to_series().map(score_map)
                    new_sid = save_cleaned(df_full)
                    pca_result["score_column"] = score_col
                    pca_result["new_cleaned_session_id"] = new_sid
                results["pca"] = pca_result

            elif analysis_type in ("probit", "logit"):
                if not req.dep_var:
                    raise ValueError(f"{analysis_type.capitalize()} 需要指定被解释变量 dep_var")
                all_x = (req.indep_vars or []) + (req.control_vars or [])
                if not all_x:
                    raise ValueError(f"{analysis_type.capitalize()} 需要指定解释变量 indep_vars")
                run_fn = run_probit if analysis_type == "probit" else run_logit
                results[analysis_type] = run_fn(
                    df,
                    dep_var=req.dep_var,
                    indep_vars=req.indep_vars or [],
                    control_vars=req.control_vars or [],
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                )

            elif analysis_type in ("panel_fe", "panel_re"):
                if not req.dep_var or not req.entity_var or not req.time_var:
                    raise ValueError("面板分析需要指定 dep_var / entity_var / time_var")
                all_x = (req.indep_vars or []) + (req.control_vars or [])
                if not all_x:
                    raise ValueError("面板分析需要指定解释变量")
                results[analysis_type] = run_panel(
                    df,
                    dep_var=req.dep_var,
                    indep_vars=req.indep_vars or [],
                    control_vars=req.control_vars or [],
                    entity_var=req.entity_var,
                    time_var=req.time_var,
                    model_type="fe" if analysis_type == "panel_fe" else "re",
                    robust_se=req.robust_se,
                    cluster_var=req.cluster_var,
                    time_effects=bool(req.time_effects) if analysis_type == "panel_fe" else False,
                )

        except Exception as e:
            errors[analysis_type] = str(e)

    return results, errors