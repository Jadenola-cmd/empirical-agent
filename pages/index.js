import { useState, useRef } from "react";
import Head from "next/head";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─── 导出工具 ───────────────────────────────────────
function exportXlsx(analyzeResults, cleanedData) {
  import("xlsx").then(XLSX => {
    const wb = XLSX.utils.book_new();

    if (cleanedData?.data?.length) {
      const ws = XLSX.utils.json_to_sheet(cleanedData.data);
      XLSX.utils.book_append_sheet(wb, ws, "清洗数据");
    }

    const r = analyzeResults?.results;
    if (!r) { XLSX.writeFile(wb, "实证分析结果.xlsx"); return; }

    if (r.descriptive?.vars) {
      const rows = [
        ["VarName", "Obs", "Mean", "SD", "Min", "Median", "Max"],
        ...r.descriptive.vars.map(v => [
          v.name,
          v.obs,
          +v.mean.toFixed(3),
          +v.sd.toFixed(3),
          +v.min.toFixed(3),
          +v.median.toFixed(3),
          +v.max.toFixed(3),
        ]),
        [],
        [r.descriptive.notes || "样本标准差（ddof=1），与 Stata summarize 一致"],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "描述统计");
    }

    if (r.correlation?.vars) {
      const vars = r.correlation.vars;
      const header = ["", ...vars.map((_, i) => `(${i + 1})`)];
      const dataRows = r.correlation.matrix.map((row, i) => [
        vars[i],
        ...row.map((cell, j) => i === j ? "1" : `${cell.coef.toFixed(3)}${cell.sig}`),
      ]);
      const rows = [header, ...dataRows, [], [r.correlation.notes || "***p<0.01, **p<0.05, *p<0.1"]];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "相关矩阵");
    }

    function buildRegSheet(reg, label) {
      if (!reg?.coefficients) return null;
      const isPanel = reg.type === "fe" || reg.type === "re";
      const cons = reg.coefficients.find(c => c.variable === "_cons");
      const vars = reg.coefficients.filter(c => c.variable !== "_cons");
      const rows = [];
      rows.push([label, "(1)"]);
      rows.push(["", reg.dep_var]);
      rows.push([]);
      vars.forEach(c => {
        rows.push([c.variable, `${c.coef.toFixed(3)}${c.sig}`]);
        rows.push(["", `(${c.t_stat.toFixed(2)})`]);
      });
      if (cons) {
        rows.push(["_cons", `${cons.coef.toFixed(3)}${cons.sig}`]);
        rows.push(["", `(${cons.t_stat.toFixed(2)})`]);
      }
      rows.push([]);
      rows.push(["ind FE", isPanel && reg.type === "fe" ? "Yes" : "No"]);
      rows.push(["year FE", "No"]);
      rows.push(["N", reg.n]);
      if (isPanel) {
        rows.push(["R² (within)", reg.r2_within?.toFixed(3)]);
        rows.push(["R² (overall)", reg.r2_overall?.toFixed(3)]);
      } else {
        rows.push(["R²", reg.r2?.toFixed(3)]);
        rows.push(["Adj. R²", reg.r2_adj?.toFixed(3)]);
        rows.push(["F", reg.f_stat?.toFixed(3)]);
      }
      if (reg.hausman) {
        rows.push([]);
        rows.push([`Hausman检验: χ²=${reg.hausman.chi2}, p=${reg.hausman.p_value}`]);
        rows.push([reg.hausman.conclusion]);
      }
      rows.push([]);
      rows.push([reg.notes || "括号内为t值，***p<0.01, **p<0.05, *p<0.1"]);
      if (reg.dropped_vars?.length) {
        rows.push([`注：${reg.dropped_vars.join(", ")} 因完全共线性被自动移除`]);
      }
      return XLSX.utils.aoa_to_sheet(rows);
    }

    if (r.ols) { const ws = buildRegSheet(r.ols, "OLS 回归结果"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "OLS"); }
    if (r.panel_fe) { const ws = buildRegSheet(r.panel_fe, "固定效应回归（xtreg, fe）"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "固定效应"); }
    if (r.panel_re) { const ws = buildRegSheet(r.panel_re, "随机效应回归（xtreg, re）"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "随机效应"); }

    XLSX.writeFile(wb, `实证分析_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
}

function exportDoFile(doClean, doAnalyze) {
  const content = [
    "* ════════════════════════════════════",
    "* Stata Do 文件（由 Empirical Agent 自动生成）",
    `* 生成时间：${new Date().toLocaleString("zh-CN")}`,
    "* ════════════════════════════════════",
    "",
    doClean || "",
    doAnalyze || "",
    "",
    "* 文件结束",
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `empirical_${new Date().toISOString().slice(0, 10)}.do`;
  a.click();
}

// ─── 数据预览表格 ───────────────────────────────────
function DataPreviewTable({ preview, columns, title }) {
  if (!preview?.length) return null;
  const cols = columns || Object.keys(preview[0]);
  return (
    <div className="preview-block">
      <div className="prev-title">{title || "数据预览（前10行）"}</div>
      <div className="prev-scroll">
        <table className="prev-table">
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i}>{cols.map(c => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 字段映射 ───────────────────────────────────────
function FieldMapper({ files, fieldMaps, onChange }) {
  if (!files?.length) return null;
  return (
    <div className="field-mapper">
      <div className="fm-hint">将各文件的列名统一为标准名（解决"股票代码 vs 证券代码"等问题）。留空表示不改名。</div>
      {files.map(f => (
        <div key={f.filename} className="fm-file">
          <div className="fm-fname">📄 {f.filename}</div>
          <div className="fm-cols">
            {f.columns.map(col => {
              const mapped = fieldMaps[f.filename]?.[col] || "";
              return (
                <div key={col} className="fm-row">
                  <span className="fm-orig">{col}</span>
                  <span className="fm-arrow">→</span>
                  <input
                    className="fm-input"
                    value={mapped}
                    placeholder={col}
                    onChange={e => {
                      const val = e.target.value.trim();
                      onChange(prev => {
                        const next = { ...prev };
                        if (!next[f.filename]) next[f.filename] = {};
                        if (val && val !== col) {
                          next[f.filename][col] = val;
                        } else {
                          delete next[f.filename][col];
                        }
                        return next;
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 合并类型检查徽章 ────────────────────────────────
function MergeTypeBadge({ mergeCheck }) {
  if (!mergeCheck) return null;
  const colors = { "1:1": "#2a7a2a", "1:N": "#2c4a8a", "N:N": "#8a2c2c", "unknown": "#888", "no_keys": "#888" };
  return (
    <div className="merge-check">
      <span className="mc-type" style={{ background: colors[mergeCheck.type] || "#888" }}>{mergeCheck.type}</span>
      {mergeCheck.warning && <span className="mc-warn">{mergeCheck.warning}</span>}
      {!mergeCheck.warning && mergeCheck.type !== "no_keys" && mergeCheck.type !== "unknown" && (
        <span className="mc-ok">✓ 合并类型正常</span>
      )}
      <div className="mc-details">
        {mergeCheck.details?.map((d, i) => (
          <span key={i} className={`mc-detail ${d.is_unique ? "ok" : "warn"}`}>{d.file}: {d.message}</span>
        ))}
      </div>
    </div>
  );
}

// ─── 学术表格 ───────────────────────────────────────
function DescriptiveTable({ data }) {
  if (!data?.vars?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">描述性统计</div>
      <div className="tbl-scroll">
        <table className="acad-table">
          <thead><tr>
            <th className="col-var">VarName</th>
            <th>Obs</th><th>Mean</th><th>SD</th>
            <th>Min</th><th>Median</th><th>Max</th>
          </tr></thead>
          <tbody>
            {data.vars.map((v, i) => (
              <tr key={i}>
                <td className="col-var">{v.name}</td>
                <td>{v.obs.toLocaleString()}</td>
                <td>{v.mean.toFixed(3)}</td>
                <td>{v.sd.toFixed(3)}</td>
                <td>{v.min.toFixed(3)}</td>
                <td>{v.median.toFixed(3)}</td>
                <td>{v.max.toFixed(3)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function CorrelationTable({ data }) {
  if (!data?.vars?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">相关系数矩阵</div>
      <div className="tbl-scroll">
        <table className="acad-table corr-tbl">
          <thead><tr>
            <th className="col-var"></th>
            {data.vars.map((v, i) => <th key={i}>({i + 1})</th>)}
          </tr></thead>
          <tbody>
            {data.vars.map((v, i) => (
              <tr key={i}>
                <td className="col-var">{v}</td>
                {(data.matrix[i] || []).map((cell, j) => (
                  <td key={j} className="col-corr">
                    {i === j ? "1" : <>{cell.coef.toFixed(3)}<sup className="sig">{cell.sig}</sup></>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function RegressionTable({ data, label }) {
  if (!data?.coefficients?.length) return null;
  const cons = data.coefficients.find(c => c.variable === "_cons");
  const vars = data.coefficients.filter(c => c.variable !== "_cons");
  const isPanel = data.type === "fe" || data.type === "re";
  return (
    <div className="result-block">
      <div className="tbl-title">{label || "回归结果"}</div>
      {data.dropped_vars?.length > 0 && (
        <div className="dropped-warn">⚠️ 以下变量因完全共线性被自动移除（对齐 Stata omit 行为）：{data.dropped_vars.join(", ")}</div>
      )}
      <table className="acad-table reg-tbl">
        <thead><tr>
          <th className="col-var"></th>
          <th className="col-reg">(1)<br /><span className="depvar">{data.dep_var}</span></th>
        </tr></thead>
        <tbody>
          {vars.map((c, i) => (
            <tr key={i}>
              <td className="col-var">{c.variable}</td>
              <td className="col-reg">
                <div>{c.coef.toFixed(3)}<sup className="sig">{c.sig}</sup></div>
                <div className="tval">({c.t_stat.toFixed(2)})</div>
              </td>
            </tr>
          ))}
          {cons && (
            <tr>
              <td className="col-var">_cons</td>
              <td className="col-reg">
                <div>{cons.coef.toFixed(3)}<sup className="sig">{cons.sig}</sup></div>
                <div className="tval">({cons.t_stat.toFixed(2)})</div>
              </td>
            </tr>
          )}
          <tr className="fe-row"><td className="col-var">ind FE</td><td className="col-reg">{isPanel && data.type === "fe" ? "Yes" : "No"}</td></tr>
          <tr className="fe-row"><td className="col-var">year FE</td><td className="col-reg">No</td></tr>
          <tr className="stat-row"><td className="col-var">N</td><td className="col-reg">{data.n?.toLocaleString()}</td></tr>
          {isPanel ? (
            <>
              <tr className="stat-row"><td className="col-var">R² (within)</td><td className="col-reg">{data.r2_within?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">R² (overall)</td><td className="col-reg">{data.r2_overall?.toFixed(3)}</td></tr>
            </>
          ) : (
            <>
              <tr className="stat-row"><td className="col-var">R²</td><td className="col-reg">{data.r2?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">Adj. R²</td><td className="col-reg">{data.r2_adj?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">F</td><td className="col-reg">{data.f_stat?.toFixed(3)}</td></tr>
            </>
          )}
        </tbody>
      </table>
      {data.hausman && (
        <div className="hausman-box">
          <strong>Hausman 检验</strong>：χ²={data.hausman.chi2}，p={data.hausman.p_value}
          <br />{data.hausman.conclusion}
        </div>
      )}
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function TagSelector({ options, selected, onChange, single, dtypes }) {
  function dtBadge(col) {
    if (!dtypes) return null;
    const t = dtypes[col] || "";
    if (t.startsWith("float"))    return <span className="dt-badge dt-num">float</span>;
    if (t.startsWith("int"))      return <span className="dt-badge dt-int">int</span>;
    if (t.startsWith("datetime")) return <span className="dt-badge dt-date">日期</span>;
    if (t === "object" || t.startsWith("string")) return <span className="dt-badge dt-str">文本</span>;
    if (t.startsWith("bool"))     return <span className="dt-badge dt-bool">bool</span>;
    if (t) return <span className="dt-badge dt-other">{t.split("[")[0]}</span>;
    return null;
  }
  return (
    <div className="tag-sel">
      {options.map(opt => (
        <span key={opt} className={`vtag ${selected.includes(opt) ? "sel" : ""}`}
          onClick={() => {
            if (single) onChange(selected.includes(opt) ? [] : [opt]);
            else onChange(selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt]);
          }}>{opt}{dtBadge(opt)}</span>
      ))}
    </div>
  );
}

// ─── 主组件 ─────────────────────────────────────────
export default function Home() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [fieldMaps, setFieldMaps] = useState({});
  const [showFieldMapper, setShowFieldMapper] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState("inner");
  const [mergeKeys, setMergeKeys] = useState([]);
  const [mergeCheck, setMergeCheck] = useState(null);
  const [mergeCheckLoading, setMergeCheckLoading] = useState(false);
  const [missingStrategy, setMissingStrategy] = useState("drop");
  const [outlierStrategy, setOutlierStrategy] = useState("none");
  const [outlierThreshold, setOutlierThreshold] = useState(3.0);
  const [dropCols, setDropCols] = useState([]);
  const [strCols, setStrCols] = useState([]);
  const [logVars, setLogVars] = useState([]);
  const [cleanedData, setCleanedData] = useState(null);
  const [cleanReport, setCleanReport] = useState(null);
  const [cleanPreview, setCleanPreview] = useState(null);
  const [doClean, setDoClean] = useState("");
  const [layer1Loading, setLayer1Loading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(null); // null | 0-100
  const [uploadSpeed, setUploadSpeed] = useState(null);       // bytes/s
  const [uploadETA, setUploadETA] = useState(null);           // seconds

  const [analysisTypes, setAnalysisTypes] = useState([]);
  const [selectedVars, setSelectedVars] = useState([]);
  const [depVar, setDepVar] = useState("");
  const [indepVars, setIndepVars] = useState([]);
  const [controlVars, setControlVars] = useState([]);
  const [entityVar, setEntityVar] = useState("");
  const [timeVar, setTimeVar] = useState("");
  const [robustSE, setRobustSE] = useState(false);
  const [clusterVar, setClusterVar] = useState("");
  const [analyzeResults, setAnalyzeResults] = useState(null);
  const [doAnalyze, setDoAnalyze] = useState("");
  const [layer2Loading, setLayer2Loading] = useState(false);
  const [interpret, setInterpret] = useState(false);
  const [customQ, setCustomQ] = useState("");

  const fileRef = useRef();

  function fmtSize(b) {
    if (!b) return "0 B";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }
  function fmtSpeed(bps) {
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
    return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  }
  function fmtETA(s) {
    if (!s || s < 1) return "< 1秒";
    if (s < 60) return `${Math.round(s)}秒`;
    return `${Math.floor(s / 60)}分${Math.round(s % 60)}秒`;
  }

  async function handleUpload(newFiles) {
    if (!newFiles.length) return;
    const combined = [...uploadedFiles, ...Array.from(newFiles)].slice(0, 5);
    setUploadedFiles(combined);
    const form = new FormData();
    combined.forEach(f => form.append("files", f));
    setLayer1Loading(true);
    setUploadProgress(0);
    setUploadSpeed(null);
    setUploadETA(null);
    try {
      const text = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const t0 = Date.now();
        xhr.upload.onprogress = e => {
          if (!e.lengthComputable || !e.total) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          const elapsed = (Date.now() - t0) / 1000;
          const speed = elapsed > 0.2 ? e.loaded / elapsed : 0;
          const eta = speed > 0 ? (e.total - e.loaded) / speed : null;
          setUploadProgress(pct);
          if (speed > 0) setUploadSpeed(speed);
          setUploadETA(eta);
        };
        xhr.upload.onload = () => { setUploadProgress(100); setUploadSpeed(null); setUploadETA(null); };
        xhr.onload  = () => xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("网络错误，请检查连接"));
        xhr.open("POST", `${API_URL}/api/clean/upload`);
        xhr.send(form);
      });
      const json = JSON.parse(text);
      if (!json.files) throw new Error(json.detail || "上传失败");
      setFilePreviews(json.files);
      setMergeCheck(null);
    } catch (e) { alert("上传失败：" + e.message); }
    setLayer1Loading(false);
    setUploadProgress(null);
    setUploadSpeed(null);
    setUploadETA(null);
  }

  function removeFile(idx) {
    const fn = uploadedFiles[idx]?.name;
    const newFiles = uploadedFiles.filter((_, i) => i !== idx);
    const newPreviews = filePreviews.filter((_, i) => i !== idx);
    setUploadedFiles(newFiles);
    setFilePreviews(newPreviews);
    setMergeKeys([]);
    setDropCols([]);
    setStrCols([]);
    setLogVars([]);
    setFieldMaps(prev => { const n = { ...prev }; delete n[fn]; return n; });
    setMergeCheck(null);
    setCleanedData(null);
    setCleanReport(null);
    setCleanPreview(null);
  }

  async function handleCheckMerge() {
    if (!uploadedFiles.length || !mergeKeys.length) return;
    setMergeCheckLoading(true);
    const form = new FormData();
    uploadedFiles.forEach(f => form.append("files", f));
    form.append("merge_config", JSON.stringify({ keys: mergeKeys, field_maps: fieldMaps }));
    try {
      const res = await fetch(`${API_URL}/api/clean/check-merge`, { method: "POST", body: form });
      const json = await res.json();
      setMergeCheck(json);
    } catch (e) { alert("检查失败：" + e.message); }
    setMergeCheckLoading(false);
  }

  async function handleClean() {
    if (!uploadedFiles.length) return;
    setLayer1Loading(true);
    setCleanedData(null); setCleanReport(null); setCleanPreview(null);
    const form = new FormData();
    uploadedFiles.forEach(f => form.append("files", f));
    form.append("merge_config", JSON.stringify({
      strategy: mergeStrategy,
      keys: mergeKeys,
      files_order: uploadedFiles.map(f => f.name),
      field_maps: fieldMaps,
    }));
    form.append("clean_config", JSON.stringify({
      missing: missingStrategy,
      outlier: outlierStrategy,
      outlier_threshold: outlierThreshold,
      drop_cols: dropCols,
      str_cols: strCols,
      log_vars: logVars,
    }));
    try {
      const res = await fetch(`${API_URL}/api/clean/merge-and-clean`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "清洗失败");
      setCleanedData({ data: json.data, columns: json.columns, dtypes: json.dtypes || {} });
      setCleanReport(json.report);
      setCleanPreview(json.preview);
      setDoClean(json.do_clean || "");
    } catch (e) { alert("清洗失败：" + e.message); }
    setLayer1Loading(false);
  }

  async function handleAnalyze() {
    if (!cleanedData) return alert("请先完成数据清洗");
    if (!analysisTypes.length) return alert("请选择至少一种分析方法");
    setLayer2Loading(true);
    setAnalyzeResults(null);
    try {
      const res = await fetch(`${API_URL}/api/analyze/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          data: cleanedData.data,
          analysis_types: analysisTypes,
          variables: selectedVars.length ? selectedVars : null,
          dep_var: depVar || null,
          indep_vars: indepVars.length ? indepVars : null,
          control_vars: controlVars.length ? controlVars : null,
          entity_var: entityVar || null,
          time_var: timeVar || null,
          robust_se: robustSE,
          cluster_var: clusterVar || null,
          interpret,
          custom_question: customQ || null,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "分析失败");
      setAnalyzeResults(json);
      setDoAnalyze(json.do_analyze || "");
    } catch (e) { alert("分析失败：" + e.message); }
    setLayer2Loading(false);
  }

  const allCols = filePreviews.flatMap(f => f.columns);
  const mappedCols = filePreviews.flatMap(f =>
    f.columns.map(c => fieldMaps[f.filename]?.[c] || c)
  );
  const uniqueCols = [...new Set(allCols)];
  const uniqueMappedCols = [...new Set(mappedCols)];
  const cleanedCols = cleanedData?.columns || [];
  const needsPanel = analysisTypes.some(t => ["panel_fe", "panel_re"].includes(t));
  const needsReg = analysisTypes.some(t => ["ols", "panel_fe", "panel_re"].includes(t));
  const sectionNum = (base) => filePreviews.length > 1 ? base : base - 1;

  return (
    <>
      <Head>
        <title>论文实证分析平台</title>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        <div className="jheader">
          <span className="jname">Empirical Research Platform</span>
          <span className="jmeta">数据清洗 · 统计分析 · 论文规范输出</span>
        </div>
        <div className="title-block">
          <h1>论文实证分析<span>平台</span></h1>
          <p className="sub">与 Stata 结果一致 · 两层架构 · 面板数据支持</p>
        </div>

        <div className="layer-badge">第一层：数据清洗</div>

        {/* 01 上传 */}
        <div className="section">
          <div className="sh"><span className="sn">01</span><span className="st">上传数据文件</span><span className="shint">最多5个</span></div>
          <div className={`upload-zone ${layer1Loading ? "uploading" : ""}`}
            onClick={() => !layer1Loading && fileRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (!layer1Loading) handleUpload(e.dataTransfer.files); }}>
            <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls,.dta" multiple style={{ display: "none" }}
              onChange={e => handleUpload(e.target.files)} />
            <div className="uicon">{layer1Loading ? "⏳" : "📂"}</div>
            <h3>{layer1Loading ? (uploadProgress < 100 ? "上传中…" : "解析中…") : "上传数据文件"}</h3>
            <p>支持 .csv / .xlsx / .xls / .dta · 可多选</p>
          </div>

          {uploadProgress !== null && (
            <div className="upload-progress-wrap">
              <div className="up-bar-bg">
                <div className="up-bar-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
              <div className="up-info">
                {uploadProgress < 100
                  ? <>{uploadProgress}%{uploadSpeed > 0 && <> · {fmtSpeed(uploadSpeed)}</>}{uploadETA !== null && uploadETA > 0 && <> · 预计剩余 {fmtETA(uploadETA)}</>}</>
                  : <>上传完成 · 服务器解析文件中<span className="dots-anim">…</span></>
                }
              </div>
            </div>
          )}

          {layer1Loading && uploadProgress !== null && filePreviews.length === 0 && uploadedFiles.length > 0 && (
            <div className="file-cards">
              {uploadedFiles.map((f, i) => (
                <div key={i} className="file-card fc-pending">
                  <div className="fc-header"><div className="fc-name">📄 {f.name}</div></div>
                  <div className="fc-meta">{fmtSize(f.size)} · 待解析</div>
                </div>
              ))}
            </div>
          )}

          {filePreviews.length > 0 && (
            <div className="file-cards">
              {filePreviews.map((f, i) => (
                <div key={i} className="file-card">
                  <div className="fc-header">
                    <div className="fc-name">📄 {f.filename}</div>
                    <button className="fc-del" onClick={() => removeFile(i)}>✕</button>
                  </div>
                  <div className="fc-meta">{f.rows.toLocaleString()} 行 × {f.cols} 列 · {fmtSize(uploadedFiles.find(u => u.name === f.filename)?.size)}</div>
                  <div className="fc-cols">
                    {f.columns.map(c => {
                      const dtype = f.dtypes?.[c] || "";
                      const isNum = dtype.includes("float") || dtype.includes("int");
                      const mappedName = fieldMaps[f.filename]?.[c];
                      return (
                        <span key={c} className={`fc-col-tag ${isNum ? "num" : "str"}`}>
                          {mappedName ? `${c}→${mappedName}` : c}
                        </span>
                      );
                    })}
                  </div>
                  {Object.entries(f.missing || {}).some(([, v]) => v > 0) && (
                    <div className="fc-missing">
                      缺失：{Object.entries(f.missing).filter(([, v]) => v > 0).map(([k, v]) => `${k}(${v})`).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 02 字段映射 */}
        {filePreviews.length > 0 && (
          <div className="section">
            <div className="sh">
              <span className="sn">02</span>
              <span className="st">字段映射</span>
              <span className="shint">可选 · 统一列名</span>
              <button className="toggle-btn" onClick={() => setShowFieldMapper(v => !v)}>
                {showFieldMapper ? "收起 ▲" : "展开 ▼"}
              </button>
            </div>
            {showFieldMapper && (
              <FieldMapper files={filePreviews} fieldMaps={fieldMaps} onChange={setFieldMaps} />
            )}
          </div>
        )}

        {/* 03 合并配置（多文件时显示） */}
        {filePreviews.length > 1 && (
          <div className="section">
            <div className="sh"><span className="sn">03</span><span className="st">合并配置</span></div>
            <div className="config-grid">
              <div className="config-item">
                <label className="cfg-label">合并方式</label>
                <div className="radio-group">
                  {[["inner","取交集"],["left","左连接"],["outer","取并集"],["concat","纵向堆叠"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${mergeStrategy === v ? "sel" : ""}`} onClick={() => setMergeStrategy(v)}>{l}</label>
                  ))}
                </div>
              </div>
              {mergeStrategy !== "concat" && (
                <div className="config-item">
                  <label className="cfg-label">合并键（映射后列名）</label>
                  <TagSelector options={uniqueMappedCols} selected={mergeKeys} onChange={keys => { setMergeKeys(keys); setMergeCheck(null); }} />
                  {mergeKeys.length > 0 && (
                    <button className="check-btn" onClick={handleCheckMerge} disabled={mergeCheckLoading}>
                      {mergeCheckLoading ? "检查中…" : "🔍 检查合并类型"}
                    </button>
                  )}
                  <MergeTypeBadge mergeCheck={mergeCheck} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 04 清洗配置 */}
        {filePreviews.length > 0 && (
          <div className="section">
            <div className="sh">
              <span className="sn">{filePreviews.length > 1 ? "04" : "03"}</span>
              <span className="st">清洗配置</span>
            </div>
            <div className="config-grid">
              <div className="config-item">
                <label className="cfg-label">缺失值处理</label>
                <div className="radio-group">
                  {[["drop","删除行"],["mean","均值填充"],["median","中位数填充"],["ffill","前向填充"],["zero","填0"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${missingStrategy === v ? "sel" : ""}`} onClick={() => setMissingStrategy(v)}>{l}</label>
                  ))}
                </div>
              </div>
              <div className="config-item">
                <label className="cfg-label">异常值处理</label>
                <div className="radio-group">
                  {[["none","不处理"],["zscore","Z-score"],["iqr","IQR法"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${outlierStrategy === v ? "sel" : ""}`} onClick={() => setOutlierStrategy(v)}>{l}</label>
                  ))}
                </div>
                {outlierStrategy !== "none" && (
                  <input className="threshold-input" type="number" value={outlierThreshold} step="0.5" min="1"
                    onChange={e => setOutlierThreshold(parseFloat(e.target.value))}
                    placeholder={outlierStrategy === "zscore" ? "σ倍数（默认3）" : "IQR倍数（默认1.5）"} />
                )}
              </div>
              {uniqueCols.length > 0 && (
                <div className="config-item">
                  <label className="cfg-label">强制文本型列 <span className="cfg-hint">防止股票代码被识别为数字</span></label>
                  <TagSelector options={uniqueCols} selected={strCols} onChange={setStrCols} />
                </div>
              )}
              {uniqueCols.length > 0 && (
                <div className="config-item">
                  <label className="cfg-label">对数变换 <span className="cfg-hint">生成 ln_xxx 新列</span></label>
                  <TagSelector options={uniqueCols} selected={logVars} onChange={setLogVars} />
                </div>
              )}
              {uniqueCols.length > 0 && (
                <div className="config-item" style={{ gridColumn: "1 / -1" }}>
                  <label className="cfg-label">删除列 <span className="cfg-hint">可选</span></label>
                  <TagSelector options={uniqueCols} selected={dropCols} onChange={setDropCols} />
                </div>
              )}
            </div>
            <button className="run-btn" onClick={handleClean} disabled={layer1Loading}>
              {layer1Loading ? "处理中…" : "执行清洗 →"}
            </button>
          </div>
        )}

        {/* 清洗报告 */}
        {cleanReport && (
          <div className="clean-report">
            <div className="cr-title">✅ 清洗完成</div>
            <div className="cr-stats">
              <span>{cleanReport.rows_before.toLocaleString()} 行 → {cleanReport.rows_after.toLocaleString()} 行</span>
              <span>处理缺失值 {cleanReport.missing_handled} 个</span>
              <span>移除异常值 {cleanReport.outliers_removed} 行</span>
            </div>
            {cleanReport.steps?.map((s, i) => <div key={i} className="cr-step">• {s.step}：{s.detail}</div>)}
          </div>
        )}

        {/* 数据预览 */}
        {cleanPreview && (
          <DataPreviewTable
            preview={cleanPreview}
            columns={cleanedCols}
            title={`清洗后数据预览（前10行，共 ${cleanedData?.data?.length?.toLocaleString()} 行）`}
          />
        )}

        {/* ══ LAYER 2 ══ */}
        {cleanedData && (
          <>
            <hr className="divider" />
            <div className="layer-badge">第二层：实证分析</div>

            {/* 01 分析方法 */}
            <div className="section">
              <div className="sh"><span className="sn">01</span><span className="st">选择分析方法</span><span className="shint">可多选</span></div>
              <div className="analysis-grid">
                {[
                  { type: "descriptive", icon: "📊", title: "描述性统计", desc: "均值/SD/分布 · 对齐 Stata summarize" },
                  { type: "correlation", icon: "🔗", title: "相关系数矩阵", desc: "Pearson + 显著性 · 对齐 Stata pwcorr" },
                  { type: "ols",         icon: "📈", title: "OLS 回归",    desc: "普通最小二乘 · 稳健/聚类SE" },
                  { type: "panel_fe",    icon: "🏛️", title: "固定效应",   desc: "entity FE · Hausman检验" },
                  { type: "panel_re",    icon: "🎲", title: "随机效应",    desc: "GLS估计 · xtreg, re" },
                ].map(card => (
                  <div key={card.type}
                    className={`acard ${analysisTypes.includes(card.type) ? "active" : ""}`}
                    onClick={() => setAnalysisTypes(prev =>
                      prev.includes(card.type) ? prev.filter(t => t !== card.type) : [...prev, card.type]
                    )}>
                    <div className="ci">{card.icon}</div>
                    <div className="ct">{card.title}</div>
                    <div className="cd">{card.desc}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* 02 变量配置 */}
            <div className="section">
              <div className="sh"><span className="sn">02</span><span className="st">变量配置</span></div>
              <div className="var-box">
                <div className="var-row">
                  <span className="vl">参与分析的变量 <span className="vh">不选=全部数值列</span></span>
                  <TagSelector options={cleanedCols} selected={selectedVars} onChange={setSelectedVars} dtypes={cleanedData?.dtypes} />
                </div>
                {needsReg && (
                  <>
                    <div className="var-row">
                      <span className="vl">被解释变量 Y</span>
                      <TagSelector options={cleanedCols} selected={depVar ? [depVar] : []} onChange={v => setDepVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                    </div>
                    <div className="var-row">
                      <span className="vl">解释变量 X</span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar)} selected={indepVars} onChange={setIndepVars} dtypes={cleanedData?.dtypes} />
                    </div>
                    <div className="var-row">
                      <span className="vl">控制变量 <span className="vh">可不选</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && !indepVars.includes(c))} selected={controlVars} onChange={setControlVars} dtypes={cleanedData?.dtypes} />
                    </div>
                  </>
                )}
                {needsPanel && (
                  <>
                    <div className="var-row">
                      <span className="vl">个体变量 <span className="vh">企业/机构唯一ID，如 stkcd、firm_id（选文本或整数列）</span></span>
                      <TagSelector options={cleanedCols} selected={entityVar ? [entityVar] : []} onChange={v => setEntityVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                    </div>
                    <div className="var-row">
                      <span className="vl">时间变量 <span className="vh">年份整数列，如 year（不要选日期列）</span></span>
                      <TagSelector options={cleanedCols} selected={timeVar ? [timeVar] : []} onChange={v => setTimeVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                      {timeVar && (() => {
                        const t = cleanedData?.dtypes?.[timeVar] || "";
                        const isDate = t.startsWith("datetime") || /日期|date|时间|time/i.test(timeVar);
                        if (!isDate) return null;
                        return (
                          <div className="panel-tip warn">
                            ⚠️ "{timeVar}" 是日期列，系统会自动提取年份。建议在清洗阶段新增年份整数列（如 year）以获得最准确的结果。
                          </div>
                        );
                      })()}
                    </div>
                  </>
                )}
                {needsReg && (
                  <div className="var-row">
                    <span className="vl">标准误</span>
                    <div className="radio-group">
                      {[["conventional","常规SE"],["robust","稳健SE(HC1)"],["cluster","聚类SE"]].map(([v, l]) => (
                        <label key={v}
                          className={`radio-btn ${(v === "conventional" && !robustSE && !clusterVar) || (v === "robust" && robustSE && !clusterVar) || (v === "cluster" && clusterVar) ? "sel" : ""}`}
                          onClick={() => {
                            if (v === "conventional") { setRobustSE(false); setClusterVar(""); }
                            else if (v === "robust") { setRobustSE(true); setClusterVar(""); }
                            else if (v === "cluster") { setRobustSE(false); }
                          }}>{l}</label>
                      ))}
                    </div>
                    {!robustSE && (
                      <div style={{ marginTop: 8 }}>
                        <span className="vl">聚类变量</span>
                        <TagSelector options={cleanedCols} selected={clusterVar ? [clusterVar] : []} onChange={v => setClusterVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 03 AI解读 */}
            <div className="section">
              <div className="sh"><span className="sn">03</span><span className="st">AI 解读（可选）</span></div>
              <div className="interp-row">
                <label className={`radio-btn ${interpret ? "sel" : ""}`} onClick={() => setInterpret(!interpret)}>
                  {interpret ? "✓ 开启" : "开启 AI 解读"}
                </label>
                {interpret && (
                  <textarea className="custom-q" value={customQ} onChange={e => setCustomQ(e.target.value)}
                    placeholder="附加问题，如：请解读核心变量的经济学含义" />
                )}
              </div>
              <button className="run-btn" onClick={handleAnalyze} disabled={layer2Loading}>
                {layer2Loading ? "分析中…" : "运行分析 →"}
              </button>
            </div>

            {/* 结果 */}
            {analyzeResults && (
              <div className="result-area">
                <div className="sh"><span className="sn">OUT</span><span className="st">分析结果</span></div>
                <div className="result-paper">
                  <div className="result-header">
                    <span className="rbadge">{analysisTypes.join(" + ").toUpperCase()}</span>
                    <span className="rtitle">实证分析报告</span>
                    <div className="export-btns">
                      <button className="export-btn" onClick={() => exportXlsx(analyzeResults, cleanedData)}>⬇ xlsx</button>
                      <button className="export-btn" onClick={() => exportDoFile(doClean, doAnalyze)}>⬇ do 文件</button>
                      <button className="export-btn" onClick={() => {
                        const el = document.getElementById("result-content");
                        if (!el) return;
                        const blob = new Blob([el.innerText], { type: "text/plain" });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `实证分析_${new Date().toISOString().slice(0,10)}.txt`;
                        a.click();
                      }}>⬇ txt</button>
                    </div>
                  </div>
                  <div className="result-body" id="result-content">
                    {analyzeResults.errors && Object.entries(analyzeResults.errors).map(([k, v]) => (
                      <div key={k} className="err-box">❌ {k}: {v}</div>
                    ))}
                    {analyzeResults.results?.descriptive && <DescriptiveTable data={analyzeResults.results.descriptive} />}
                    {analyzeResults.results?.correlation && <CorrelationTable data={analyzeResults.results.correlation} />}
                    {analyzeResults.results?.ols && <RegressionTable data={analyzeResults.results.ols} label="OLS 回归结果" />}
                    {analyzeResults.results?.panel_fe && <RegressionTable data={analyzeResults.results.panel_fe} label="固定效应回归（xtreg, fe）" />}
                    {analyzeResults.results?.panel_re && <RegressionTable data={analyzeResults.results.panel_re} label="随机效应回归（xtreg, re）" />}
                    {analyzeResults.interpretation && (
                      <div className="interp-result">
                        <div className="ir-title">AI 解读</div>
                        <div className="ir-text">{analyzeResults.interpretation.text}</div>
                      </div>
                    )}
                  </div>
                  <div className="result-footer">* 统计计算由 Python statsmodels/linearmodels 完成，与 Stata 结果一致</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f7f5f0; color: #1a1a1a; font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }
        .app { max-width: 1000px; margin: 0 auto; padding: 48px 24px; }
        .jheader { border-top: 3px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; padding: 14px 0 10px; margin-bottom: 36px; display: flex; justify-content: space-between; align-items: baseline; }
        .jname { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; }
        .jmeta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #8a8078; }
        .title-block { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px solid #ddd8cc; }
        .title-block h1 { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 700; margin-bottom: 8px; }
        .title-block h1 span { color: #2c4a8a; }
        .sub { font-family: 'Playfair Display', serif; font-size: 14px; color: #8a8078; font-style: italic; }
        .layer-badge { display: inline-block; background: #2c4a8a; color: white; font-size: 11px; font-weight: 700; letter-spacing: 2px; padding: 4px 14px; border-radius: 4px; margin-bottom: 24px; font-family: 'IBM Plex Mono', monospace; }
        .section { margin-bottom: 28px; }
        .sh { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
        .sn { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #2c4a8a; font-weight: 500; background: rgba(44,74,138,0.08); border: 1px solid rgba(44,74,138,0.2); padding: 2px 8px; border-radius: 3px; letter-spacing: 1px; }
        .st { font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #3a3530; }
        .shint { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; background: #f0ece3; border: 1px solid #ddd8cc; padding: 2px 8px; border-radius: 10px; }
        .toggle-btn { font-size: 11px; padding: 3px 10px; border: 1px solid #ddd8cc; border-radius: 4px; cursor: pointer; background: #f0ece3; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; margin-left: auto; }
        .toggle-btn:hover { border-color: #2c4a8a; color: #2c4a8a; }
        .upload-zone { border: 2px dashed #ddd8cc; border-radius: 8px; padding: 40px 24px; text-align: center; cursor: pointer; background: #fffef9; transition: all 0.2s; }
        .upload-zone:hover { border-color: #2c4a8a; }
        .upload-zone.uploading { cursor: default; opacity: 0.75; pointer-events: none; }
        .upload-progress-wrap { margin-top: 10px; }
        .up-bar-bg { height: 4px; background: #e8e4dc; border-radius: 2px; overflow: hidden; }
        .up-bar-fill { height: 100%; background: #2c4a8a; border-radius: 2px; transition: width 0.25s ease; }
        .up-info { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #5a5a5a; margin-top: 5px; }
        .fc-pending { opacity: 0.55; }
        @keyframes dots { 0%,20%{content:'.'} 40%{content:'..'} 60%,100%{content:'...'} }
        .dots-anim::after { content: ''; animation: dots 1.2s steps(1) infinite; }
        .dots-anim { font-style: italic; }
        .uicon { font-size: 28px; margin-bottom: 10px; }
        .upload-zone h3 { font-family: 'Playfair Display', serif; font-size: 15px; margin-bottom: 4px; }
        .upload-zone p { font-size: 12px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; }
        .file-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 14px; }
        .file-card { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 12px 14px; }
        .fc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
        .fc-name { font-size: 12px; font-weight: 600; color: #2c4a8a; font-family: 'IBM Plex Mono', monospace; }
        .fc-del { background: none; border: none; color: #bbb; cursor: pointer; font-size: 12px; padding: 0 2px; line-height: 1; }
        .fc-del:hover { color: #8a2c2c; }
        .fc-meta { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; margin-bottom: 6px; }
        .fc-cols { display: flex; flex-wrap: wrap; gap: 4px; }
        .fc-col-tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-family: 'IBM Plex Mono', monospace; }
        .fc-col-tag.num { background: rgba(44,74,138,0.08); color: #2c4a8a; border: 1px solid rgba(44,74,138,0.2); }
        .fc-col-tag.str { background: #f0ece3; color: #8a8078; border: 1px solid #ddd8cc; }
        .fc-missing { font-size: 11px; color: #8a2c2c; margin-top: 6px; font-family: 'IBM Plex Mono', monospace; }
        .field-mapper { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; }
        .fm-hint { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; margin-bottom: 12px; }
        .fm-file { margin-bottom: 16px; }
        .fm-file:last-child { margin-bottom: 0; }
        .fm-fname { font-size: 11px; font-weight: 600; color: #2c4a8a; font-family: 'IBM Plex Mono', monospace; margin-bottom: 8px; }
        .fm-cols { display: flex; flex-wrap: wrap; gap: 8px; }
        .fm-row { display: flex; align-items: center; gap: 6px; }
        .fm-orig { font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; min-width: 80px; }
        .fm-arrow { font-size: 11px; color: #bbb; }
        .fm-input { font-size: 11px; font-family: 'IBM Plex Mono', monospace; border: 1px solid #ddd8cc; border-radius: 4px; padding: 3px 8px; background: #f7f5f0; outline: none; width: 100px; }
        .fm-input:focus { border-color: #2c4a8a; background: white; }
        .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
        @media (max-width: 600px) { .config-grid { grid-template-columns: 1fr; } }
        .cfg-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #8a8078; display: block; margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; }
        .cfg-hint { font-size: 10px; color: #bbb; font-weight: 400; letter-spacing: 0; text-transform: none; }
        .check-btn { margin-top: 10px; font-size: 11px; padding: 4px 12px; border: 1px solid #2c4a8a; border-radius: 4px; cursor: pointer; background: white; color: #2c4a8a; font-family: 'IBM Plex Mono', monospace; display: block; }
        .check-btn:hover { background: rgba(44,74,138,0.06); }
        .check-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .merge-check { margin-top: 10px; display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px; }
        .mc-type { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700; color: white; padding: 2px 10px; border-radius: 4px; }
        .mc-warn { font-size: 11px; color: #8a2c2c; font-family: 'IBM Plex Mono', monospace; background: rgba(138,44,44,0.06); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(138,44,44,0.2); }
        .mc-ok { font-size: 11px; color: #2a7a2a; font-family: 'IBM Plex Mono', monospace; }
        .mc-details { width: 100%; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
        .mc-detail { font-size: 11px; font-family: 'IBM Plex Mono', monospace; padding: 2px 8px; border-radius: 4px; }
        .mc-detail.ok { background: rgba(42,122,42,0.08); color: #2a7a2a; border: 1px solid rgba(42,122,42,0.2); }
        .mc-detail.warn { background: rgba(138,44,44,0.06); color: #8a2c2c; border: 1px solid rgba(138,44,44,0.2); }
        .radio-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .radio-btn { font-size: 11px; padding: 4px 10px; border: 1px solid #ddd8cc; border-radius: 4px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; transition: all 0.15s; user-select: none; }
        .radio-btn.sel { background: #2c4a8a; color: white; border-color: #2c4a8a; }
        .radio-btn:hover:not(.sel) { border-color: #2c4a8a; color: #2c4a8a; }
        .threshold-input { margin-top: 8px; width: 160px; background: #f7f5f0; border: 1px solid #ddd8cc; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; outline: none; }
        .tag-sel { display: flex; flex-wrap: wrap; gap: 6px; }
        .vtag { background: #f0ece3; border: 1px solid #ddd8cc; border-radius: 4px; padding: 3px 10px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; cursor: pointer; transition: all 0.15s; user-select: none; }
        .vtag:hover { border-color: #2c4a8a; color: #2c4a8a; }
        .vtag.sel { background: #2c4a8a; color: white; border-color: #2c4a8a; }
        .dt-badge { display: inline-block; font-size: 9px; padding: 0 4px; border-radius: 2px; margin-left: 4px; font-weight: 700; letter-spacing: 0; font-family: 'IBM Plex Mono', monospace; vertical-align: middle; line-height: 14px; }
        .dt-num   { background: rgba(44,74,138,0.12); color: #2c4a8a; }
        .dt-int   { background: rgba(42,122,42,0.12); color: #2a7a2a; }
        .dt-date  { background: rgba(200,100,0,0.15); color: #c86400; }
        .dt-str   { background: rgba(130,130,130,0.12); color: #888; }
        .dt-bool  { background: rgba(138,44,138,0.12); color: #8a2c8a; }
        .dt-other { background: #f0ece3; color: #8a8078; }
        .vtag.sel .dt-badge { opacity: 0.8; background: rgba(255,255,255,0.25); color: white; }
        .panel-tip { margin-top: 6px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; padding: 6px 10px; border-radius: 4px; line-height: 1.6; }
        .panel-tip.warn { background: rgba(200,100,0,0.07); border: 1px solid rgba(200,100,0,0.25); color: #c86400; }
        .run-btn { background: #2c4a8a; color: white; border: none; border-radius: 6px; padding: 10px 24px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; transition: all 0.15s; }
        .run-btn:hover { background: #1e3a6e; }
        .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .clean-report { background: rgba(44,74,138,0.04); border: 1px solid rgba(44,74,138,0.2); border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
        .cr-title { font-weight: 600; color: #2c4a8a; margin-bottom: 8px; font-size: 13px; }
        .cr-stats { display: flex; gap: 20px; flex-wrap: wrap; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #3a3530; margin-bottom: 8px; }
        .cr-step { font-size: 12px; color: #5a5a5a; font-family: 'IBM Plex Mono', monospace; line-height: 1.8; }
        .preview-block { margin-bottom: 24px; background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; overflow: hidden; }
        .prev-title { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; color: #8a8078; padding: 10px 16px; border-bottom: 1px solid #ddd8cc; background: #f0ece3; letter-spacing: 1px; text-transform: uppercase; }
        .prev-scroll { overflow-x: auto; }
        .prev-table { width: 100%; border-collapse: collapse; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
        .prev-table th { background: #f7f5f0; padding: 6px 12px; text-align: left; font-weight: 600; color: #3a3530; border-bottom: 1px solid #ddd8cc; white-space: nowrap; }
        .prev-table td { padding: 5px 12px; border-bottom: 1px solid #f0ece3; color: #5a5a5a; white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
        .prev-table tr:last-child td { border-bottom: none; }
        .prev-table tr:hover td { background: rgba(44,74,138,0.03); }
        .divider { border: none; border-top: 2px solid #ddd8cc; margin: 36px 0; }
        .analysis-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        @media (max-width: 700px) { .analysis-grid { grid-template-columns: 1fr 1fr; } }
        .acard { background: #fffef9; border: 1.5px solid #ddd8cc; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: all 0.15s; position: relative; user-select: none; }
        .acard:hover { border-color: #2c4a8a; }
        .acard.active { border-color: #2c4a8a; background: rgba(44,74,138,0.04); }
        .acard.active::after { content: '✓'; position: absolute; top: 10px; right: 12px; color: #2c4a8a; font-weight: 700; }
        .ci { font-size: 20px; margin-bottom: 6px; }
        .ct { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
        .cd { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; line-height: 1.5; }
        .var-box { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; }
        .var-row { margin-bottom: 14px; }
        .vl { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #8a8078; display: block; margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; }
        .vh { font-size: 10px; color: #bbb; font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 6px; }
        .interp-row { margin-bottom: 14px; }
        .custom-q { width: 100%; margin-top: 10px; border: 1px solid #ddd8cc; border-radius: 6px; padding: 10px 14px; font-size: 13px; font-family: 'IBM Plex Sans', sans-serif; background: #fffef9; outline: none; resize: none; min-height: 64px; }
        .result-area { margin-top: 8px; }
        .result-paper { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
        .result-header { background: #1a1a1a; color: white; padding: 14px 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .rbadge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 2px; background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 3px; }
        .rtitle { font-family: 'Playfair Display', serif; font-size: 15px; flex: 1; }
        .export-btns { display: flex; gap: 8px; flex-wrap: wrap; }
        .export-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 5px; padding: 5px 12px; font-size: 11px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; white-space: nowrap; }
        .export-btn:hover { background: rgba(255,255,255,0.2); }
        .result-body { padding: 32px; }
        .result-footer { padding: 10px 32px; border-top: 1px solid #ddd8cc; background: #f0ece3; font-size: 11px; color: #8a8078; font-style: italic; font-family: 'Playfair Display', serif; }
        .err-box { color: #8a2c2c; font-family: 'IBM Plex Mono', monospace; font-size: 12px; margin-bottom: 8px; }
        .dropped-warn { background: rgba(138,100,0,0.06); border: 1px solid rgba(138,100,0,0.2); border-radius: 4px; padding: 8px 12px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: #7a5a00; margin-bottom: 12px; }
        .result-block { margin-bottom: 40px; }
        .result-block + .result-block { padding-top: 32px; border-top: 2px solid #ddd8cc; }
        .tbl-title { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 600; text-align: center; margin-bottom: 12px; }
        .tbl-note { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #8a8078; margin-top: 8px; }
        .tbl-scroll { overflow-x: auto; }
        .acad-table { width: 100%; border-collapse: collapse; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
        .acad-table thead tr { border-top: 2px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; }
        .acad-table tbody tr:last-child { border-bottom: 2px solid #1a1a1a; }
        .acad-table th { padding: 6px 10px; font-weight: 600; text-align: right; font-size: 11px; }
        .acad-table td { padding: 5px 10px; text-align: right; }
        .col-var { text-align: left !important; min-width: 120px; }
        .col-corr { text-align: center; min-width: 64px; }
        .col-reg { text-align: center; min-width: 90px; }
        .corr-tbl { min-width: 500px; }
        .sig { font-style: normal; font-size: 10px; }
        .tval { font-size: 11px; color: #5a5a5a; }
        .depvar { font-size: 10px; font-weight: 400; color: #8a8078; display: block; }
        .fe-row td { font-size: 11px; color: #5a5a5a; border-top: 1px solid #ddd8cc; }
        .fe-row:first-of-type td { border-top: 2px solid #ddd8cc; }
        .stat-row td { font-size: 11px; font-weight: 500; }
        .stat-row:first-of-type td { border-top: 1px solid #ddd8cc; }
        .hausman-box { background: rgba(44,74,138,0.04); border: 1px solid rgba(44,74,138,0.2); border-radius: 6px; padding: 10px 14px; margin-top: 12px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; color: #3a3530; line-height: 1.8; }
        .interp-result { margin-top: 32px; padding-top: 24px; border-top: 2px solid #ddd8cc; }
        .ir-title { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 600; margin-bottom: 12px; }
        .ir-text { font-size: 14px; line-height: 1.9; color: #3a3530; }
      `}</style>
    </>
  );
}