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
