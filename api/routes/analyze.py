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
    data: List[Dict[str, Any]]          # 清洗后的数据（来自第一层）
    analysis_types: List[str]           # ["descriptive", "correlation", "ols", "panel_fe", "panel_re"]
    variables: Optional[List[str]] = None   # 参与分析的变量（空=全部）

    # 回归相关
    dep_var: Optional[str] = None
    indep_vars: Optional[List[str]] = None
    control_vars: Optional[List[str]] = None
    robust_se: Optional[bool] = False
    cluster_var: Optional[str] = None

    # 面板数据相关
    entity_var: Optional[str] = None   # 个体变量，如 firm_id
    time_var: Optional[str] = None     # 时间变量，如 year

    # AI解读
    interpret: Optional[bool] = False
    custom_question: Optional[str] = None


@router.post("/run")
async def run_analysis(req: AnalysisRequest):
    """
    统一分析入口，支持同时运行多种分析
    """
    if not req.data:
        raise HTTPException(status_code=400, detail="数据不能为空")

    df = pd.DataFrame(req.data)

    # 只保留选择的变量
    if req.variables:
        missing_cols = [v for v in req.variables if v not in df.columns]
        if missing_cols:
            raise HTTPException(status_code=400, detail=f"变量不存在：{missing_cols}")
        df = df[req.variables]

    # 数值列
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

    # AI 解读（可选）
    interpretation = None
    if req.interpret and results:
        try:
            interpretation = interpret_results(results, req.custom_question)
        except Exception as e:
            interpretation = {"error": str(e)}

    return {
        "success": True,
        "results": results,
        "errors": errors if errors else None,
        "interpretation": interpretation,
    }
