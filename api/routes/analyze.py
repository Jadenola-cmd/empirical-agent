from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import math
import pandas as pd
from services.stats import (
    run_descriptive,
    run_correlation,
    run_ols,
    run_panel,
    run_panel_balance,
    run_moderation,
    run_did,
)
from services.interpreter import interpret_results
from services.session_store import load_cleaned

router = APIRouter()


def _sanitize(obj):
    """Recursively replace inf/nan with None so FastAPI can serialize to JSON."""
    if isinstance(obj, float):
        return None if (math.isnan(obj) or math.isinf(obj)) else obj
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
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
    interpret: Optional[bool] = False
    custom_question: Optional[str] = None


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
async def run_analysis(req: AnalysisRequest):
    if req.cleaned_session_id:
        try:
            df = load_cleaned(req.cleaned_session_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    elif req.data:
        df = pd.DataFrame(req.data)
    else:
        raise HTTPException(status_code=400, detail="数据不能为空，请提供 cleaned_session_id 或 data")

    if req.variables:
        missing_cols = [v for v in req.variables if v not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"变量不存在：{missing_cols}")
        # Bug3 Fix: 面板分析必须保留 entity_var / time_var，即使用户没有在 variables 里选它们
        keep = list(req.variables)
        if any(t in req.analysis_types for t in ("panel_fe", "panel_re", "panel_balance", "did")):
            if req.entity_var and req.entity_var not in keep:
                keep.append(req.entity_var)
            if req.time_var and req.time_var not in keep:
                keep.append(req.time_var)
        if "did" in req.analysis_types and req.treatment_var and req.treatment_var not in keep:
            keep.append(req.treatment_var)
        if "moderation" in req.analysis_types and req.moderator_var and req.moderator_var not in keep:
            keep.append(req.moderator_var)
        df = df[keep]

    numeric_cols = df.select_dtypes(include="number").columns.tolist()

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

    interpretation = None
    if req.interpret and results:
        try:
            interpretation = interpret_results(results, req.custom_question)
        except Exception as e:
            interpretation = {"text": f"AI解读失败：{str(e)}"}

    do_analyze = _gen_analyze_do(req)

    return _sanitize({
        "success": True,
        "results": results,
        "errors": errors if errors else None,
        "interpretation": interpretation,
        "do_analyze": do_analyze,
    })