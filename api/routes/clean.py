from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from fastapi.responses import JSONResponse
from typing import List, Optional
import json
from services.data_loader import load_file
from services.cleaner import merge_files, clean_data, get_cleaning_report

router = APIRouter()


@router.post("/upload")
async def upload_and_preview(
    files: List[UploadFile] = File(...),
):
    """
    第一步：上传多个文件，返回预览和基本信息
    支持 .csv / .xlsx / .xls / .dta
    """
    if len(files) > 5:
        raise HTTPException(status_code=400, detail="最多上传5个文件")

    previews = []
    for f in files:
        content = await f.read()
        try:
            df = load_file(content, f.filename)
            previews.append({
                "filename": f.filename,
                "rows": len(df),
                "cols": len(df.columns),
                "columns": df.columns.tolist(),
                "dtypes": {col: str(dtype) for col, dtype in df.dtypes.items()},
                "missing": df.isnull().sum().to_dict(),
                "preview": df.head(5).fillna("").to_dict(orient="records"),
            })
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"{f.filename} 解析失败：{str(e)}")

    return {"files": previews}


@router.post("/merge-and-clean")
async def merge_and_clean(
    files: List[UploadFile] = File(...),
    merge_config: str = Form(...),   # JSON string
    clean_config: str = Form(...),   # JSON string
):
    """
    第二步：合并多个文件 + 数据清洗，返回清洗后数据预览和报告

    merge_config 示例:
    {
      "strategy": "left" | "inner" | "outer",
      "keys": ["id", "year"],   # 合并键（面板数据通常是 entity + time）
      "files_order": ["file1.csv", "file2.csv"]
    }

    clean_config 示例:
    {
      "missing": "drop" | "mean" | "median" | "ffill",
      "outlier": "none" | "iqr" | "zscore",
      "outlier_threshold": 3.0,
      "drop_cols": ["col1"],
      "rename_cols": {"old": "new"}
    }
    """
    try:
        merge_cfg = json.loads(merge_config)
        clean_cfg = json.loads(clean_config)
    except Exception:
        raise HTTPException(status_code=400, detail="配置参数格式错误")

    # Load all files
    dfs = {}
    for f in files:
        content = await f.read()
        dfs[f.filename] = load_file(content, f.filename)

    # Merge
    try:
        merged = merge_files(dfs, merge_cfg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"合并失败：{str(e)}")

    # Clean
    try:
        cleaned, report = clean_data(merged, clean_cfg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"清洗失败：{str(e)}")

    return {
        "report": report,
        "rows_before": report["rows_before"],
        "rows_after": report["rows_after"],
        "cols": cleaned.columns.tolist(),
        "dtypes": {col: str(dtype) for col, dtype in cleaned.dtypes.items()},
        "missing_after": cleaned.isnull().sum().to_dict(),
        "preview": cleaned.head(10).fillna("").to_dict(orient="records"),
        # 把清洗后的数据序列化存入响应，前端存入 sessionStorage 供分析层使用
        "data": cleaned.fillna("").to_dict(orient="records"),
        "columns": cleaned.columns.tolist(),
    }
