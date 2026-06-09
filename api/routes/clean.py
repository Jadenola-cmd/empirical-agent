from fastapi import APIRouter, UploadFile, File, Form, HTTPException
from typing import List
import json, logging
from services.data_loader import load_file
from services.cleaner import merge_files, clean_data, check_merge_type
from services.session_store import save_session, load_session, save_cleaned

logger = logging.getLogger("empirical")

router = APIRouter()


@router.post("/upload")
async def upload_and_preview(files: List[UploadFile] = File(...)):
    if len(files) > 5:
        raise HTTPException(status_code=400, detail="最多上传5个文件")

    MAX_SIZE = 50 * 1024 * 1024  # 50MB
    previews = []
    dfs = {}
    for f in files:
        content = await f.read()
        if len(content) > MAX_SIZE:
            raise HTTPException(status_code=413, detail=f"{f.filename} 文件超过 50MB 限制，请精简变量或样本后重新上传")
        try:
            df = load_file(content, f.filename)
            dfs[f.filename] = df
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

    session_id = save_session(dfs)
    file_info = [f"{p['filename']}({p['rows']}行×{p['cols']}列)" for p in previews]
    logger.info("[upload] files=%s", " | ".join(file_info))
    return {"files": previews, "session_id": session_id}


@router.post("/check-merge")
async def check_merge(
    files: List[UploadFile] = File(default=[]),
    merge_config: str = Form(...),
):
    """
    合并类型预检查：判断键是否唯一，是否存在 N:N 风险
    在用户点"执行清洗"前调用，返回警告
    """
    try:
        merge_cfg = json.loads(merge_config)
    except Exception:
        raise HTTPException(status_code=400, detail="配置参数格式错误")

    keys = merge_cfg.get("keys", [])
    field_maps = merge_cfg.get("field_maps", {})

    if not keys:
        return {"ok": True, "type": "no_keys", "details": []}

    session_id = merge_cfg.get("session_id")
    if session_id:
        try:
            dfs = load_session(session_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        dfs = {}
        for f in files:
            content = await f.read()
            dfs[f.filename] = load_file(content, f.filename)

    result = check_merge_type(dfs, keys, field_maps)
    return result


@router.post("/merge-and-clean")
async def merge_and_clean(
    files: List[UploadFile] = File(default=[]),
    merge_config: str = Form(...),
    clean_config: str = Form(...),
):
    """
    合并 + 清洗。

    merge_config 新增字段：
      field_maps: {"file1.csv": {"股票代码": "firm_id"}, "file2.csv": {}}
      session_id: 上传时返回的会话ID，提供后无需重传文件

    clean_config 新增字段：
      log_vars: ["sales", "asset"]  → 生成 ln_sales, ln_asset
    """
    try:
        merge_cfg = json.loads(merge_config)
        clean_cfg = json.loads(clean_config)
    except Exception:
        raise HTTPException(status_code=400, detail="配置参数格式错误")

    session_id = merge_cfg.get("session_id")
    if session_id:
        try:
            dfs = load_session(session_id)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
    else:
        dfs = {}
        for f in files:
            content = await f.read()
            dfs[f.filename] = load_file(content, f.filename)

    try:
        merged = merge_files(dfs, merge_cfg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"合并失败：{str(e)}")

    try:
        cleaned, report = clean_data(merged, clean_cfg)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"清洗失败：{str(e)}")

    # 生成 do 文件片段（清洗部分）
    do_snippet = _gen_clean_do(merge_cfg, clean_cfg, dfs)
    cleaned_session_id = save_cleaned(cleaned)

    return {
        "report": report,
        "rows_before": report["rows_before"],
        "rows_after": report["rows_after"],
        "cols": cleaned.columns.tolist(),
        "dtypes": {col: str(dtype) for col, dtype in cleaned.dtypes.items()},
        "missing_after": cleaned.isnull().sum().to_dict(),
        "preview": cleaned.head(10).fillna("").to_dict(orient="records"),
        "data": _df_to_json_records(cleaned),
        "columns": cleaned.columns.tolist(),
        "do_clean": do_snippet,
        "cleaned_session_id": cleaned_session_id,
    }


def _df_to_json_records(df: "pd.DataFrame") -> list:
    """
    将 DataFrame 转为 JSON 可序列化的 records 列表。
    - 数值列的 NaN 保持为 None（JSON null），而非 "" 空字符串。
      否则分析层 pd.to_numeric("", errors="coerce") 会把整列变成 NaN，导致 dropna 后数据为空。
    - 字符串/object 列的 NaN 用 "" 替代，保持前端显示正常。
    """
    import math
    records = df.to_dict(orient="records")
    num_cols = set(df.select_dtypes(include="number").columns)
    for rec in records:
        for k, v in rec.items():
            if k in num_cols:
                if isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    rec[k] = None
            else:
                if v is None or (isinstance(v, float) and math.isnan(v)):
                    rec[k] = ""
    return records


def _gen_clean_do(merge_cfg: dict, clean_cfg: dict, dfs: dict) -> str:
    """生成 Stata do 文件的清洗部分"""
    lines = ["* ── 数据清洗（自动生成）──"]
    filenames = list(dfs.keys())

    # 加载文件
    for i, fn in enumerate(filenames):
        varname = fn.replace(".", "_").replace("-", "_")
        lines.append(f'import delimited "{fn}", clear encoding(utf8)')
        fm = merge_cfg.get("field_maps", {}).get(fn, {})
        for old, new in fm.items():
            lines.append(f"rename {old} {new}")
        if i > 0:
            keys = merge_cfg.get("keys", [])
            strategy = merge_cfg.get("strategy", "inner")
            stata_how = {"inner": "", "left": ", keep(master match)", "outer": ", keep(all)"}.get(strategy, "")
            lines.append(f'save "{varname}_temp.dta", replace')
            lines.append(f"use \"{filenames[0].replace('.', '_').replace('-', '_')}_temp.dta\", clear")
            lines.append(f'merge m:m {" ".join(keys)} using "{varname}_temp.dta"{stata_how}')
            lines.append("drop _merge")

    # 删除列
    drop_cols = clean_cfg.get("drop_cols", [])
    if drop_cols:
        lines.append(f"drop {' '.join(drop_cols)}")

    # 删除重复值
    dedup_vars = clean_cfg.get("dedup_vars", [])
    if dedup_vars:
        dedup_keep = clean_cfg.get("dedup_keep", "first")
        if dedup_keep == "none":
            lines.append(f"duplicates drop {' '.join(dedup_vars)}, force")
            lines.append(f"* 注：上面会删除整组重复（与所选变量取值完全相同的行全部删除）；")
            lines.append(f"* 若只想保留每组中的第一条，改用：bysort {' '.join(dedup_vars)}: keep if _n == 1")
        else:
            lines.append(f"bysort {' '.join(dedup_vars)}: keep if _n == {'_N' if dedup_keep == 'last' else '1'}")

    # 缺失值
    missing = clean_cfg.get("missing", "drop")
    if missing == "drop":
        lines.append("* 删除缺失值行")
        lines.append("egen nmiss = rowmiss(_all)")
        lines.append("drop if nmiss > 0")
        lines.append("drop nmiss")
    elif missing == "mean":
        lines.append("* 均值填充（对所有数值变量）")
        lines.append("foreach v of varlist _all {")
        lines.append("    cap replace `v' = r(mean) if missing(`v')")
        lines.append("    cap summ `v'")
        lines.append("}")

    # 对数变换
    log_vars = clean_cfg.get("log_vars", [])
    for col in log_vars:
        lines.append(f"gen ln_{col} = log({col})")
        lines.append(f"* 注：若 {col} 含0或负值，改用: gen ln_{col} = log(1 + {col})")

    # 缩尾处理
    winsorize_vars = clean_cfg.get("winsorize_vars", [])
    if winsorize_vars:
        lo = clean_cfg.get("winsorize_lower", 1)
        hi = clean_cfg.get("winsorize_upper", 99)
        lines.append("* 缩尾处理（需 ssc install winsor2）")
        lines.append(f"winsor2 {' '.join(winsorize_vars)}, cuts({lo} {100 - hi}) replace")

    # 异常值
    outlier = clean_cfg.get("outlier", "none")
    threshold = clean_cfg.get("outlier_threshold", 3.0)
    if outlier == "iqr":
        lines.append(f"* IQR法去异常值（倍数={threshold}）")
        lines.append("foreach v of varlist _all {")
        lines.append(f"    cap {{")
        lines.append(f"        summ `v', detail")
        lines.append(f"        scalar iqr = r(p75) - r(p25)")
        lines.append(f"        drop if `v' < r(p25) - {threshold}*iqr | `v' > r(p75) + {threshold}*iqr")
        lines.append(f"    }}")
        lines.append("}")
    elif outlier == "zscore":
        lines.append(f"* Z-score法去异常值（阈值={threshold}σ）")
        lines.append("* Stata 需手动实现 zscore，以下为示例")
        lines.append("foreach v of varlist _all {")
        lines.append(f"    cap {{")
        lines.append(f"        summ `v'")
        lines.append(f"        drop if abs((`v' - r(mean)) / r(sd)) > {threshold}")
        lines.append(f"    }}")
        lines.append("}")

    return "\n".join(lines)
