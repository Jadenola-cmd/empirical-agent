from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import pandas as pd
from services.stats import (
    run_descriptive,
    run_correlation,
    run_ols,
    run_panel,
)
from services.interpreter import interpret_results

router = APIRouter()


class AnalysisRequest(BaseModel):
    data: List[Dict[str, Any]]
    analysis_types: List[str]
    variables: Optional[List[str]] = None
    dep_var: Optional[str] = None
    indep_vars: Optional[List[str]] = None
    control_vars: Optional[List[str]] = None
    robust_se: Optional[bool] = False
    cluster_var: Optional[str] = None
    entity_var: Optional[str] = None
    time_var: Optional[str] = None
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
    if not req.data:
        raise HTTPException(status_code=400, detail="数据不能为空")

    df = pd.DataFrame(req.data)

    if req.variables:
        missing_cols = [v for v in req.variables if v not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"变量不存在：{missing_cols}")
        df = df[req.variables]

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

    return {
        "success": True,
        "results": results,
        "errors": errors if errors else None,
        "interpretation": interpretation,
        "do_analyze": do_analyze,
    }