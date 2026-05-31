import { extractNumericColumn, isNumeric, convertToNumber } from './data-utils';

export function detectMissingValues(data, fields) {
  const missingReport = {};
  
  fields.forEach(field => {
    let missingCount = 0;
    data.forEach(row => {
      const value = row[field];
      if (value === '' || value === null || value === undefined || value === 'NA' || value === 'N/A') {
        missingCount++;
      }
    });
    missingReport[field] = {
      count: missingCount,
      ratio: missingCount / data.length,
      percentage: ((missingCount / data.length) * 100).toFixed(1) + '%'
    };
  });
  
  return missingReport;
}

export function dropMissingValues(data, fields = null) {
  const fieldsToCheck = fields || Object.keys(data[0] || {});
  
  const filteredData = data.filter(row => {
    return fieldsToCheck.every(field => {
      const value = row[field];
      return value !== '' && value !== null && value !== undefined && 
             value !== 'NA' && value !== 'N/A';
    });
  });
  
  return {
    data: filteredData,
    log: {
      originalCount: data.length,
      finalCount: filteredData.length,
      droppedCount: data.length - filteredData.length
    }
  };
}

export function imputeMissingValues(data, fields, strategy = 'mean') {
  const resultData = JSON.parse(JSON.stringify(data));
  const imputeValues = {};
  
  fields.forEach(field => {
    const values = extractNumericColumn(resultData, field);
    
    if (values.length > 0) {
      switch (strategy) {
        case 'mean':
          imputeValues[field] = values.reduce((a, b) => a + b, 0) / values.length;
          break;
        case 'median':
          imputeValues[field] = getMedian(values);
          break;
        case 'mode':
          imputeValues[field] = getMode(values);
          break;
        default:
          if (!isNaN(parseFloat(strategy))) {
            imputeValues[field] = parseFloat(strategy);
          }
      }
    }
  });
  
  resultData.forEach(row => {
    fields.forEach(field => {
      const value = row[field];
      if (value === '' || value === null || value === undefined || value === 'NA' || value === 'N/A') {
        if (imputeValues[field] !== undefined) {
          row[field] = imputeValues[field];
        }
      }
    });
  });
  
  return {
    data: resultData,
    imputeValues: imputeValues
  };
}

export function getMedian(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function getMode(values) {
  const counts = {};
  values.forEach(v => {
    counts[v] = (counts[v] || 0) + 1;
  });
  return Object.keys(counts).reduce((a, b) => counts[a] > counts[b] ? a : b, values[0]);
}

export function winsorize(data, field, lowerPercentile = 0.01, upperPercentile = 0.99) {
  const numericValues = extractNumericColumn(data, field);
  if (numericValues.length === 0) return { data, log: null };
  
  const sorted = [...numericValues].sort((a, b) => a - b);
  const lowerIndex = Math.floor(sorted.length * lowerPercentile);
  const upperIndex = Math.ceil(sorted.length * upperPercentile) - 1;
  
  const lowerBound = sorted[lowerIndex];
  const upperBound = sorted[upperIndex];
  
  const resultData = JSON.parse(JSON.stringify(data));
  let modifiedCount = 0;
  
  resultData.forEach(row => {
    const val = convertToNumber(row[field]);
    if (val !== null) {
      if (val < lowerBound) {
        row[field] = lowerBound;
        modifiedCount++;
      } else if (val > upperBound) {
        row[field] = upperBound;
        modifiedCount++;
      }
    }
  });
  
  return {
    data: resultData,
    log: {
      field: field,
      lowerBound: lowerBound,
      upperBound: upperBound,
      modifiedCount: modifiedCount
    }
  };
}

export function detectOutliers(data, field, method = 'iqr', threshold = 3) {
  const numericValues = extractNumericColumn(data, field);
  if (numericValues.length === 0) return { outliers: [], indices: [] };
  
  if (method === 'iqr') {
    const sorted = [...numericValues].sort((a, b) => a - b);
    const q1 = sorted[Math.floor(sorted.length * 0.25)];
    const q3 = sorted[Math.floor(sorted.length * 0.75)];
    const iqr = q3 - q1;
    const lower = q1 - 1.5 * iqr;
    const upper = q3 + 1.5 * iqr;
    
    const outlierIndices = [];
    const outliers = [];
    data.forEach((row, idx) => {
      const val = convertToNumber(row[field]);
      if (val !== null && (val < lower || val > upper)) {
        outliers.push(val);
        outlierIndices.push(idx);
      }
    });
    
    return {
      method: 'iqr',
      bounds: { lower, upper },
      outliers,
      outlierIndices,
      count: outliers.length
    };
  } else {
    const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;
    const std = Math.sqrt(numericValues.reduce((sum, v) => sum + (v - mean) ** 2, 0) / numericValues.length);
    const lower = mean - threshold * std;
    const upper = mean + threshold * std;
    
    const outlierIndices = [];
    const outliers = [];
    data.forEach((row, idx) => {
      const val = convertToNumber(row[field]);
      if (val !== null && (val < lower || val > upper)) {
        outliers.push(val);
        outlierIndices.push(idx);
      }
    });
    
    return {
      method: 'std',
      bounds: { lower, upper, mean, std },
      outliers,
      outlierIndices,
      count: outliers.length
    };
  }
}
