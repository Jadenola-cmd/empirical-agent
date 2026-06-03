import { useState, useRef } from "react";
import Head from "next/head";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

// ─────────────────────────────────────────
// Table renderers
// ─────────────────────────────────────────
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
      <div className="tbl-title">
        {label || (isPanel ? (data.type === "fe" ? "固定效应回归" : "随机效应回归") : "OLS 回归结果")}
      </div>
      {data.dropped_vars?.length > 0 && (
        <div className="omit-notice">
          ⚠️ 以下变量因完全共线性被自动省略（omitted）：{data.dropped_vars.join(", ")}
        </div>
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

function TagSelector({ options, selected, onChange, single }) {
  return (
    <div className="tag-sel">
      {options.map(opt => (
        <span
          key={opt}
          className={`vtag ${selected.includes(opt) ? "sel" : ""}`}
          onClick={() => {
            if (single) {
              onChange(selected.includes(opt) ? [] : [opt]);
            } else {
              onChange(selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt]);
            }
          }}
        >{opt}</span>
      ))}
    </div>
  );
}

// 列类型标签
function DtypeBadge({ dtype }) {
  const isNum = dtype?.includes("int") || dtype?.includes("float");
  return (
    <span className={`dtype-badge ${isNum ? "num" : "str"}`}>
      {isNum ? "数值" : "文本"}
    </span>
  );
}

// ─────────────────────────────────────────
// Main
// ─────────────────────────────────────────
export default function Home() {
  // Layer 1 state
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [mergeStrategy, setMergeStrategy] = useState("inner");
  const [mergeKeys, setMergeKeys] = useState([]);
  const [missingStrategy, setMissingStrategy] = useState("drop");
  const [outlierStrategy, setOutlierStrategy] = useState("none");
  const [outlierThreshold, setOutlierThreshold] = useState(3.0);
  const [dropCols, setDropCols] = useState([]);
  const [logCols, setLogCols] = useState([]);   // ← NEW: 对数变换
  const [cleanedData, setCleanedData] = useState(null);
  const [cleanReport, setCleanReport] = useState(null);
  const [layer1Loading, setLayer1Loading] = useState(false);

  // Layer 2 state
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
  const [layer2Loading, setLayer2Loading] = useState(false);
  const [interpret, setInterpret] = useState(false);
  const [customQ, setCustomQ] = useState("");

  const fileRef = useRef();

  // ── Upload ──
  async function handleUpload(newFiles) {
    if (!newFiles.length) return;
    const combined = [...uploadedFiles, ...Array.from(newFiles)].slice(0, 5);
    setUploadedFiles(combined);
    const form = new FormData();
    combined.forEach(f => form.append("files", f));
    setLayer1Loading(true);
    try {
      const res = await fetch(`${API_URL}/api/clean/upload`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "上传失败");
      setFilePreviews(json.files);
    } catch (e) {
      alert("上传失败：" + e.message);
    }
    setLayer1Loading(false);
  }

  // ── 删除单个文件 ── NEW
  function handleRemoveFile(index) {
    const newFiles = uploadedFiles.filter((_, i) => i !== index);
    const newPreviews = filePreviews.filter((_, i) => i !== index);
    setUploadedFiles(newFiles);
    setFilePreviews(newPreviews);
    // 重置清洗结果
    setCleanedData(null);
    setCleanReport(null);
    // 清理对应的mergeKey/logCols中已不存在的列
    const remainingCols = newPreviews.flatMap(f => f.columns);
    setMergeKeys(prev => prev.filter(k => remainingCols.includes(k)));
    setLogCols(prev => prev.filter(k => remainingCols.includes(k)));
    setDropCols(prev => prev.filter(k => remainingCols.includes(k)));
  }

  // ── Merge & Clean ──
  async function handleClean() {
    if (!uploadedFiles.length) return;
    setLayer1Loading(true);
    setCleanedData(null);
    setCleanReport(null);

    const form = new FormData();
    uploadedFiles.forEach(f => form.append("files", f));
    form.append("merge_config", JSON.stringify({
      strategy: mergeStrategy,
      keys: mergeKeys,
      files_order: uploadedFiles.map(f => f.name),
    }));
    form.append("clean_config", JSON.stringify({
      missing: missingStrategy,
      outlier: outlierStrategy,
      outlier_threshold: outlierThreshold,
      drop_cols: dropCols,
      log_cols: logCols,   // ← NEW
    }));

    try {
      const res = await fetch(`${API_URL}/api/clean/merge-and-clean`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "清洗失败");
      setCleanedData({ data: json.data, columns: json.columns, dtypes: json.dtypes });
      setCleanReport(json.report);
    } catch (e) {
      alert("清洗失败：" + e.message);
    }
    setLayer1Loading(false);
  }

  // ── Analyze ──
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
    } catch (e) {
      alert("分析失败：" + e.message);
    }
    setLayer2Loading(false);
  }

  const allCols = filePreviews.flatMap(f => f.columns);
  const uniqueCols = [...new Set(allCols)];
  // 只对数值类型列提供对数变换
  const numericColsForLog = filePreviews.length > 0
    ? [...new Set(filePreviews.flatMap(f =>
        Object.entries(f.dtypes || {})
          .filter(([, dt]) => dt.includes("int") || dt.includes("float"))
          .map(([col]) => col)
      ))]
    : [];

  const cleanedCols = cleanedData?.columns || [];
  const needsPanel = analysisTypes.some(t => ["panel_fe", "panel_re"].includes(t));
  const needsReg = analysisTypes.some(t => ["ols", "panel_fe", "panel_re"].includes(t));

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

        {/* ═══ LAYER 1 ═══ */}
        <div className="layer-badge">第一层：数据清洗</div>

        {/* 1.1 Upload */}
        <div className="section">
          <div className="sh"><span className="sn">01</span><span className="st">上传数据文件</span><span className="shint">最多5个</span></div>
          <div
            className="upload-zone"
            onClick={() => fileRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); handleUpload(e.dataTransfer.files); }}
          >
            <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls,.dta" multiple style={{ display: "none" }}
              onChange={e => handleUpload(e.target.files)} />
            <div className="uicon">📂</div>
            <h3>上传数据文件</h3>
            <p>支持 .csv / .xlsx / .xls / .dta · 可多选 · 拖拽上传</p>
          </div>

          {filePreviews.length > 0 && (
            <div className="file-cards">
              {filePreviews.map((f, i) => (
                <div key={i} className="file-card">
                  {/* ← DELETE BUTTON */}
                  <button
                    className="fc-delete"
                    title="删除此文件"
                    onClick={(e) => { e.stopPropagation(); handleRemoveFile(i); }}
                  >✕</button>
                  <div className="fc-name">📄 {f.filename}</div>
                  <div className="fc-meta">{f.rows.toLocaleString()} 行 × {f.cols} 列</div>
                  {/* 列名 + 类型 */}
                  <div className="fc-cols-wrap">
                    {f.columns.map(col => (
                      <span key={col} className="fc-col-tag">
                        {col}
                        <DtypeBadge dtype={f.dtypes?.[col]} />
                      </span>
                    ))}
                  </div>
                  {Object.entries(f.missing).some(([, v]) => v > 0) && (
                    <div className="fc-missing">
                      缺失：{Object.entries(f.missing).filter(([, v]) => v > 0).map(([k, v]) => `${k}(${v})`).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 1.2 Merge config */}
        {filePreviews.length > 1 && (
          <div className="section">
            <div className="sh"><span className="sn">02</span><span className="st">合并配置</span></div>
            <div className="config-grid">
              <div className="config-item">
                <label className="cfg-label">合并方式</label>
                <div className="radio-group">
                  {[["inner","取交集(inner)"],["left","左连接(left)"],["outer","取并集(outer)"],["concat","纵向堆叠"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${mergeStrategy === v ? "sel" : ""}`} onClick={() => setMergeStrategy(v)}>{l}</label>
                  ))}
                </div>
              </div>
              {mergeStrategy !== "concat" && (
                <div className="config-item">
                  <label className="cfg-label">合并键（面板数据选 entity + time）</label>
                  <TagSelector options={uniqueCols} selected={mergeKeys} onChange={setMergeKeys} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 1.3 Clean config */}
        {filePreviews.length > 0 && (
          <div className="section">
            <div className="sh">
              <span className="sn">{filePreviews.length > 1 ? "03" : "02"}</span>
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
                  {[["none","不处理"],["zscore","Z-score法"],["iqr","IQR法"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${outlierStrategy === v ? "sel" : ""}`} onClick={() => setOutlierStrategy(v)}>{l}</label>
                  ))}
                </div>
                {outlierStrategy !== "none" && (
                  <input className="threshold-input" type="number" value={outlierThreshold} step="0.5" min="1"
                    onChange={e => setOutlierThreshold(parseFloat(e.target.value))}
                    placeholder={outlierStrategy === "zscore" ? "σ倍数（默认3）" : "IQR倍数（默认1.5）"} />
                )}
              </div>

              {/* ← 对数变换 NEW */}
              {numericColsForLog.length > 0 && (
                <div className="config-item" style={{ gridColumn: "1 / -1" }}>
                  <label className="cfg-label">
                    对数变换 <span className="cfg-hint">生成 ln_变量名 新列，含0或负值自动用 ln(1+x)</span>
                  </label>
                  <TagSelector options={numericColsForLog} selected={logCols} onChange={setLogCols} />
                </div>
              )}

              {uniqueCols.length > 0 && (
                <div className="config-item" style={{ gridColumn: "1 / -1" }}>
                  <label className="cfg-label">删除列（可选）</label>
                  <TagSelector options={uniqueCols} selected={dropCols} onChange={setDropCols} />
                </div>
              )}
            </div>

            <button className="run-btn" onClick={handleClean} disabled={layer1Loading}>
              {layer1Loading ? "处理中…" : "执行清洗 →"}
            </button>
          </div>
        )}

        {/* 1.4 Clean report */}
        {cleanReport && (
          <div className="clean-report">
            <div className="cr-title">✅ 清洗完成</div>
            <div className="cr-stats">
              <span>{cleanReport.rows_before?.toLocaleString()} 行 → {cleanReport.rows_after?.toLocaleString()} 行</span>
              <span>处理缺失值 {cleanReport.missing_handled} 个</span>
              <span>移除异常值 {cleanReport.outliers_removed} 行</span>
              {cleanReport.log_cols_added?.length > 0 && (
                <span>新增对数列 {cleanReport.log_cols_added.join(", ")}</span>
              )}
            </div>
            {cleanReport.steps?.map((s, i) => (
              <div key={i} className="cr-step">• {s.step}：{s.detail}</div>
            ))}

            {/* 清洗后列预览 */}
            {cleanedData?.columns && (
              <div className="cr-cols-preview">
                <div className="cr-cols-title">清洗后字段（{cleanedData.columns.length} 列）</div>
                <div className="cr-cols-list">
                  {cleanedData.columns.map(col => (
                    <span key={col} className="fc-col-tag">
                      {col}
                      <DtypeBadge dtype={cleanedData.dtypes?.[col]} />
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* ═══ LAYER 2 ═══ */}
        {cleanedData && (
          <>
            <hr className="divider" />
            <div className="layer-badge">第二层：实证分析</div>

            {/* 2.1 Analysis type */}
            <div className="section">
              <div className="sh"><span className="sn">01</span><span className="st">选择分析方法</span><span className="shint">可多选</span></div>
              <div className="analysis-grid">
                {[
                  { type: "descriptive", icon: "📊", title: "描述性统计", desc: "均值/SD/分布 · 对齐 Stata summarize" },
                  { type: "correlation", icon: "🔗", title: "相关系数矩阵", desc: "Pearson + 显著性 · 对齐 Stata pwcorr" },
                  { type: "ols",         icon: "📈", title: "OLS 回归", desc: "普通最小二乘 · 稳健/聚类SE · 对齐 Stata regress" },
                  { type: "panel_fe",    icon: "🏛️", title: "固定效应", desc: "entity FE · Hausman检验 · 对齐 Stata xtreg, fe" },
                  { type: "panel_re",    icon: "🎲", title: "随机效应", desc: "GLS估计 · 对齐 Stata xtreg, re" },
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

            {/* 2.2 Variable selection */}
            <div className="section">
              <div className="sh"><span className="sn">02</span><span className="st">变量配置</span></div>
              <div className="var-box">
                <div className="var-row">
                  <span className="vl">参与分析的变量 <span className="vh">不选=全部</span></span>
                  <TagSelector options={cleanedCols} selected={selectedVars} onChange={setSelectedVars} />
                </div>

                {needsReg && (
                  <>
                    <div className="var-row">
                      <span className="vl">被解释变量 Y</span>
                      <TagSelector options={cleanedCols} selected={depVar ? [depVar] : []} onChange={v => setDepVar(v[0] || "")} single />
                    </div>
                    <div className="var-row">
                      <span className="vl">解释变量 X</span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar)} selected={indepVars} onChange={setIndepVars} />
                    </div>
                    <div className="var-row">
                      <span className="vl">控制变量 <span className="vh">可不选</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && !indepVars.includes(c))} selected={controlVars} onChange={setControlVars} />
                    </div>
                  </>
                )}

                {needsPanel && (
                  <>
                    <div className="var-row">
                      <span className="vl">个体变量 <span className="vh">如 firm_id</span></span>
                      <TagSelector options={cleanedCols} selected={entityVar ? [entityVar] : []} onChange={v => setEntityVar(v[0] || "")} single />
                    </div>
                    <div className="var-row">
                      <span className="vl">时间变量 <span className="vh">如 year</span></span>
                      <TagSelector options={cleanedCols} selected={timeVar ? [timeVar] : []} onChange={v => setTimeVar(v[0] || "")} single />
                    </div>
                  </>
                )}

                {needsReg && (
                  <div className="var-row">
                    <span className="vl">标准误</span>
                    <div className="radio-group">
                      {[["conventional","常规SE"],["robust","稳健SE(HC1)"],["cluster","聚类SE"]].map(([v, l]) => (
                        <label key={v} className={`radio-btn ${
                          (v === "conventional" && !robustSE && !clusterVar) ||
                          (v === "robust" && robustSE && !clusterVar) ||
                          (v === "cluster" && clusterVar) ? "sel" : ""
                        }`}
                          onClick={() => {
                            if (v === "conventional") { setRobustSE(false); setClusterVar(""); }
                            else if (v === "robust") { setRobustSE(true); setClusterVar(""); }
                            else { setRobustSE(false); }
                          }}>{l}</label>
                      ))}
                    </div>
                    {!robustSE && (
                      <div style={{ marginTop: 8 }}>
                        <span className="vl">聚类变量</span>
                        <TagSelector options={cleanedCols} selected={clusterVar ? [clusterVar] : []} onChange={v => setClusterVar(v[0] || "")} single />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 2.3 AI interpret */}
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

            {/* Results */}
            {analyzeResults && (
              <div className="result-area">
                <div className="sh"><span className="sn">OUT</span><span className="st">分析结果</span></div>
                <div className="result-paper">
                  <div className="result-header">
                    <span className="rbadge">{analysisTypes.join(" + ").toUpperCase()}</span>
                    <span className="rtitle">实证分析报告</span>
                    <button className="export-btn" onClick={() => {
                      const el = document.getElementById("result-content");
                      if (!el) return;
                      const blob = new Blob([el.innerText], { type: "text/plain" });
                      const a = document.createElement("a");
                      a.href = URL.createObjectURL(blob);
                      a.download = `实证分析_${new Date().toISOString().slice(0,10)}.txt`;
                      a.click();
                    }}>导出 TXT</button>
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
        .sh { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .sn { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #2c4a8a; font-weight: 500; background: rgba(44,74,138,0.08); border: 1px solid rgba(44,74,138,0.2); padding: 2px 8px; border-radius: 3px; letter-spacing: 1px; }
        .st { font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #3a3530; }
        .shint { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; background: #f0ece3; border: 1px solid #ddd8cc; padding: 2px 8px; border-radius: 10px; }
        .upload-zone { border: 2px dashed #ddd8cc; border-radius: 8px; padding: 40px 24px; text-align: center; cursor: pointer; background: #fffef9; transition: all 0.2s; }
        .upload-zone:hover { border-color: #2c4a8a; }
        .uicon { font-size: 28px; margin-bottom: 10px; }
        .upload-zone h3 { font-family: 'Playfair Display', serif; font-size: 15px; margin-bottom: 4px; }
        .upload-zone p { font-size: 12px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; }
        .file-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 14px; }
        .file-card { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 12px 14px; position: relative; }
        /* ── 删除按钮 ── */
        .fc-delete { position: absolute; top: 8px; right: 8px; background: none; border: none; cursor: pointer; font-size: 13px; color: #bbb; line-height: 1; padding: 2px 5px; border-radius: 4px; transition: all 0.15s; }
        .fc-delete:hover { background: #fde8e8; color: #c0392b; }
        .fc-name { font-size: 12px; font-weight: 600; color: #2c4a8a; margin-bottom: 4px; font-family: 'IBM Plex Mono', monospace; padding-right: 20px; }
        .fc-meta { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; margin-bottom: 6px; }
        /* ── 列名+类型 ── */
        .fc-cols-wrap { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 4px; }
        .fc-col-tag { display: inline-flex; align-items: center; gap: 3px; background: #f0ece3; border: 1px solid #ddd8cc; border-radius: 4px; padding: 2px 6px; font-size: 10px; font-family: 'IBM Plex Mono', monospace; }
        .dtype-badge { font-size: 9px; padding: 1px 4px; border-radius: 3px; font-weight: 600; }
        .dtype-badge.num { background: rgba(44,74,138,0.12); color: #2c4a8a; }
        .dtype-badge.str { background: rgba(138,80,44,0.10); color: #8a502c; }
        .fc-missing { font-size: 11px; color: #8a2c2c; margin-top: 4px; font-family: 'IBM Plex Mono', monospace; }
        .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
        @media (max-width: 600px) { .config-grid { grid-template-columns: 1fr; } }
        .config-item { }
        .cfg-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #8a8078; display: block; margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; }
        .cfg-hint { font-size: 10px; color: #bbb; font-weight: 400; text-transform: none; letter-spacing: 0; margin-left: 6px; }
        .radio-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .radio-btn { font-size: 11px; padding: 4px 10px; border: 1px solid #ddd8cc; border-radius: 4px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; transition: all 0.15s; user-select: none; }
        .radio-btn.sel { background: #2c4a8a; color: white; border-color: #2c4a8a; }
        .radio-btn:hover:not(.sel) { border-color: #2c4a8a; color: #2c4a8a; }
        .threshold-input { margin-top: 8px; width: 160px; background: #f7f5f0; border: 1px solid #ddd8cc; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; outline: none; }
        .tag-sel { display: flex; flex-wrap: wrap; gap: 6px; }
        .vtag { background: #f0ece3; border: 1px solid #ddd8cc; border-radius: 4px; padding: 3px 10px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; cursor: pointer; transition: all 0.15s; user-select: none; }
        .vtag:hover { border-color: #2c4a8a; color: #2c4a8a; }
        .vtag.sel { background: #2c4a8a; color: white; border-color: #2c4a8a; }
        .run-btn { background: #2c4a8a; color: white; border: none; border-radius: 6px; padding: 10px 24px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; transition: all 0.15s; }
        .run-btn:hover { background: #1e3a6e; }
        .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .clean-report { background: rgba(44,74,138,0.04); border: 1px solid rgba(44,74,138,0.2); border-radius: 8px; padding: 16px 20px; margin-bottom: 24px; }
        .cr-title { font-weight: 600; color: #2c4a8a; margin-bottom: 8px; font-size: 13px; }
        .cr-stats { display: flex; gap: 20px; flex-wrap: wrap; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #3a3530; margin-bottom: 8px; }
        .cr-step { font-size: 12px; color: #5a5a5a; font-family: 'IBM Plex Mono', monospace; line-height: 1.8; }
        .cr-cols-preview { margin-top: 12px; padding-top: 12px; border-top: 1px solid rgba(44,74,138,0.15); }
        .cr-cols-title { font-size: 11px; font-weight: 700; color: #8a8078; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 8px; }
        .cr-cols-list { display: flex; flex-wrap: wrap; gap: 4px; }
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
        .result-header { background: #1a1a1a; color: white; padding: 14px 20px; display: flex; align-items: center; gap: 12px; }
        .rbadge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 2px; background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 3px; }
        .rtitle { font-family: 'Playfair Display', serif; font-size: 15px; flex: 1; }
        .export-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 5px; padding: 5px 12px; font-size: 11px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; }
        .result-body { padding: 32px; }
        .result-footer { padding: 10px 32px; border-top: 1px solid #ddd8cc; background: #f0ece3; font-size: 11px; color: #8a8078; font-style: italic; font-family: 'Playfair Display', serif; }
        .err-box { color: #8a2c2c; font-family: 'IBM Plex Mono', monospace; font-size: 12px; margin-bottom: 8px; }
        .omit-notice { background: #fff8e6; border: 1px solid #f0cc6e; border-radius: 5px; padding: 8px 12px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; color: #7a5a00; margin-bottom: 12px; }
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
