import { useState, useRef } from "react";
import Head from "next/head";

// ── Significance helper ──
function sigStars(sig) {
  return sig || "";
}

// ── Table renderers (fixed templates) ──
function DescriptiveTable({ data }) {
  if (!data?.descriptive?.vars?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">表 1：总样本描述性统计</div>
      <table className="acad-table">
        <thead>
          <tr>
            <th className="col-varname">VarName</th>
            <th className="col-num">Obs</th>
            <th className="col-num">Mean</th>
            <th className="col-num">SD</th>
            <th className="col-num">Min</th>
            <th className="col-num">Median</th>
            <th className="col-num">Max</th>
          </tr>
        </thead>
        <tbody>
          {data.descriptive.vars.map((v, i) => (
            <tr key={i}>
              <td className="col-varname">{v.name}</td>
              <td className="col-num">{Number(v.obs).toLocaleString()}</td>
              <td className="col-num">{Number(v.mean).toFixed(3)}</td>
              <td className="col-num">{Number(v.sd).toFixed(3)}</td>
              <td className="col-num">{Number(v.min).toFixed(3)}</td>
              <td className="col-num">{Number(v.median).toFixed(3)}</td>
              <td className="col-num">{Number(v.max).toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.correlation && <CorrelationTable data={data} />}
      <div className="tbl-note">{data.notes}</div>
      {data.interpretation && <div className="tbl-interp">{data.interpretation}</div>}
    </div>
  );
}

function CorrelationTable({ data }) {
  const vars = data.correlation?.vars || [];
  const matrix = data.correlation?.matrix || [];
  if (!vars.length) return null;
  return (
    <div style={{ marginTop: 32 }}>
      <div className="tbl-title">表 2：相关系数矩阵</div>
      <div className="corr-scroll">
        <table className="acad-table corr-table">
          <thead>
            <tr>
              <th className="col-varname"></th>
              {vars.map((v, i) => <th key={i} className="col-corr">{`(${i + 1})`}</th>)}
            </tr>
          </thead>
          <tbody>
            {vars.map((v, i) => (
              <tr key={i}>
                <td className="col-varname">{v}</td>
                {(matrix[i] || []).map((cell, j) => (
                  <td key={j} className="col-corr">
                    {i === j ? "1" : (
                      <>
                        {Number(cell.coef).toFixed(3)}
                        <sup className="sig-star">{cell.sig}</sup>
                      </>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RegressionTable({ data }) {
  if (!data?.models?.length) return null;
  const models = data.models;
  // Collect all variable names in order
  const allVars = [];
  models.forEach(m => {
    (m.coefficients || []).forEach(c => {
      if (!allVars.find(v => v.var === c.var)) allVars.push(c);
    });
  });

  return (
    <div className="result-block">
      <div className="tbl-title">{data.title}</div>
      <table className="acad-table reg-table">
        <thead>
          <tr>
            <th className="col-varname"></th>
            {models.map((m, i) => (
              <th key={i} className="col-reg">{m.name}<br /><span className="depvar-label">{m.depvar}</span></th>
            ))}
          </tr>
        </thead>
        <tbody>
          {allVars.map((vInfo, vi) => (
            <tr key={vi}>
              <td className="col-varname">{vInfo.var}</td>
              {models.map((m, mi) => {
                const c = (m.coefficients || []).find(x => x.var === vInfo.var);
                return (
                  <td key={mi} className="col-reg">
                    {c ? (
                      <>
                        <div>{Number(c.coef).toFixed(3)}<sup className="sig-star">{c.sig}</sup></div>
                        <div className="t-val">({Number(c.t).toFixed(2)})</div>
                      </>
                    ) : ""}
                  </td>
                );
              })}
            </tr>
          ))}
          {/* Constant */}
          <tr>
            <td className="col-varname">_cons</td>
            {models.map((m, mi) => (
              <td key={mi} className="col-reg">
                {m.cons ? (
                  <>
                    <div>{Number(m.cons.coef).toFixed(3)}<sup className="sig-star">{m.cons.sig}</sup></div>
                    <div className="t-val">({Number(m.cons.t).toFixed(2)})</div>
                  </>
                ) : ""}
              </td>
            ))}
          </tr>
          {/* Fixed effects */}
          <tr className="fe-row">
            <td className="col-varname">ind</td>
            {models.map((m, mi) => <td key={mi} className="col-reg">{m.ind_fe || "No"}</td>)}
          </tr>
          <tr className="fe-row">
            <td className="col-varname">year</td>
            {models.map((m, mi) => <td key={mi} className="col-reg">{m.year_fe || "No"}</td>)}
          </tr>
          {/* Stats */}
          <tr className="stat-row">
            <td className="col-varname">N</td>
            {models.map((m, mi) => <td key={mi} className="col-reg">{m.n ? Number(m.n).toLocaleString() : ""}</td>)}
          </tr>
          <tr className="stat-row">
            <td className="col-varname">r2</td>
            {models.map((m, mi) => <td key={mi} className="col-reg">{m.r2 != null ? Number(m.r2).toFixed(3) : ""}</td>)}
          </tr>
          <tr className="stat-row">
            <td className="col-varname">r2_a</td>
            {models.map((m, mi) => <td key={mi} className="col-reg">{m.r2_a != null ? Number(m.r2_a).toFixed(3) : ""}</td>)}
          </tr>
          <tr className="stat-row">
            <td className="col-varname">F</td>
            {models.map((m, mi) => <td key={mi} className="col-reg">{m.f != null ? Number(m.f).toFixed(3) : ""}</td>)}
          </tr>
        </tbody>
      </table>
      <div className="tbl-note">{data.notes}</div>
      {data.interpretation && <div className="tbl-interp">{data.interpretation}</div>}
    </div>
  );
}

function TimeseriesTable({ data }) {
  if (!data?.stationarity?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">{data.title}</div>
      <div className="tbl-subtitle">平稳性检验（ADF）</div>
      <table className="acad-table">
        <thead>
          <tr>
            <th className="col-varname">变量</th>
            <th className="col-num">ADF统计量</th>
            <th className="col-num">P值</th>
            <th className="col-num">结论</th>
          </tr>
        </thead>
        <tbody>
          {data.stationarity.map((v, i) => (
            <tr key={i}>
              <td className="col-varname">{v.var}</td>
              <td className="col-num">{Number(v.adf_stat).toFixed(3)}</td>
              <td className="col-num">{Number(v.p_value).toFixed(3)}</td>
              <td className="col-num">{v.conclusion}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.autocorrelation?.length > 0 && (
        <>
          <div className="tbl-subtitle" style={{marginTop:20}}>自相关检验</div>
          <table className="acad-table">
            <thead>
              <tr>
                <th className="col-num">滞后阶</th>
                <th className="col-num">ACF</th>
                <th className="col-num">PACF</th>
                <th className="col-num">显著性</th>
              </tr>
            </thead>
            <tbody>
              {data.autocorrelation.map((v, i) => (
                <tr key={i}>
                  <td className="col-num">{v.lag}</td>
                  <td className="col-num">{Number(v.acf).toFixed(3)}</td>
                  <td className="col-num">{Number(v.pacf).toFixed(3)}</td>
                  <td className="col-num">{v.sig}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      <div className="tbl-note">建议模型：{data.model_suggestion}</div>
      {data.interpretation && <div className="tbl-interp">{data.interpretation}</div>}
    </div>
  );
}

function MLTable({ data }) {
  if (!data?.feature_importance?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">{data.title}</div>
      <div className="tbl-subtitle">特征重要性排序</div>
      <table className="acad-table">
        <thead>
          <tr>
            <th className="col-num">排名</th>
            <th className="col-varname">变量</th>
            <th className="col-num">重要性得分</th>
          </tr>
        </thead>
        <tbody>
          {data.feature_importance.sort((a,b) => a.rank - b.rank).map((v, i) => (
            <tr key={i}>
              <td className="col-num">{v.rank}</td>
              <td className="col-varname">{v.var}</td>
              <td className="col-num">{Number(v.importance).toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.model_comparison?.length > 0 && (
        <>
          <div className="tbl-subtitle" style={{marginTop:20}}>模型比较</div>
          <table className="acad-table">
            <thead>
              <tr>
                <th className="col-varname">模型</th>
                <th className="col-num">RMSE</th>
                <th className="col-num">R²</th>
                <th className="col-num">推荐</th>
              </tr>
            </thead>
            <tbody>
              {data.model_comparison.map((m, i) => (
                <tr key={i} className={m.recommendation ? "recommend-row" : ""}>
                  <td className="col-varname">{m.model}</td>
                  <td className="col-num">{Number(m.rmse).toFixed(3)}</td>
                  <td className="col-num">{Number(m.r2).toFixed(3)}</td>
                  <td className="col-num">{m.recommendation ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {data.diagnostics && (
        <div className="tbl-note">
          过拟合风险：{data.diagnostics.overfitting_risk} ·
          样本量：{data.diagnostics.sample_size_adequacy} ·
          缺失率：{data.diagnostics.missing_rate}
        </div>
      )}
      {data.interpretation && <div className="tbl-interp">{data.interpretation}</div>}
    </div>
  );
}

function ResultRenderer({ result, analysisType }) {
  if (!result) return null;
  if (result.error) return <div className="result-error">❌ {result.error}</div>;
  const data = result.result;
  if (!data) return <div className="result-error">数据解析失败</div>;

  switch (analysisType) {
    case "descriptive": return <DescriptiveTable data={data} />;
    case "regression": return <RegressionTable data={data} />;
    case "timeseries": return <TimeseriesTable data={data} />;
    case "ml": return <MLTable data={data} />;
    default: return null;
  }
}

// ── Main component ──
export default function Home() {
  const [parsedData, setParsedData] = useState(null);
  const [selectedCols, setSelectedCols] = useState([]);
  const [analysisType, setAnalysisType] = useState(null);
  const [depVar, setDepVar] = useState("");
  const [indepVars, setIndepVars] = useState([]);
  const [controlVars, setControlVars] = useState([]);
  const [customQ, setCustomQ] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [fileError, setFileError] = useState("");
  const fileRef = useRef();

  function parseCSV(text) {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const rows = lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      const obj = {};
      headers.forEach((h, i) => (obj[h] = isNaN(vals[i]) ? vals[i] : Number(vals[i]) || vals[i]));
      return obj;
    });
    return { data: rows, meta: { fields: headers } };
  }

  async function handleFile(file) {
    if (!file) return;
    setFileError("");
    setFileName(file.name);
    const ext = file.name.split(".").pop().toLowerCase();
    const reader = new FileReader();

    if (ext === "xlsx" || ext === "xls") {
      reader.onload = (e) => {
        import("xlsx").then((XLSX) => {
          const wb = XLSX.read(e.target.result, { type: "binary" });
          const ws = wb.Sheets[wb.SheetNames[0]];
          const json = XLSX.utils.sheet_to_json(ws, { defval: "" });
          const fields = Object.keys(json[0] || {});
          setParsedData({ data: json, meta: { fields } });
          setSelectedCols([]);
        });
      };
      reader.readAsBinaryString(file);
    } else if (ext === "csv") {
      reader.onload = (e) => {
        setParsedData(parseCSV(e.target.result));
        setSelectedCols([]);
      };
      reader.readAsText(file);
    } else if (ext === "dta") {
      setFileError("DTA 格式请先在 Stata 中导出为 CSV：File → Export → Data to CSV");
    } else {
      setFileError("请上传 CSV 或 Excel 文件（.csv / .xlsx / .xls）");
    }
  }

  function toggleCol(col) {
    setSelectedCols((prev) => prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]);
  }

  function appendQ(text) {
    setCustomQ((prev) => (prev ? prev + "\n" + text : text));
  }

  async function runAnalysis() {
    if (!parsedData) return alert("请先上传数据文件");
    if (!analysisType) return alert("请选择分析方法");
    setLoading(true);
    setResult(null);

    const { data, meta } = parsedData;
    const cols = selectedCols.length > 0 ? selectedCols : meta.fields;
    const sampleSize = Math.min(50, data.length);
    const sample = data.slice(0, sampleSize);
    const csvStr = [cols.join(","), ...sample.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n");

    let varSpec = "";
    if (analysisType === "regression" && depVar) {
      varSpec = `被解释变量(Y): ${depVar}\n解释变量(X): ${indepVars.join(", ") || "除Y外所有变量"}\n控制变量: ${controlVars.join(", ") || "无"}`;
    }

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dataStr: csvStr, totalRows: data.length, sampleSize, analysisType, varSpec, customQ, fields: meta.fields.length }),
      });
      const json = await res.json();
      setResult(json);
    } catch (err) {
      setResult({ error: err.message });
    }
    setLoading(false);
  }

  function exportResult() {
    const el = document.getElementById("result-content");
    if (!el) return;
    const blob = new Blob([el.innerText], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `实证分析结果_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
  }

  const analysisCards = [
    { type: "descriptive", icon: "📊", title: "描述性统计 & 相关性", desc: "均值/SD/分布 · 相关系数矩阵 · 显著性标志" },
    { type: "regression", icon: "📈", title: "回归分析", desc: "OLS · 系数/t值 · R²/F · 固定效应" },
    { type: "timeseries", icon: "⏱️", title: "时间序列分析", desc: "ADF平稳性 · ACF/PACF · ARIMA建议" },
    { type: "ml", icon: "🤖", title: "机器学习预测", desc: "特征重要性 · 模型比较 · 过拟合诊断" },
  ];

  const fields = parsedData?.meta?.fields || [];

  return (
    <>
      <Head>
        <title>论文实证分析 Agent</title>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        <div className="journal-header">
          <span className="journal-name">Empirical Research Assistant</span>
          <span className="journal-meta">论文实证分析 · Powered by DeepSeek</span>
        </div>
        <div className="title-block">
          <h1>论文<span>实证分析</span> Agent</h1>
          <p className="subtitle">输出标准学术格式 · 数值由程序渲染 · 格式稳定可复现</p>
        </div>

        {/* Step 1 */}
        <div className="section">
          <div className="section-head"><span className="section-num">STEP 01</span><span className="section-title">上传数据</span></div>
          {!parsedData ? (
            <>
              <div className="upload-zone" onClick={() => fileRef.current.click()} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}>
                <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
                <div className="upload-icon">📂</div>
                <h3>上传数据文件</h3>
                <p>支持 .csv / .xlsx / .xls · 点击或拖拽</p>
              </div>
              {fileError && <p className="file-error">{fileError}</p>}
            </>
          ) : (
            <div className="data-meta">
              <div className="meta-row">
                <span className="meta-item">文件 <strong>{fileName}</strong></span>
                <span className="meta-item">观测值 <strong>{parsedData.data.length.toLocaleString()}</strong></span>
                <span className="meta-item">变量数 <strong>{fields.length}</strong></span>
                <button className="reset-btn" onClick={() => { setParsedData(null); setSelectedCols([]); setResult(null); }}>重新上传</button>
              </div>
              <div className="col-label">变量列（点击选择，不选则全部参与分析）</div>
              <div className="col-tags">{fields.map((f) => <span key={f} className={`col-tag ${selectedCols.includes(f) ? "selected" : ""}`} onClick={() => toggleCol(f)}>{f}</span>)}</div>
            </div>
          )}
        </div>

        <hr className="divider" />

        {/* Step 2 */}
        <div className="section">
          <div className="section-head"><span className="section-num">STEP 02</span><span className="section-title">选择分析方法</span></div>
          <div className="analysis-grid">
            {analysisCards.map((card) => (
              <div key={card.type} className={`analysis-card ${analysisType === card.type ? "active" : ""}`} onClick={() => setAnalysisType(card.type)}>
                <div className="card-icon">{card.icon}</div>
                <div className="card-title">{card.title}</div>
                <div className="card-desc">{card.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {analysisType === "regression" && fields.length > 0 && (
          <div className="var-config">
            <div className="var-config-title">VARIABLE SPECIFICATION</div>
            <div className="var-row"><span className="var-label">被解释变量 Y</span>
              <select className="var-select" value={depVar} onChange={(e) => setDepVar(e.target.value)}>
                <option value="">— 选择 —</option>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="var-row"><span className="var-label">解释变量 X</span>
              <select className="var-select" multiple size={4} value={indepVars} onChange={(e) => setIndepVars(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <span className="var-hint">Ctrl 多选</span>
            </div>
            <div className="var-row"><span className="var-label">控制变量</span>
              <select className="var-select" multiple size={3} value={controlVars} onChange={(e) => setControlVars(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        )}

        <hr className="divider" />

        {/* Step 3 */}
        <div className="section">
          <div className="section-head"><span className="section-num">STEP 03</span><span className="section-title">分析指令（可选）</span></div>
          <div className="textarea-wrap">
            <textarea className="custom-input" placeholder="描述研究假设或附加要求…" value={customQ} onChange={(e) => setCustomQ(e.target.value)} />
            <div className="textarea-footer">
              <div className="quick-tags">
                {[["📖 系数解读","请解读系数的经济学含义"],["🔬 诊断检验","请检验异方差和多重共线性"],["🛡️ 稳健性","请给出稳健性检验建议"],["✍️ 论文段落","请用中文写出可直接粘贴到论文的实证结果描述段落"]].map(([tag, text]) => (
                  <span key={tag} className="qtag" onClick={() => appendQ(text)}>{tag}</span>
                ))}
              </div>
              <button className="run-btn" onClick={runAnalysis} disabled={loading}>{loading ? "分析中…" : "运行分析 →"}</button>
            </div>
          </div>
        </div>

        {/* Result */}
        {(loading || result) && (
          <div className="result-area">
            <div className="section-head"><span className="section-num">OUTPUT</span><span className="section-title">分析结果</span></div>
            <div className="result-paper">
              <div className="result-header">
                <div className="result-header-left">
                  <span className="result-badge">{(analysisType || "").toUpperCase()}</span>
                  <span className="result-title-text">实证分析报告</span>
                </div>
                <button className="export-btn-white" onClick={exportResult}>导出 TXT</button>
              </div>
              <div className="result-body" id="result-content">
                {loading ? (
                  <div className="loading-state"><div className="spinner" />正在运行实证分析，请稍候…</div>
                ) : (
                  <ResultRenderer result={result} analysisType={analysisType} />
                )}
              </div>
              <div className="result-footer">
                <span className="result-note">* 基于上传数据样本 · {new Date().toLocaleDateString("zh-CN")} · 数值由程序渲染，格式固定</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f7f5f0; color: #1a1a1a; font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }
        .app { max-width: 1000px; margin: 0 auto; padding: 48px 24px; }
        .journal-header { border-top: 3px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; padding: 14px 0 10px; margin-bottom: 36px; display: flex; justify-content: space-between; align-items: baseline; }
        .journal-name { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; }
        .journal-meta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #8a8078; }
        .title-block { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px solid #ddd8cc; }
        .title-block h1 { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 700; margin-bottom: 8px; }
        .title-block h1 span { color: #2c4a8a; }
        .subtitle { font-family: 'Playfair Display', serif; font-size: 14px; color: #8a8078; font-style: italic; }
        .section { margin-bottom: 24px; }
        .section-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
        .section-num { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #2c4a8a; font-weight: 500; background: rgba(44,74,138,0.08); border: 1px solid rgba(44,74,138,0.2); padding: 2px 8px; border-radius: 3px; letter-spacing: 1px; }
        .section-title { font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #3a3530; }
        .upload-zone { border: 2px dashed #ddd8cc; border-radius: 8px; padding: 40px 24px; text-align: center; cursor: pointer; background: #fffef9; transition: all 0.2s; }
        .upload-zone:hover { border-color: #2c4a8a; }
        .upload-icon { font-size: 28px; margin-bottom: 10px; }
        .upload-zone h3 { font-family: 'Playfair Display', serif; font-size: 15px; margin-bottom: 4px; }
        .upload-zone p { font-size: 12px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; }
        .file-error { margin-top: 10px; color: #8a2c2c; font-size: 13px; background: rgba(138,44,44,0.05); border: 1px solid rgba(138,44,44,0.2); border-radius: 6px; padding: 10px 14px; }
        .data-meta { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; }
        .meta-row { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
        .meta-item { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8a8078; }
        .meta-item strong { color: #2c4a8a; }
        .reset-btn { margin-left: auto; background: none; border: 1px solid #ddd8cc; border-radius: 4px; padding: 4px 10px; font-size: 11px; cursor: pointer; color: #8a8078; font-family: 'IBM Plex Mono', monospace; }
        .reset-btn:hover { border-color: #8a2c2c; color: #8a2c2c; }
        .col-label { font-size: 12px; font-weight: 600; color: #3a3530; margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace; }
        .col-tags { display: flex; flex-wrap: wrap; gap: 6px; }
        .col-tag { background: #f0ece3; border: 1px solid #ddd8cc; border-radius: 4px; padding: 3px 10px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; cursor: pointer; transition: all 0.15s; }
        .col-tag:hover { border-color: #2c4a8a; color: #2c4a8a; }
        .col-tag.selected { background: #2c4a8a; color: white; border-color: #2c4a8a; }
        .divider { border: none; border-top: 1px solid #ddd8cc; margin: 28px 0; }
        .analysis-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
        @media (max-width: 600px) { .analysis-grid { grid-template-columns: 1fr; } }
        .analysis-card { background: #fffef9; border: 1.5px solid #ddd8cc; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: all 0.15s; position: relative; }
        .analysis-card:hover { border-color: #2c4a8a; }
        .analysis-card.active { border-color: #2c4a8a; background: rgba(44,74,138,0.04); }
        .analysis-card.active::after { content: '✓'; position: absolute; top: 10px; right: 12px; color: #2c4a8a; font-weight: 700; }
        .card-icon { font-size: 20px; margin-bottom: 6px; }
        .card-title { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
        .card-desc { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; line-height: 1.5; }
        .var-config { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; margin-top: -16px; margin-bottom: 24px; }
        .var-config-title { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #8a8078; margin-bottom: 14px; font-family: 'IBM Plex Mono', monospace; }
        .var-row { display: flex; align-items: flex-start; gap: 12px; margin-bottom: 12px; flex-wrap: wrap; }
        .var-label { font-size: 12px; font-weight: 600; color: #3a3530; min-width: 90px; font-family: 'IBM Plex Mono', monospace; padding-top: 8px; }
        .var-select { flex: 1; min-width: 160px; background: #f7f5f0; border: 1px solid #ddd8cc; border-radius: 6px; padding: 7px 10px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; color: #1a1a1a; outline: none; }
        .var-select:focus { border-color: #2c4a8a; }
        .var-hint { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; padding-top: 8px; }
        .textarea-wrap { background: #fffef9; border: 1.5px solid #ddd8cc; border-radius: 8px; overflow: hidden; transition: border-color 0.2s; }
        .textarea-wrap:focus-within { border-color: #2c4a8a; }
        .custom-input { width: 100%; border: none; outline: none; background: none; padding: 14px 16px; font-family: 'IBM Plex Sans', sans-serif; font-size: 13px; color: #1a1a1a; resize: none; min-height: 80px; line-height: 1.6; }
        .custom-input::placeholder { color: #8a8078; font-style: italic; }
        .textarea-footer { display: flex; justify-content: space-between; align-items: center; padding: 8px 12px; border-top: 1px solid #ddd8cc; background: #f0ece3; flex-wrap: wrap; gap: 8px; }
        .quick-tags { display: flex; gap: 6px; flex-wrap: wrap; }
        .qtag { font-size: 11px; color: #8a8078; cursor: pointer; padding: 3px 8px; border-radius: 3px; border: 1px solid #ddd8cc; background: #fffef9; font-family: 'IBM Plex Mono', monospace; transition: all 0.15s; }
        .qtag:hover { border-color: #8a2c2c; color: #8a2c2c; }
        .run-btn { background: #2c4a8a; color: white; border: none; border-radius: 6px; padding: 9px 22px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; transition: all 0.15s; }
        .run-btn:hover { background: #1e3a6e; }
        .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .result-area { margin-top: 8px; }
        .result-paper { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
        .result-header { background: #1a1a1a; color: white; padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; }
        .result-header-left { display: flex; align-items: center; gap: 12px; }
        .result-badge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 2px; background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 3px; }
        .result-title-text { font-family: 'Playfair Display', serif; font-size: 15px; }
        .export-btn-white { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 5px; padding: 5px 12px; font-size: 11px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; }
        .export-btn-white:hover { background: rgba(255,255,255,0.2); }
        .result-body { padding: 32px; min-height: 100px; }
        .loading-state { display: flex; align-items: center; gap: 12px; color: #8a8078; font-style: italic; font-family: 'Playfair Display', serif; }
        .spinner { width: 18px; height: 18px; border: 2px solid #ddd8cc; border-top-color: #2c4a8a; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .result-footer { padding: 12px 32px; border-top: 1px solid #ddd8cc; background: #f0ece3; }
        .result-note { font-size: 11px; color: #8a8078; font-style: italic; font-family: 'Playfair Display', serif; }
        .result-error { color: #8a2c2c; font-family: 'IBM Plex Mono', monospace; font-size: 13px; }

        /* Academic table styles */
        .result-block { margin-bottom: 32px; }
        .tbl-title { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 600; text-align: center; margin-bottom: 12px; color: #1a1a1a; }
        .tbl-subtitle { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase; color: #2c4a8a; margin-bottom: 8px; }
        .tbl-note { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #8a8078; margin-top: 8px; }
        .tbl-interp { font-size: 13px; line-height: 1.8; color: #3a3530; margin-top: 16px; padding-top: 16px; border-top: 1px solid #ddd8cc; }
        .acad-table { width: 100%; border-collapse: collapse; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
        .acad-table thead tr { border-top: 2px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; }
        .acad-table tbody tr:last-child { border-bottom: 2px solid #1a1a1a; }
        .acad-table th { padding: 6px 10px; font-weight: 600; text-align: right; color: #1a1a1a; background: none; font-size: 11px; }
        .acad-table td { padding: 5px 10px; text-align: right; color: #1a1a1a; border: none; }
        .col-varname { text-align: left !important; min-width: 100px; }
        .col-num { text-align: right; min-width: 70px; }
        .col-corr { text-align: center; min-width: 60px; }
        .col-reg { text-align: center; min-width: 90px; }
        .corr-scroll { overflow-x: auto; }
        .corr-table { min-width: 500px; }
        .sig-star { color: #1a1a1a; font-style: normal; font-size: 10px; }
        .t-val { font-size: 11px; color: #5a5a5a; }
        .depvar-label { font-size: 10px; font-weight: 400; color: #8a8078; display: block; }
        .fe-row td { font-size: 11px; color: #5a5a5a; border-top: 1px solid #ddd8cc; }
        .fe-row:first-of-type td { border-top: 2px solid #ddd8cc; }
        .stat-row td { font-size: 11px; color: #1a1a1a; font-weight: 500; }
        .recommend-row td { background: rgba(44,74,138,0.04); }
      `}</style>
    </>
  );
}
