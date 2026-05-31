import { useState, useRef } from 'react';
import Head from 'next/head';
import { descriptiveStats, generateDescriptiveTable, correlationMatrix, generateCorrelationTable } from '../lib/statistics';
import { parseCSV, stringifyCSV, detectVariableTypes } from '../lib/data-utils';
import { mergeDataHorizontal, mergeDataVertical } from '../lib/data-merger';
import { detectMissingValues, dropMissingValues, imputeMissingValues, winsorize, detectOutliers } from '../lib/data-cleansing';
import { olsRegression, generateRegressionTable } from '../lib/regression';

const AppStep = {
  UPLOAD: 'upload',
  DATA_CLEANSING: 'cleansing',
  ANALYSIS: 'analysis',
  RESULTS: 'results'
};

export default function Home() {
  const [currentStep, setCurrentStep] = useState(AppStep.UPLOAD);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [mergedData, setMergedData] = useState(null);
  const [analysisType, setAnalysisType] = useState(null);
  const [depVar, setDepVar] = useState('');
  const [indepVars, setIndepVars] = useState([]);
  const [customQ, setCustomQ] = useState('');
  const [analysisResult, setAnalysisResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedCols, setSelectedCols] = useState([]);

  const fileRef = useRef(null);

  function handleFilesSelected(files) {
    const newFiles = Array.from(files).map(file => ({
      id: Math.random().toString(36).substr(2, 9),
      file,
      name: file.name,
      parsedData: null,
      isLoading: true
    }));
    
    setUploadedFiles(newFiles);
    
    Promise.all(
      newFiles.map(async (fileObj, index) => {
        return new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => {
            const ext = fileObj.name.split('.').pop().toLowerCase();
            let parsed = null;
            
            if (ext === 'csv' || ext === 'txt') {
              parsed = parseCSV(e.target.result);
            } else if (ext === 'xlsx' || ext === 'xls') {
              import('xlsx').then(xlsx => {
                const wb = xlsx.read(e.target.result, { type: 'binary' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const json = xlsx.utils.sheet_to_json(ws, { defval: '' });
                const fields = Object.keys(json[0] || {});
                parsed = {
                  data: json,
                  meta: {
                    fields,
                    rowCount: json.length
                  }
                };
                resolve({ index, parsed });
              });
            } else {
              parsed = parseCSV(e.target.result);
              resolve({ index, parsed });
            }
            
            if (ext === 'csv' || ext === 'txt') {
              resolve({ index, parsed });
            }
          };
          if (['csv', 'txt'].includes(fileObj.name.split('.').pop().toLowerCase())) {
            reader.readAsText(fileObj.file);
          } else {
            reader.readAsBinaryString(fileObj.file);
          }
        });
      })
    ).then(results => {
      setUploadedFiles(prev => 
        prev.map((fileObj, idx) => {
          const result = results.find(r => r.index === idx);
          if (result) {
            return { ...fileObj, parsedData: result.parsed, isLoading: false };
          }
          return fileObj;
        })
      );
    });
  }

  function handleFileDrop(e) {
    e.preventDefault();
    handleFilesSelected(e.dataTransfer.files);
  }

  function removeFile(fileId) {
    setUploadedFiles(prev => prev.filter(f => f.id !== fileId));
  }

  function mergeFiles() {
    if (uploadedFiles.length === 0) return;
    
    if (uploadedFiles.length === 1) {
      setMergedData(uploadedFiles[0].parsedData);
      setCurrentStep(AppStep.DATA_CLEANSING);
    } else {
      setCurrentStep('merge-config');
    }
  }

  function doMerge(mergeType, keyFields) {
    const datasets = uploadedFiles.filter(f => f.parsedData).map(f => f.parsedData);
    
    if (mergeType === 'horizontal') {
      const result = mergeDataHorizontal(datasets, keyFields);
      setMergedData(result);
    } else {
      const result = mergeDataVertical(datasets);
      setMergedData(result);
    }
    setCurrentStep(AppStep.DATA_CLEANSING);
  }

  function skipCleansing() {
    setCurrentStep(AppStep.ANALYSIS);
  }

  function handleAnalyze() {
    if (!mergedData) return alert('请先上传并处理数据');
    if (!analysisType) return alert('请选择分析类型');
    
    setLoading(true);
    setAnalysisResult(null);

    const { data, meta } = mergedData;
    
    const isLocalAnalysis = analysisType === 'descriptive' || analysisType === 'correlation' || analysisType === 'regression';
    
    if (isLocalAnalysis) {
      if (analysisType === 'descriptive') {
        const stats = descriptiveStats(data, meta.fields);
        const tableStr = generateDescriptiveTable(stats);
        setAnalysisResult({
          tables: '\n\n## 描述性统计\n' + tableStr,
          analysis: '以上是主要变量的描述性统计结果。'
        });
      } else if (analysisType === 'correlation') {
        const corr = correlationMatrix(data, meta.fields);
        const tableStr = generateCorrelationTable(corr);
        setAnalysisResult({
          tables: '\n\n## 相关性分析\n' + tableStr,
          analysis: '以上是变量间的相关性分析结果。'
        });
      } else if (analysisType === 'regression') {
        if (!depVar) {
          alert('请先选择被解释变量(Y)');
          setLoading(false);
          return;
        }
        
        const analysisVars = indepVars.length > 0 ? indepVars : meta.fields.filter(f => f !== depVar);
        
        const yData = data.map(row => parseFloat(row[depVar]) || 0);
        const XData = data.map(row => [
          1,
          ...analysisVars.map(v => parseFloat(row[v]) || 0)
        ]);
        
        try {
          const regressionResult = olsRegression(yData, XData);
          regressionResult.varNames = analysisVars;
          
          const tableStr = generateRegressionTable(regressionResult, analysisVars, depVar);
          
          let analysis = `\n\n## OLS 回归分析结果\n`;
          analysis += `\n因变量: **${depVar}**\n`;
          analysis += `\n样本量: ${regressionResult.n}\n`;
          analysis += `R²: ${regressionResult.rSquared.toFixed(4)}\n`;
          analysis += `调整 R²: ${regressionResult.adjRSquared.toFixed(4)}\n`;
          analysis += `F统计量: ${regressionResult.fStatistic.toFixed(4)}\n\n`;
          
          analysis += `### 主要发现：\n`;
          
          analysisVars.forEach((v, i) => {
            const coef = regressionResult.coefficients[i + 1];
            const pval = regressionResult.pValues[i + 1];
            const sig = pval < 0.01 ? '***' : pval < 0.05 ? '**' : pval < 0.1 ? '*' : '';
            
            if (sig) {
              const direction = coef > 0 ? '正向' : '负向';
              analysis += `- **${v}** 对 ${depVar} 有显著${direction}影响 (系数=${coef.toFixed(4)}${sig}, p=${pval.toFixed(4)})\n`;
            } else {
              analysis += `- **${v}** 对 ${depVar} 的影响不显著 (系数=${coef.toFixed(4)}, p=${pval.toFixed(4)})\n`;
            }
          });
          
          setAnalysisResult({
            tables: tableStr,
            analysis: analysis
          });
        } catch (error) {
          setAnalysisResult({
            tables: '',
            analysis: '回归分析失败：' + error.message
          });
        }
      }
      
      setLoading(false);
      setCurrentStep(AppStep.RESULTS);
      return;
    }

    const cols = selectedCols.length > 0 ? selectedCols : meta.fields;
    const sampleSize = Math.min(1000, data.length);
    const sample = data.slice(0, sampleSize);
    const csvStr = [cols.join(','), ...sample.map(r => cols.map(c => r[c] ?? '').join(','))].join('\n');

    let varSpec = '';
    if (analysisType === 'regression' && depVar) {
      varSpec = `\n被解释变量(Y): ${depVar}\n解释变量(X): ${indepVars.join(', ') || '未指定'}\n`;
    }

    fetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        dataStr: csvStr,
        totalRows: data.length,
        sampleSize,
        analysisType,
        varSpec,
        customQ,
        fields: meta.fields.length,
      }),
    }).then(async (res) => {
      const json = await res.json();
      const rawText = json.text || json.error || '分析失败';
      
      const processed = {
        tables: rawText,
        analysis: customQ || '分析结果如上所示'
      };
      
      setAnalysisResult(processed);
      setLoading(false);
      setCurrentStep(AppStep.RESULTS);
    }).catch((err) => {
      setAnalysisResult({ tables: '', analysis: '请求失败：' + err.message });
      setLoading(false);
      setCurrentStep(AppStep.RESULTS);
    });
  }

  return (
    <>
      <Head>
        <title>论文实证分析平台 - 数据清洗与分析</title>
        <meta name="description" content="学术论文实证分析工具，支持数据清洗、面板数据、描述性统计、相关性分析、OLS回归" />
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        <div className="journal-header">
          <span className="journal-name">Empirical Research Assistant</span>
          <span className="journal-meta">论文实证分析平台 - 数据清洗与分析</span>
        </div>

        <div className="step-indicator">
          {Object.values(AppStep).map((step, idx) => (
            <div
              key={step}
              className={`step-item ${currentStep === step ? 'active' : ''} ${
                getStepIndex(step) < getStepIndex(currentStep) ? 'completed' : ''
              }`}
            >
              <div className="step-number">{idx + 1}</div>
              <div className="step-label">{getStepLabel(step)}</div>
            </div>
          ))}
        </div>

        {currentStep === AppStep.UPLOAD && (
          <FileUploadStep
            files={uploadedFiles}
            onFilesSelected={handleFilesSelected}
            onFileDrop={handleFileDrop}
            onRemoveFile={removeFile}
            onMerge={mergeFiles}
            fileRef={fileRef}
          />
        )}

        {currentStep === 'merge-config' && (
          <MergeConfigStep
            files={uploadedFiles}
            onMerge={doMerge}
            onBack={() => setCurrentStep(AppStep.UPLOAD)}
          />
        )}

        {currentStep === AppStep.DATA_CLEANSING && mergedData && (
          <DataCleansingStep
            data={mergedData}
            onBack={() => setCurrentStep(AppStep.UPLOAD)}
            onNext={() => setCurrentStep(AppStep.ANALYSIS)}
            onSkip={skipCleansing}
            onDataUpdated={(newData) => setMergedData(newData)}
          />
        )}

        {currentStep === AppStep.ANALYSIS && mergedData && (
          <AnalysisSetupStep
            data={mergedData}
            analysisType={analysisType}
            setAnalysisType={setAnalysisType}
            depVar={depVar}
            setDepVar={setDepVar}
            indepVars={indepVars}
            setIndepVars={setIndepVars}
            selectedCols={selectedCols}
            setSelectedCols={setSelectedCols}
            customQ={customQ}
            setCustomQ={setCustomQ}
            onAnalyze={handleAnalyze}
            loading={loading}
            onBack={() => setCurrentStep(AppStep.DATA_CLEANSING)}
          />
        )}

        {currentStep === AppStep.RESULTS && (
          <ResultsStep
            result={analysisResult}
            onBack={() => setCurrentStep(AppStep.ANALYSIS)}
            onRestart={() => {
              setCurrentStep(AppStep.UPLOAD);
              setAnalysisResult(null);
            }}
          />
        )}
      </div>

      <style jsx global>{`
        .app {
          max-width: 1000px;
          margin: 0 auto;
          padding: 48px 24px;
        }
        
        .journal-header {
          border-top: 3px solid #1a1a1a;
          border-bottom: 1px solid #1a1a1a;
          padding: 14px 0 10px;
          margin-bottom: 36px;
          display: flex;
          justify-content: space-between;
          align-items: baseline;
        }
        
        .journal-name {
          font-family: 'Playfair Display', serif;
          font-size: 13px;
          font-weight: 600;
          letter-spacing: 3px;
          text-transform: uppercase;
        }
        
        .journal-meta {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: #8a8078;
        }
        
        .step-indicator {
          display: flex;
          justify-content: center;
          gap: 40px;
          margin-bottom: 40px;
        }
        
        .step-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          opacity: 0.4;
        }
        
        .step-item.active {
          opacity: 1;
        }
        
        .step-item.completed {
          opacity: 0.8;
        }
        
        .step-number {
          width: 36px;
          height: 36px;
          border-radius: 50%;
          background: #2c4a8a;
          color: white;
          display: flex;
          align-items: center;
          justify-content: center;
          font-weight: 600;
          margin-bottom: 8px;
        }
        
        .step-item.completed .step-number {
          background: #4a9;
        }
        
        .step-label {
          font-size: 12px;
          color: #555;
        }
        
        .step-item.active .step-label {
          color: #2c4a8a;
          font-weight: 600;
        }
      `}</style>
    </>
  );
}

function getStepIndex(step) {
  return Object.values(AppStep).indexOf(step);
}

function getStepLabel(step) {
  const labels = {
    upload: '上传数据',
    cleansing: '数据清洗',
    analysis: '分析设置',
    results: '查看结果'
  };
  return labels[step] || step;
}

function FileUploadStep({ files, onFilesSelected, onFileDrop, onRemoveFile, onMerge, fileRef }) {
  return (
    <div className="section">
      <div className="section-head">
        <span className="section-num">STEP 1</span>
        <span className="section-title">上传数据文件</span>
      </div>
      
      <div
        className="upload-zone"
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => e.preventDefault()}
        onDrop={onFileDrop}
      >
        <input
          type="file"
          ref={fileRef}
          multiple
          accept=".csv,.xlsx,.xls,.txt"
          style={{ display: 'none' }}
          onChange={(e) => onFilesSelected(e.target.files)}
        />
        <div className="upload-icon">📂</div>
        <h3>点击或拖拽上传数据</h3>
        <p>支持多文件上传，格式：CSV, Excel, TXT</p>
      </div>

      {files.length > 0 && (
        <>
          <div className="file-list">
            {files.map(file => (
              <div key={file.id} className="file-item">
                <div className="file-icon">📄</div>
                <div className="file-info">
                  <div className="file-name">{file.name}</div>
                  <div className="file-meta">
                    {file.isLoading ? '正在解析...' : file.parsedData ? (
                      `${file.parsedData.data.length} 行 × ${file.parsedData.meta.fields.length} 列`
                    ) : '解析失败'}
                  </div>
                </div>
                <button className="btn-remove" onClick={() => onRemoveFile(file.id)}>
                  ✕
                </button>
              </div>
            ))}
          </div>
          
          <button className="btn-primary" onClick={onMerge}>
            继续 →
          </button>
        </>
      )}

      <style jsx>{`
        .section-head {
          display: flex;
          align-items: center;
          gap: 10px;
          margin-bottom: 20px;
        }
        
        .section-num {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          color: #2c4a8a;
          font-weight: 500;
          background: rgba(44, 74, 138, 0.08);
          border: 1px solid rgba(44, 74, 138, 0.2);
          padding: 2px 8px;
          border-radius: 3px;
          letter-spacing: 1px;
        }
        
        .section-title {
          font-size: 14px;
          font-weight: 600;
          letter-spacing: 2px;
          text-transform: uppercase;
          color: #3a3530;
        }
        
        .upload-zone {
          border: 2px dashed #ddd8cc;
          border-radius: 8px;
          padding: 40px 24px;
          text-align: center;
          cursor: pointer;
          background: #fffef9;
          transition: all 0.2s;
          margin-bottom: 24px;
        }
        
        .upload-zone:hover {
          border-color: #2c4a8a;
        }
        
        .upload-icon {
          font-size: 28px;
          margin-bottom: 10px;
        }
        
        .upload-zone h3 {
          font-family: 'Playfair Display', serif;
          font-size: 15px;
          margin-bottom: 4px;
        }
        
        .upload-zone p {
          font-size: 12px;
          color: #8a8078;
          font-family: 'IBM Plex Mono', monospace;
        }
        
        .file-list {
          display: flex;
          flex-direction: column;
          gap: 12px;
          margin-bottom: 24px;
        }
        
        .file-item {
          background: #fffef9;
          border: 1px solid #ddd8cc;
          border-radius: 8px;
          padding: 16px 20px;
          display: flex;
          align-items: center;
          gap: 16px;
        }
        
        .file-icon {
          font-size: 24px;
        }
        
        .file-name {
          font-weight: 600;
          margin-bottom: 4px;
        }
        
        .file-meta {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 11px;
          color: #8a8078;
        }
        
        .btn-remove {
          margin-left: auto;
          background: none;
          border: 1px solid #ddd8cc;
          border-radius: 50%;
          width: 28px;
          height: 28px;
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: pointer;
        }
        
        .btn-remove:hover {
          border-color: #f44;
          color: #f44;
        }
        
        .btn-primary {
          background: #2c4a8a;
          color: white;
          border: none;
          border-radius: 6px;
          padding: 10px 24px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }
        
        .btn-primary:hover {
          background: #1e3a6e;
        }
      `}</style>
    </div>
  );
}

function MergeConfigStep({ files, onMerge, onBack }) {
  const [mergeType, setMergeType] = useState('horizontal');
  const [keyFields, setKeyFields] = useState([]);
  
  const allFields = files.flatMap(f => f.parsedData?.meta.fields || []);
  const uniqueFields = [...new Set(allFields)];
  
  return (
    <div className="section">
      <div className="section-head">
        <span className="section-num">MERGE</span>
        <span className="section-title">文件合并设置</span>
      </div>
      
      <div className="config-panel">
        <div className="config-item">
          <label>合并方式</label>
          <div className="radio-group">
            <label className="radio-option">
              <input
                type="radio"
                name="mergeType"
                value="horizontal"
                checked={mergeType === 'horizontal'}
                onChange={() => setMergeType('horizontal')}
              />
              横向合并（增加变量列）
            </label>
            <label className="radio-option">
              <input
                type="radio"
                name="mergeType"
                value="vertical"
                checked={mergeType === 'vertical'}
                onChange={() => setMergeType('vertical')}
              />
              纵向合并（增加观测值）
            </label>
          </div>
        </div>
        
        {mergeType === 'horizontal' && (
          <div className="config-item">
            <label>选择关键变量（用于匹配）</label>
            <div className="checkbox-group">
              {uniqueFields.map(field => (
                <label key={field} className="checkbox-option">
                  <input
                    type="checkbox"
                    checked={keyFields.includes(field)}
                    onChange={(e) => {
                      if (e.target.checked) {
                        setKeyFields([...keyFields, field]);
                      } else {
                        setKeyFields(keyFields.filter(f => f !== field));
                      }
                    }}
                  />
                  {field}
                </label>
              ))}
            </div>
          </div>
        )}
        
        <div className="button-group">
          <button className="btn-secondary" onClick={onBack}>
            返回
          </button>
          <button
            className="btn-primary"
            onClick={() => onMerge(mergeType, keyFields)}
          >
            合并并继续
          </button>
        </div>
      </div>

      <style jsx>{`
        .config-panel {
          background: #fffef9;
          border: 1px solid #ddd8cc;
          border-radius: 8px;
          padding: 24px;
        }
        
        .config-item {
          margin-bottom: 24px;
        }
        
        .config-item label {
          display: block;
          font-weight: 600;
          margin-bottom: 12px;
        }
        
        .radio-group,
        .checkbox-group {
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        
        .radio-option,
        .checkbox-option {
          display: flex;
          align-items: center;
          gap: 8px;
          cursor: pointer;
        }
        
        .button-group {
          display: flex;
          justify-content: flex-end;
          gap: 12px;
        }
        
        .btn-secondary {
          background: none;
          border: 1px solid #ddd8cc;
          border-radius: 6px;
          padding: 10px 24px;
          font-size: 14px;
          cursor: pointer;
        }
        
        .btn-secondary:hover {
          border-color: #bbb;
        }
      `}</style>
    </div>
  );
}

function DataCleansingStep({ data, onBack, onNext, onSkip, onDataUpdated }) {
  const [activeTab, setActiveTab] = useState('preview');
  const [missingConfig, setMissingConfig] = useState({});
  const [outlierConfig, setOutlierConfig] = useState({});

  const missingReport = detectMissingValues(data.data, data.meta.fields);

  function handleDropMissing() {
    const result = dropMissingValues(data.data);
    onDataUpdated({ ...data, data: result.data });
    alert(`已删除 ${result.log.droppedCount} 条含缺失值的记录`);
  }

  function handleImputeMissing(field, strategy) {
    const result = imputeMissingValues(data.data, [field], strategy);
    onDataUpdated({ ...data, data: result.data });
    alert(`已对 ${field} 使用 ${strategy} 方法填补缺失值`);
  }

  function handleWinsorize(field) {
    const result = winsorize(data.data, field);
    onDataUpdated({ ...data, data: result.data });
    alert(`已对 ${field} 进行 1%/99% 缩尾处理`);
  }

  return (
    <div className="section">
      <div className="section-head">
        <span className="section-num">STEP 2</span>
        <span className="section-title">数据清洗</span>
      </div>

      <div className="tabs">
        {['preview', 'missing', 'outliers'].map(tab => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'preview' ? '数据预览' : tab === 'missing' ? '缺失值处理' : '异常值处理'}
          </button>
        ))}
      </div>

      <div className="cleansing-content">
        {activeTab === 'preview' && (
          <DataPreview data={data} />
        )}

        {activeTab === 'missing' && (
          <div className="missing-values-container">
            <div className="missing-summary">
              <button className="btn-secondary" onClick={handleDropMissing}>
                删除所有含缺失值的记录
              </button>
            </div>
            <div className="missing-table">
              <table>
                <thead>
                  <tr>
                    <th>变量</th>
                    <th>缺失数</th>
                    <th>缺失率</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.meta.fields.map(field => (
                    <tr key={field}>
                      <td>{field}</td>
                      <td>{missingReport[field]?.count}</td>
                      <td>{missingReport[field]?.percentage}</td>
                      <td>
                        <button
                          className="btn-small"
                          onClick={() => handleImputeMissing(field, 'mean')}
                        >
                          均值填补
                        </button>
                        <button
                          className="btn-small"
                          onClick={() => handleImputeMissing(field, 'median')}
                        >
                          中位数填补
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {activeTab === 'outliers' && (
          <div className="outliers-container">
            <div className="outliers-table">
              <table>
                <thead>
                  <tr>
                    <th>变量</th>
                    <th>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.meta.fields.map(field => (
                    <tr key={field}>
                      <td>{field}</td>
                      <td>
                        <button
                          className="btn-small"
                          onClick={() => handleWinsorize(field)}
                        >
                          Winsorize (1%/99%)
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="button-group">
        <button className="btn-secondary" onClick={onBack}>
          返回
        </button>
        <button className="btn-secondary" onClick={onSkip}>
          跳过清洗
        </button>
        <button className="btn-primary" onClick={onNext}>
          继续分析 →
        </button>
      </div>

      <style jsx>{`
        .tabs {
          display: flex;
          border-bottom: 1px solid #ddd8cc;
          margin-bottom: 24px;
        }
        
        .tab-button {
          padding: 12px 24px;
          background: none;
          border: none;
          font-size: 14px;
          cursor: pointer;
          border-bottom: 2px solid transparent;
        }
        
        .tab-button.active {
          border-bottom-color: #2c4a8a;
          color: #2c4a8a;
          font-weight: 600;
        }
        
        .cleansing-content {
          background: #fffef9;
          border: 1px solid #ddd8cc;
          border-radius: 8px;
          padding: 24px;
          margin-bottom: 24px;
        }
        
        .btn-small {
          background: none;
          border: 1px solid #ddd8cc;
          border-radius: 4px;
          padding: 4px 10px;
          font-size: 12px;
          margin-right: 6px;
          cursor: pointer;
        }
        
        .btn-small:hover {
          border-color: #2c4a8a;
          color: #2c4a8a;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
        }
        
        th, td {
          border: 1px solid #ddd8cc;
          padding: 8px 12px;
          text-align: left;
        }
        
        th {
          background: #f7f5f0;
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}

function DataPreview({ data }) {
  const previewRows = data.data.slice(0, 10);
  return (
    <div>
      <div className="preview-header">
        <span>数据预览（前10行）</span>
        <span className="preview-meta">
          共 {data.data.length} 行 × {data.meta.fields.length} 列
        </span>
      </div>
      <div className="data-table">
        <table>
          <thead>
            <tr>
              {data.meta.fields.map(field => (
                <th key={field}>{field}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, idx) => (
              <tr key={idx}>
                {data.meta.fields.map(field => (
                  <td key={field}>{row[field]}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <style jsx>{`
        .preview-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 16px;
        }
        
        .preview-meta {
          font-family: 'IBM Plex Mono', monospace;
          color: #8a8078;
        }
        
        .data-table {
          overflow-x: auto;
        }
      `}</style>
    </div>
  );
}

function AnalysisSetupStep({
  data, analysisType, setAnalysisType, depVar, setDepVar,
  indepVars, setIndepVars, selectedCols, setSelectedCols,
  customQ, setCustomQ, onAnalyze, loading, onBack
}) {
  const fields = data.meta.fields;
  
  const analysisOptions = [
    { type: 'descriptive', label: '描述性统计', icon: '📊' },
    { type: 'correlation', label: '相关性分析', icon: '🔗' },
    { type: 'regression', label: 'OLS回归分析', icon: '📈' }
  ];

  return (
    <div className="section">
      <div className="section-head">
        <span className="section-num">STEP 3</span>
        <span className="section-title">设置分析</span>
      </div>

      <div className="analysis-grid">
        {analysisOptions.map(opt => (
          <div
            key={opt.type}
            className={`analysis-card ${analysisType === opt.type ? 'active' : ''}`}
            onClick={() => setAnalysisType(opt.type)}
          >
            <div className="card-icon">{opt.icon}</div>
            <div className="card-title">{opt.label}</div>
          </div>
        ))}
      </div>

      {analysisType === 'regression' && (
        <div className="var-config">
          <div className="var-config-title">模型设置</div>
          <div className="var-row">
            <span className="var-label">被解释变量 (Y)</span>
            <select
              className="var-select"
              value={depVar}
              onChange={(e) => setDepVar(e.target.value)}
            >
              <option value="">请选择</option>
              {fields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
          <div className="var-row">
            <span className="var-label">解释变量 (X)</span>
            <select
              className="var-select"
              multiple
              size={5}
              value={indepVars}
              onChange={(e) => {
                setIndepVars(Array.from(e.target.selectedOptions, (o) => o.value));
              }}
            >
              {fields.map((f) => (
                <option key={f} value={f}>{f}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="textarea-wrap">
        <textarea
          className="custom-input"
          placeholder="描述你的研究假设、关注的变量关系，或具体分析需求..."
          value={customQ}
          onChange={(e) => setCustomQ(e.target.value)}
        />
      </div>

      <div className="button-group">
        <button className="btn-secondary" onClick={onBack}>
          返回
        </button>
        <button
          className="btn-primary"
          onClick={onAnalyze}
          disabled={loading}
        >
          {loading ? '分析中...' : '运行分析 →'}
        </button>
      </div>

      <style jsx>{`
        .analysis-grid {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-bottom: 24px;
        }
        
        @media (max-width: 600px) {
          .analysis-grid {
            grid-template-columns: 1fr;
          }
        }
        
        .analysis-card {
          background: #fffef9;
          border: 1.5px solid #ddd8cc;
          border-radius: 8px;
          padding: 20px;
          text-align: center;
          cursor: pointer;
          transition: all 0.2s;
        }
        
        .analysis-card:hover {
          border-color: #2c4a8a;
        }
        
        .analysis-card.active {
          border-color: #2c4a8a;
          background: rgba(44,74,138,0.04);
        }
        
        .card-icon {
          font-size: 28px;
          margin-bottom: 8px;
        }
        
        .card-title {
          font-size: 14px;
          font-weight: 600;
        }
        
        .var-config {
          background: #fffef9;
          border: 1px solid #ddd8cc;
          border-radius: 8px;
          padding: 20px;
          margin-bottom: 24px;
        }
        
        .var-config-title {
          font-family: 'IBM Plex Mono', monospace;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 2px;
          color: #8a8078;
          margin-bottom: 16px;
        }
        
        .var-row {
          display: flex;
          align-items: center;
          gap: 16px;
          margin-bottom: 16px;
        }
        
        .var-label {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
          font-weight: 600;
          min-width: 140px;
        }
        
        .var-select {
          flex: 1;
          background: #f7f5f0;
          border: 1px solid #ddd8cc;
          border-radius: 6px;
          padding: 10px;
          font-family: 'IBM Plex Mono', monospace;
          font-size: 12px;
        }
        
        .textarea-wrap {
          margin-bottom: 24px;
        }
        
        .custom-input {
          width: 100%;
          min-height: 100px;
          background: #fffef9;
          border: 1px solid #ddd8cc;
          border-radius: 8px;
          padding: 16px;
          font-size: 14px;
          line-height: 1.6;
          font-family: 'IBM Plex Sans', sans-serif;
        }
      `}</style>
    </div>
  );
}

function ResultsStep({ result, onBack, onRestart }) {
  if (!result) return <div>加载中...</div>;
  
  function copyResult() {
    const fullText = (result.tables || '') + '\n\n' + (result.analysis || '');
    navigator.clipboard.writeText(fullText);
  }

  function exportResult() {
    const fullText = (result.tables || '') + '\n\n' + (result.analysis || '');
    const blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `实证分析结果_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
  }

  return (
    <div className="result-area">
      <div className="section-head">
        <span className="section-num">OUTPUT</span>
        <span className="section-title">分析结果</span>
      </div>
      
      <div className="result-paper">
        <div className="result-header">
          <span className="result-badge">RESULTS</span>
          <span className="result-title-text">实证分析结果</span>
          <button className="copy-btn" onClick={copyResult}>
            复制结果
          </button>
        </div>
        
        <div className="result-body">
          {result.tables && (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(result.tables) }} />
          )}
          {result.analysis && (
            <div className="analysis-text">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(result.analysis) }} />
            </div>
          )}
        </div>
        
        <div className="result-footer">
          <button className="btn-secondary" onClick={onBack}>
            返回设置
          </button>
          <button className="export-btn" onClick={exportResult}>
            导出为 TXT
          </button>
          <button className="btn-primary" onClick={onRestart}>
            开始新分析
          </button>
        </div>
      </div>

      <style jsx global>{`
        .result-paper {
          background: #fffef9;
          border: 1px solid #ddd8cc;
          border-radius: 8px;
          overflow: hidden;
        }
        
        .result-header {
          background: #1a1a1a;
          color: white;
          padding: 14px 20px;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        
        .result-badge {
          font-family: 'IBM Plex Mono', monospace;
          font-size: 10px;
          letter-spacing: 2px;
          background: rgba(255,255,255,0.12);
          padding: 3px 10px;
          border-radius: 3px;
        }
        
        .result-title-text {
          font-family: 'Playfair Display', serif;
          font-size: 15px;
        }
        
        .copy-btn {
          background: rgba(255,255,255,0.1);
          border: 1px solid rgba(255,255,255,0.2);
          color: white;
          border-radius: 5px;
          padding: 5px 12px;
          font-size: 11px;
          cursor: pointer;
          font-family: 'IBM Plex Mono', monospace;
        }
        
        .result-body {
          padding: 28px 32px;
          font-size: 14px;
          line-height: 1.9;
          color: #3a3530;
        }
        
        .analysis-text {
          margin-top: 24px;
          padding-top: 20px;
          border-top: 1px dashed #ddd8cc;
        }
        
        .result-body .md-h2 {
          font-family: 'Playfair Display', serif;
          font-size: 18px;
          color: #1a1a1a;
          margin: 20px 0 10px;
          padding-bottom: 6px;
          border-bottom: 1px solid #ddd8cc;
        }
        
        .result-body .md-h3 {
          font-size: 12px;
          font-weight: 700;
          letter-spacing: 1.5px;
          text-transform: uppercase;
          color: #2c4a8a;
          margin: 14px 0 8px;
          font-family: 'IBM Plex Mono', monospace;
        }
        
        .result-body .md-table {
          width: 100%;
          border-collapse: collapse;
          margin: 16px 0;
          font-size: 12px;
          font-family: 'IBM Plex Mono', monospace;
          border-top: 2px solid #1a1a1a;
          border-bottom: 2px solid #1a1a1a;
        }
        
        .result-body .md-table th {
          border-bottom: 1px solid #1a1a1a;
          padding: 8px 12px;
          text-align: center;
          background: #f7f5f0;
          font-weight: 600;
          color: #1a1a1a;
        }
        
        .result-body .md-table td {
          border-bottom: 1px solid #ddd8cc;
          padding: 6px 12px;
        }
        
        .result-body .md-table td:first-child {
          text-align: left;
          font-weight: 500;
        }
        
        .result-body .md-table td:not(:first-child) {
          text-align: right;
        }
        
        .result-body .md-table tbody tr:last-child td {
          border-bottom: 1px solid #1a1a1a;
        }
        
        .result-footer {
          padding: 16px 32px;
          border-top: 1px solid #ddd8cc;
          background: #f0ece3;
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        
        .export-btn {
          background: none;
          border: 1px solid #ddd8cc;
          border-radius: 5px;
          padding: 8px 16px;
          font-size: 12px;
          cursor: pointer;
          font-family: 'IBM Plex Mono', monospace;
          color: #8a8078;
        }
        
        .export-btn:hover {
          border-color: #2c4a8a;
          color: #2c4a8a;
        }
      `}</style>
    </div>
  );
}

function renderMarkdown(text) {
  let processed = text;
  
  const lines = processed.split('\n');
  let result = [];
  let inTable = false;
  let tableLines = [];
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    if (line.trim().startsWith('|')) {
      inTable = true;
      tableLines.push(line);
    } else if (inTable) {
      result.push(renderTable(tableLines));
      tableLines = [];
      inTable = false;
      result.push(line);
    } else {
      result.push(line);
    }
  }
  
  if (inTable && tableLines.length > 0) {
    result.push(renderTable(tableLines));
  }
  
  processed = result.join('\n');
  
  processed = processed
    .replace(/^## (.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^### (.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n\n/g, '<br/><br/>');
  
  return processed;
}

function renderTable(lines) {
  if (lines.length < 2) return lines.join('\n');
  
  const headerCells = lines[0].split('|').map(c => c.trim()).filter(c => c !== '');
  const bodyLines = lines.slice(1).filter(line => !line.match(/^\|[-|: ]+\|$/));
  const colCount = headerCells.length;
  
  let html = '<table class="md-table">';
  
  html += '<thead><tr>';
  headerCells.forEach((cell, idx) => {
    const align = idx === 0 ? 'left' : 'center';
    html += `<th style="text-align: ${align}">${cell}</th>`;
  });
  html += '</tr></thead>';
  
  html += '<tbody>';
  bodyLines.forEach(line => {
    const cells = line.split('|').map(c => c.trim()).filter(c => c !== '');
    html += '<tr>';
    cells.forEach((cell, idx) => {
      const align = idx === 0 ? 'left' : 'right';
      html += `<td style="text-align: ${align}">${cell}</td>`;
    });
    for (let i = cells.length; i < colCount; i++) {
      html += '<td></td>';
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  
  return html;
}
