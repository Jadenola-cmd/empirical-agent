import { useState, useRef } from "react";
import Head from "next/head";

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
  const fileRef = useRef();

  function parseCSV(text) {
    const lines = text.trim().split("\n");
    const headers = lines[0].split(",").map((h) => h.trim().replace(/"/g, ""));
    const rows = lines.slice(1).map((line) => {
      const vals = line.split(",").map((v) => v.trim().replace(/"/g, ""));
      const obj = {};
      headers.forEach((h, i) => (obj[h] = vals[i] ?? ""));
      return obj;
    });
    return { data: rows, meta: { fields: headers } };
  }

  function handleFile(file) {
    if (!file) return;
    setFileName(file.name);
    const ext = file.name.split(".").pop().toLowerCase();
    if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
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
    } else if (ext === "dta") {
      alert("Stata .dta 文件支持需要在服务器端运行。请先将 .dta 文件转换为 CSV 或 Excel 格式，然后再上传分析。\n\n转换方法（Stata中）：\nexport delimited using \"filename.csv\", replace");
    } else {
      const reader = new FileReader();
      reader.onload = (e) => {
        const parsed = parseCSV(e.target.result);
        setParsedData(parsed);
        setSelectedCols([]);
      };
      reader.readAsText(file);
    }
  }

  function toggleCol(col) {
    setSelectedCols((prev) =>
      prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]
    );
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
    // 限制在最多1000行数据，避免超出API限制
    const sampleSize = Math.min(1000, data.length);
    const sample = data.slice(0, sampleSize);
    const csvStr = [cols.join(","), ...sample.map((r) => cols.map((c) => r[c] ?? "").join(","))].join("\n");

    let varSpec = "";
    if (analysisType === "regression" && depVar) {
      varSpec = `\n被解释变量(Y): ${depVar}\n解释变量(X): ${indepVars.join(", ") || "未指定"}\n控制变量: ${controlVars.join(", ") || "无"}`;
    }

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataStr: csvStr,
          totalRows: data.length,
          sampleSize,
          analysisType,
          varSpec,
          customQ,
          fields: meta.fields.length,
        }),
      });
      const json = await res.json();
      setResult(json.text || json.error || "分析失败");
    } catch (err) {
      setResult("请求失败：" + err.message);
    }
    setLoading(false);
  }

  function copyResult() {
    if (result) navigator.clipboard.writeText(result);
  }

  function exportResult() {
    if (!result) return;
    const blob = new Blob([result], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `实证分析结果_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
  }

  function renderMarkdown(text) {
    let processed = text;
    
    // 先处理换行符
    processed = processed.replace(/<br>/g, '<br/>');
    
    // 简单的表格检测和处理
    const lines = processed.split('\n');
    let result = [];
    let inTable = false;
    let tableLines = [];
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // 检测表格行
      if (line.trim().startsWith('|')) {
        inTable = true;
        tableLines.push(line);
      } else if (inTable) {
        // 表格结束，渲染表格
        result.push(renderTable(tableLines));
        tableLines = [];
        inTable = false;
        result.push(line);
      } else {
        result.push(line);
      }
    }
    
    // 如果最后还有表格内容
    if (inTable && tableLines.length > 0) {
      result.push(renderTable(tableLines));
    }
    
    processed = result.join('\n');
    
    // 处理标题
    processed = processed
      .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
      .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>');
    
    // 处理粗体和斜体
    processed = processed
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>');
    
    // 处理代码
    processed = processed
      .replace(/`(.+?)`/g, '<code>$1</code>');
    
    // 处理段落
    processed = processed
      .replace(/\n\n/g, '<br/><br/>');
    
    return processed;
  }
  
  function renderTable(lines) {
    if (lines.length < 2) return lines.join('\n');
    
    // 分析表格结构
    const headerCells = lines[0].split('|').map(c => c.trim()).filter(c => c !== '');
    const bodyLines = lines.slice(1).filter(line => !line.match(/^\|[-| :]+\|$/));
    const colCount = headerCells.length;
    
    let html = '<table class="md-table">';
    
    // 表头
    html += '<thead><tr>';
    headerCells.forEach((cell, idx) => {
      const align = idx === 0 ? 'left' : 'center';
      html += `<th style="text-align: ${align}">${cell}</th>`;
    });
    html += '</tr></thead>';
    
    // 表体
    html += '<tbody>';
    bodyLines.forEach(line => {
      const cells = line.split('|').map(c => c.trim()).filter(c => c !== '');
      html += '<tr>';
      cells.forEach((cell, idx) => {
        const align = idx === 0 ? 'left' : 'right';
        html += `<td style="text-align: ${align}">${cell}</td>`;
      });
      // 填充缺失的单元格
      for (let i = cells.length; i < colCount; i++) {
        html += '<td></td>';
      }
      html += '</tr>';
    });
    html += '</tbody></table>';
    
    return html;
  }

  const analysisCards = [
    { type: "descriptive", icon: "📊", title: "描述性统计 & 相关性", desc: "均值/方差/分布 · Pearson/Spearman · 热力图解读" },
    { type: "regression", icon: "📈", title: "回归分析", desc: "OLS · 多元回归 · 系数解读 · 显著性 · 诊断检验" },
    { type: "timeseries", icon: "⏱️", title: "时间序列分析", desc: "趋势分解 · 平稳性 · 自相关 · ARIMA 建议" },
    { type: "ml", icon: "🤖", title: "机器学习预测", desc: "特征重要性 · 模型选择建议 · 过拟合诊断 · 评估指标" },
  ];

  const fields = parsedData?.meta?.fields || [];

  return (
    <>
      <Head>
        <title>论文实证分析 Agent</title>
        <meta name="description" content="学术论文实证分析工具，支持OLS回归、描述统计、时间序列、机器学习" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        <div className="journal-header">
          <span className="journal-name">Empirical Research Assistant</span>
          <span className="journal-meta">论文实证分析 · Powered by Gemini</span>
        </div>

        <div className="title-block">
          <h1>论文<span>实证分析</span> Agent</h1>
          <p className="subtitle">支持 OLS 回归 · 描述统计 · 相关性 · 时间序列 · 机器学习预测</p>
        </div>

        <div className="section">
          <div className="section-head">
            <span className="section-num">STEP 01</span>
            <span className="section-title">上传数据</span>
          </div>
          {!parsedData ? (
            <div
              className="upload-zone"
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); }}
            >
              <input type="file" ref={fileRef} accept=".csv,.xlsx,.xls,.txt,.dta" style={{ display: "none" }} onChange={(e) => handleFile(e.target.files[0])} />
              <div className="upload-icon">📂</div>
              <h3>上传数据文件</h3>
              <p>点击或拖拽上传 · 支持 .csv / .xlsx / .xls / .txt</p>
              <p className="dta-note">注：.dta 文件请先转换为 CSV 格式</p>
            </div>
          ) : (
            <div className="data-meta">
              <div className="meta-row">
                <span className="meta-item">文件 <strong>{fileName}</strong></span>
                <span className="meta-item">观测值 <strong>{parsedData.data.length}</strong></span>
                <span className="meta-item">变量数 <strong>{fields.length}</strong></span>
                <button className="reset-btn" onClick={() => { setParsedData(null); setSelectedCols([]); }}>重新上传</button>
              </div>
              <div className="col-label">变量列（点击选择分析列）</div>
              <div className="col-tags">
                {fields.map((f) => (
                  <span key={f} className={`col-tag ${selectedCols.includes(f) ? "selected" : ""}`} onClick={() => toggleCol(f)}>{f}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        <hr className="divider" />

        <div className="section">
          <div className="section-head">
            <span className="section-num">STEP 02</span>
            <span className="section-title">选择分析方法</span>
          </div>
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
            <div className="var-row">
              <span className="var-label">被解释变量 Y</span>
              <select className="var-select" value={depVar} onChange={(e) => setDepVar(e.target.value)}>
                <option value="">— 选择 —</option>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
            <div className="var-row">
              <span className="var-label">解释变量 X</span>
              <select className="var-select" multiple size={4} value={indepVars} onChange={(e) => setIndepVars(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <span className="var-hint">按住 Ctrl 多选</span>
            </div>
            <div className="var-row">
              <span className="var-label">控制变量</span>
              <select className="var-select" multiple size={3} value={controlVars} onChange={(e) => setControlVars(Array.from(e.target.selectedOptions).map((o) => o.value))}>
                {fields.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
            </div>
          </div>
        )}

        <hr className="divider" />

        <div className="section">
          <div className="section-head">
            <span className="section-num">STEP 03</span>
            <span className="section-title">分析指令（可选）</span>
          </div>
          <div className="textarea-wrap">
            <textarea
              className="custom-input"
              placeholder="描述你的研究假设、关注的变量关系，或具体分析需求…&#10;例如：检验X对Y是否有显著正向影响，并输出可直接放入论文的回归表格"
              value={customQ}
              onChange={(e) => setCustomQ(e.target.value)}
            />
            <div className="textarea-footer">
              <div className="quick-tags">
                {["📄 学术表格", "📖 系数解读", "🔬 诊断检验", "🛡️ 稳健性", "✍️ 论文段落"].map((tag, i) => {
                  const texts = ["请按学术论文格式输出结果表格", "请解读系数的经济学含义", "请检验异方差和多重共线性", "请给出稳健性检验建议", "请用中文写出可直接粘贴到论文的实证结果描述段落"];
                  return <span key={i} className="qtag" onClick={() => appendQ(texts[i])}>{tag}</span>;
                })}
              </div>
              <button className="run-btn" onClick={runAnalysis} disabled={loading}>
                {loading ? "分析中…" : "运行分析 →"}
              </button>
            </div>
          </div>
        </div>

        {(loading || result) && (
          <div className="result-area">
            <div className="section-head">
              <span className="section-num">OUTPUT</span>
              <span className="section-title">分析结果</span>
            </div>
            <div className="result-paper">
              <div className="result-header">
                <div className="result-header-left">
                  <span className="result-badge">{(analysisType || "").toUpperCase()}</span>
                  <span className="result-title-text">实证分析报告</span>
                </div>
                <button className="copy-btn" onClick={copyResult}>复制结果</button>
              </div>
              <div className="result-body">
                {loading ? (
                  <div className="loading-state">
                    <div className="spinner" />
                    正在运行实证分析，请稍候…
                  </div>
                ) : (
                  <div dangerouslySetInnerHTML={{ __html: renderMarkdown(result) }} />
                )}
              </div>
              <div className="result-footer">
                <span className="result-note">* 基于上传数据样本 · {new Date().toLocaleDateString("zh-CN")}</span>
                <button className="export-btn" onClick={exportResult}>导出为 TXT</button>
              </div>
            </div>
          </div>
        )}
      </div>

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f7f5f0; color: #1a1a1a; font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }
        .app { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
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
        .upload-zone:hover { border-color: #2c4a8a; background: rgba(44,74,138,0.02); }
        .upload-icon { font-size: 28px; margin-bottom: 10px; }
        .upload-zone h3 { font-family: 'Playfair Display', serif; font-size: 15px; margin-bottom: 4px; }
        .upload-zone p { font-size: 12px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; }
        .dta-note { font-size: 11px; color: #8a2c2c; font-style: italic; margin-top: 8px; }
        .data-meta { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; }
        .meta-row { display: flex; gap: 20px; align-items: center; flex-wrap: wrap; margin-bottom: 12px; }
        .meta-item { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8a8078; }
        .meta-item strong { color: #2c4a8a; }
        .reset-btn { margin-left: auto; background: none; border: 1px solid #ddd8cc; border-radius: 4px; padding: 4px 10px; font-size: 11px; cursor: pointer; color: #8a8078; font-family: 'IBM Plex Mono', monospace; }
        .reset-btn:hover { border-color: #8a2c2c; color: #8a2c2c; }
        .col-label { font-size: 12px; font-weight: 600; color: #3a3530; margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace; letter-spacing: 0.5px; }
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
        .analysis-card.active::after { content: '✓'; position: absolute; top: 10px; right: 12px; color: #2c4a8a; font-weight: 700; font-size: 13px; }
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
        .copy-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 5px; padding: 5px 12px; font-size: 11px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; }
        .copy-btn:hover { background: rgba(255,255,255,0.2); }
        .result-body { padding: 28px 32px; font-size: 14px; line-height: 1.9; color: #3a3530; min-height: 100px; }
        .loading-state { display: flex; align-items: center; gap: 12px; color: #8a8078; font-style: italic; font-family: 'Playfair Display', serif; }
        .spinner { width: 18px; height: 18px; border: 2px solid #ddd8cc; border-top-color: #2c4a8a; border-radius: 50%; animation: spin 0.8s linear infinite; flex-shrink: 0; }
        @keyframes spin { to { transform: rotate(360deg); } }
        .result-body .md-h2 { font-family: 'Playfair Display', serif; font-size: 18px; color: #1a1a1a; margin: 20px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #ddd8cc; }
        .result-body .md-h3 { font-size: 12px; font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; color: #2c4a8a; margin: 14px 0 8px; font-family: 'IBM Plex Mono', monospace; }
        .result-body strong { color: #1a1a1a; font-weight: 600; }
        .result-body em { color: #8a2c2c; font-style: italic; }
        .result-body code { font-family: 'IBM Plex Mono', monospace; font-size: 12px; background: #f0ece3; padding: 1px 5px; border-radius: 3px; color: #8a2c2c; }
        .result-body .md-table { width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 12px; font-family: 'IBM Plex Mono', monospace; border-top: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; }
        .result-body .md-table th { border-bottom: 1px solid #1a1a1a; padding: 8px 12px; background: #f7f5f0; font-weight: 600; color: #1a1a1a; }
        .result-body .md-table td { border-bottom: 1px solid #ddd8cc; padding: 6px 12px; vertical-align: top; white-space: pre-line; }
        .result-body .md-table td:first-child { font-weight: 500; }
        .result-body .md-table tbody tr:last-child td { border-bottom: 1px solid #1a1a1a; }
        .result-footer { padding: 12px 32px; border-top: 1px solid #ddd8cc; background: #f0ece3; display: flex; align-items: center; justify-content: space-between; }
        .result-note { font-size: 11px; color: #8a8078; font-style: italic; font-family: 'Playfair Display', serif; }
        .export-btn { background: none; border: 1px solid #ddd8cc; border-radius: 5px; padding: 5px 12px; font-size: 11px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; color: #8a8078; transition: all 0.15s; }
        .export-btn:hover { border-color: #2c4a8a; color: #2c4a8a; }
      `}</style>
    </>
  );
}
