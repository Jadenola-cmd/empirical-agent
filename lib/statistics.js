import { extractNumericColumn, convertToNumber } from './data-utils';

export function descriptiveStats(data, fields) {
  const stats = {};
  
  fields.forEach(field => {
    const numericValues = extractNumericColumn(data, field);
    if (numericValues.length > 0) {
      const n = numericValues.length;
      const mean = numericValues.reduce((a, b) => a + b, 0) / n;
      const variance = numericValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
      const std = Math.sqrt(variance);
      const sorted = [...numericValues].sort((a, b) => a - b);
      const min = sorted[0];
      const max = sorted[sorted.length - 1];
      const median = n % 2 
        ? sorted[Math.floor(n / 2)] 
        : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
      const p25 = sorted[Math.floor(n * 0.25)];
      const p75 = sorted[Math.floor(n * 0.75)];
      
      stats[field] = {
        n,
        mean: mean.toFixed(4),
        std: std.toFixed(4),
        min: min.toFixed(4),
        max: max.toFixed(4),
        median: median.toFixed(4),
        p25: p25.toFixed(4),
        p75: p75.toFixed(4)
      };
    }
  });
  
  return stats;
}

export function correlationMatrix(data, fields, method = 'pearson') {
  const matrix = {};
  const numericFields = fields.filter(field => {
    const vals = extractNumericColumn(data, field);
    return vals.length > 0;
  });
  
  for (let i = 0; i < numericFields.length; i++) {
    const fieldX = numericFields[i];
    const valuesX = extractNumericColumn(data, fieldX);
    const meanX = valuesX.reduce((a, b) => a + b, 0) / valuesX.length;
    const stdX = Math.sqrt(valuesX.reduce((sum, v) => sum + (v - meanX) ** 2, 0) / valuesX.length);
    
    matrix[fieldX] = {};
    
    for (let j = 0; j < numericFields.length; j++) {
      const fieldY = numericFields[j];
      const valuesY = extractNumericColumn(data, fieldY);
      const meanY = valuesY.reduce((a, b) => a + b, 0) / valuesY.length;
      const stdY = Math.sqrt(valuesY.reduce((sum, v) => sum + (v - meanY) ** 2, 0) / valuesY.length);
      
      const n = Math.min(valuesX.length, valuesY.length);
      let cov = 0;
      
      for (let k = 0; k < n; k++) {
        cov += (valuesX[k] - meanX) * (valuesY[k] - meanY);
      }
      
      cov /= n;
      const correlation = cov / (stdX * stdY);
      const t = Math.abs(correlation) * Math.sqrt((n - 2) / (1 - correlation * correlation));
      const df = n - 2;
      const pValue = 2 * (1 - tcdf(Math.abs(t), df));
      
      matrix[fieldX][fieldY] = {
        coefficient: correlation,
        pValue: pValue,
        n: n
      };
    }
  }
  
  return matrix;
}

export function tcdf(t, df) {
  const x = df / (t * t + df);
  return 1 - 0.5 * Math.pow(x, df / 2);
}

export function generateDescriptiveTable(stats) {
  const fields = Object.keys(stats);
  
  let table = '| 变量 | N | 均值 | 标准差 | 最小值 | 25%分位 | 中位数 | 75%分位 | 最大值 |\n';
  table += '|------|---|------|--------|--------|---------|--------|---------|--------|\n';
  
  fields.forEach(field => {
    const s = stats[field];
    table += `| ${field} | ${s.n} | ${s.mean} | ${s.std} | ${s.min} | ${s.p25} | ${s.median} | ${s.p75} | ${s.max} |\n`;
  });
  
  return table;
}

export function generateCorrelationTable(corrMatrix) {
  const fields = Object.keys(corrMatrix);
  
  let table = '| ' + fields.join(' | ') + ' |\n';
  table += '|' + Array(fields.length + 1).join('-----|') + '\n';
  
  fields.forEach((rowField, i) => {
    let row = '| ' + rowField + ' |';
    fields.forEach((colField, j) => {
      if (i === j) {
        row += ' 1.000 |';
      } else {
        const corr = corrMatrix[rowField][colField];
        let cell = corr.coefficient.toFixed(3);
        if (corr.pValue < 0.01) cell += '***';
        else if (corr.pValue < 0.05) cell += '**';
        else if (corr.pValue < 0.1) cell += '*';
        row += ` ${cell} |`;
      }
    });
    table += row + '\n';
  });
  
  table += '\n注：*** p<0.01, ** p<0.05, * p<0.1\n';
  
  return table;
}

export function diagnoseSingularMatrix(data, depVar, indepVars) {
  const diagnosis = {
    variables: [depVar, ...indepVars],
    sampleStats: {},
    constantColumns: [],
    duplicateVariables: [],
    highCorrelations: [],
    xMatrixDimensions: null,
    sampleN: data.length,
    kVariables: indepVars.length + 1 // +1 for intercept
  };

  // 检查每个变量的统计信息
  [...indepVars].forEach(varName => {
    const values = extractNumericColumn(data, varName);
    const n = values.length;
    
    if (n > 0) {
      const mean = values.reduce((a, b) => a + b, 0) / n;
      const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / n;
      const std = Math.sqrt(variance);
      
      diagnosis.sampleStats[varName] = {
        n: n,
        mean: mean.toFixed(4),
        std: std.toFixed(4),
        min: Math.min(...values).toFixed(4),
        max: Math.max(...values).toFixed(4),
        isConstant: std < 1e-10
      };

      // 检查是否为常数列
      if (std < 1e-10) {
        diagnosis.constantColumns.push(varName);
      }
    }
  });

  // 检查完全重复变量
  for (let i = 0; i < indepVars.length; i++) {
    for (let j = i + 1; j < indepVars.length; j++) {
      const var1 = indepVars[i];
      const var2 = indepVars[j];
      const vals1 = data.map(row => parseFloat(row[var1]) || 0);
      const vals2 = data.map(row => parseFloat(row[var2]) || 0);
      
      const areDuplicates = vals1.every((v, idx) => Math.abs(v - vals2[idx]) < 1e-10);
      
      if (areDuplicates) {
        diagnosis.duplicateVariables.push([var1, var2]);
      }
    }
  }

  // 检查高度共线性
  if (indepVars.length > 1) {
    const corr = correlationMatrix(data, indepVars);
    const fields = Object.keys(corr);
    
    for (let i = 0; i < fields.length; i++) {
      for (let j = i + 1; j < fields.length; j++) {
        const correlation = corr[fields[i]][fields[j]]?.coefficient;
        if (correlation !== undefined && Math.abs(correlation) > 0.95) {
          diagnosis.highCorrelations.push({
            var1: fields[i],
            var2: fields[j],
            correlation: correlation.toFixed(4)
          });
        }
      }
    }
  }

  // X矩阵维度
  diagnosis.xMatrixDimensions = {
    rows: data.length,
    columns: indepVars.length + 1 // intercept + variables
  };

  // 确定导致问题的变量
  if (diagnosis.constantColumns.length > 0) {
    diagnosis.probableCause = `常数列: ${diagnosis.constantColumns.join(', ')}`;
    diagnosis.suggestion = `请移除常数列或选择其他变量`;
  } else if (diagnosis.duplicateVariables.length > 0) {
    const duplicates = diagnosis.duplicateVariables[0];
    diagnosis.probableCause = `完全重复变量: ${duplicates[0]} 和 ${duplicates[1]}`;
    diagnosis.suggestion = `请移除其中一个重复变量`;
  } else if (diagnosis.highCorrelations.length > 0) {
    const highCorr = diagnosis.highCorrelations[0];
    diagnosis.probableCause = `高度共线性变量: ${highCorr.var1} 和 ${highCorr.var2} (相关系数=${highCorr.correlation})`;
    diagnosis.suggestion = `请移除其中一个高度相关变量或使用因子分析降维`;
  } else if (diagnosis.xMatrixDimensions.columns > diagnosis.xMatrixDimensions.rows) {
    diagnosis.probableCause = `变量个数超过样本数`;
    diagnosis.suggestion = `请减少变量个数或增加样本数`;
  } else {
    diagnosis.probableCause = `存在其他多重共线性问题`;
    diagnosis.suggestion = `请尝试移除部分变量或使用岭回归`;
  }

  return diagnosis;
}
