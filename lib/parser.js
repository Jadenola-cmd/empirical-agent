export function getSignificanceStars(pvalue) {
  const p = parseFloat(pvalue);
  if (isNaN(p)) return '';
  if (p < 0.01) return '***';
  if (p < 0.05) return '**';
  if (p < 0.1) return '*';
  return '';
}

export function formatNumber(num, decimals = 4) {
  const n = parseFloat(num);
  if (isNaN(n)) return '';
  if (Math.abs(n) >= 1000) {
    return n.toExponential(decimals);
  }
  return n.toFixed(decimals);
}

export function parseRegressionOutput(text) {
  const models = [];
  const regex = /\[REGRESSION_START\]([\s\S]*?)\[REGRESSION_END\]/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const modelBlock = match[1].trim();
    const model = {
      variables: [],
      r_squared: null,
      f_statistic: null,
      sample_size: null
    };
    
    const lines = modelBlock.split('\n');
    let currentModelName = '';
    
    for (const line of lines) {
      const trimmed = line.trim();
      
      if (trimmed.startsWith('模型') && trimmed.includes(':')) {
        const parts = trimmed.split(',');
        if (parts.length >= 3) {
          const sampleMatch = parts[parts.length - 1].match(/样本量=(\d+)/);
          if (sampleMatch) {
            model.sample_size = parseInt(sampleMatch[1]);
          }
        }
      }
      
      if (trimmed.startsWith('coef:')) {
        const coefStr = trimmed.replace('coef:', '').trim();
        const pairs = coefStr.split(',').map(s => s.trim());
        
        for (const pair of pairs) {
          const [varName, value] = pair.split('=').map(s => s.trim());
          if (varName && value) {
            const existingVar = model.variables.find(v => v.name === varName);
            if (existingVar) {
              existingVar.coef = parseFloat(value);
            } else {
              model.variables.push({ name: varName, coef: parseFloat(value) });
            }
          }
        }
      }
      
      if (trimmed.startsWith('se:')) {
        const seStr = trimmed.replace('se:', '').trim();
        const pairs = seStr.split(',').map(s => s.trim());
        
        for (const pair of pairs) {
          const [varName, value] = pair.split('=').map(s => s.trim());
          if (varName && value) {
            const existingVar = model.variables.find(v => v.name === varName);
            if (existingVar) {
              existingVar.se = parseFloat(value);
            }
          }
        }
      }
      
      if (trimmed.startsWith('pvalue:')) {
        const pvalStr = trimmed.replace('pvalue:', '').trim();
        const pairs = pvalStr.split(',').map(s => s.trim());
        
        for (const pair of pairs) {
          const [varName, value] = pair.split('=').map(s => s.trim());
          if (varName && value) {
            const existingVar = model.variables.find(v => v.name === varName);
            if (existingVar) {
              existingVar.pvalue = parseFloat(value);
            }
          }
        }
      }
      
      if (trimmed.startsWith('r_squared=')) {
        const rsqMatch = trimmed.match(/r_squared=([\d.]+)/);
        if (rsqMatch) {
          model.r_squared = parseFloat(rsqMatch[1]);
        }
      }
      
      if (trimmed.startsWith('f_statistic=')) {
        const fMatch = trimmed.match(/f_statistic=([\d.]+)/);
        if (fMatch) {
          model.f_statistic = parseFloat(fMatch[1]);
        }
      }
    }
    
    if (model.variables.length > 0) {
      models.push(model);
    }
  }
  
  return models;
}

export function parseDescriptiveStats(text) {
  const stats = [];
  const regex = /\[DESCRIPTIVE_START\]([\s\S]*?)\[DESCRIPTIVE_END\]/g;
  let match;
  
  while ((match = regex.exec(text)) !== null) {
    const block = match[1].trim();
    const lines = block.split('\n').filter(line => {
      const trimmed = line.trim();
      return trimmed && !trimmed.startsWith('[') && !trimmed.includes('变量名') && !trimmed.includes('N,');
    });
    
    for (const line of lines) {
      const cells = line.split(',').map(s => s.trim());
      if (cells.length >= 6) {
        stats.push({
          name: cells[0],
          n: parseInt(cells[1]),
          mean: parseFloat(cells[2]),
          std: parseFloat(cells[3]),
          min: parseFloat(cells[4]),
          max: parseFloat(cells[5])
        });
      }
    }
  }
  
  return stats;
}

export function generateRegressionMarkdown(models) {
  if (!models || models.length === 0) return '';
  
  let md = '';
  
  for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
    const model = models[modelIdx];
    
    const numCols = modelIdx + 1;
    
    md += '\n\n| 变量 | ';
    for (let i = 0; i < numCols; i++) {
      md += `模型${i + 1} | `;
    }
    md += '\n|---|';
    for (let i = 0; i < numCols; i++) {
      md += '---|';
    }
    md += '\n';
    
    for (const variable of model.variables) {
      const coefStr = formatNumber(variable.coef);
      const seStr = formatNumber(variable.se);
      const stars = getSignificanceStars(variable.pvalue);
      
      md += `| ${variable.name} | `;
      for (let i = 0; i < numCols; i++) {
        if (i === modelIdx) {
          md += `${coefStr}${stars}<br/>(${seStr}) | `;
        } else {
          md += ' | ';
        }
      }
      md += '\n';
    }
    
    md += `| Observations | `;
    for (let i = 0; i < numCols; i++) {
      if (i === modelIdx) {
        md += `${model.sample_size || 'N/A'} | `;
      } else {
        md += ' | ';
      }
    }
    md += '\n';
    
    md += `| R-squared | `;
    for (let i = 0; i < numCols; i++) {
      if (i === modelIdx) {
        md += `${formatNumber(model.r_squared)} | `;
      } else {
        md += ' | ';
      }
    }
    md += '\n';
    
    md += `| F-statistic | `;
    for (let i = 0; i < numCols; i++) {
      if (i === modelIdx) {
        md += `${formatNumber(model.f_statistic)} | `;
      } else {
        md += ' | ';
      }
    }
    md += '\n';
    
    md += '\n*显著性：*** p<0.01, ** p<0.05, * p<0.1*\n';
  }
  
  return md;
}

export function generateDescriptiveMarkdown(stats) {
  if (!stats || stats.length === 0) return '';
  
  let md = '\n\n| 变量 | N | 均值 | 标准差 | 最小值 | 最大值 |\n';
  md += '|---|---|---|---|---|---|\n';
  
  for (const stat of stats) {
    md += `| ${stat.name} | ${stat.n} | ${formatNumber(stat.mean)} | ${formatNumber(stat.std)} | ${formatNumber(stat.min)} | ${formatNumber(stat.max)} |\n`;
  }
  
  return md;
}

export function processAnalysisText(text, analysisType) {
  if (analysisType === 'regression') {
    const models = parseRegressionOutput(text);
    const tableMd = generateRegressionMarkdown(models);
    
    const analysisText = text.replace(/\[[A-Z_]+\][\s\S]*?\[[A-Z_]+\]/g, '').trim();
    
    return {
      tables: tableMd,
      analysis: analysisText
    };
  }
  
  if (analysisType === 'descriptive') {
    const stats = parseDescriptiveStats(text);
    const tableMd = generateDescriptiveMarkdown(stats);
    
    const analysisText = text.replace(/\[[A-Z_]+\][\s\S]*?\[[A-Z_]+\]/g, '').trim();
    
    return {
      tables: tableMd,
      analysis: analysisText
    };
  }
  
  return {
    tables: '',
    analysis: text
  };
}
