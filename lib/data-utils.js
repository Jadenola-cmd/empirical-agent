export function parseCSV(csvString) {
  const lines = csvString.trim().split('\n');
  if (lines.length === 0) return { data: [], meta: { fields: [] } };
  
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const data = [];
  
  for (let i = 1; i < lines.length; i++) {
    const values = lines[i].split(',');
    const row = {};
    headers.forEach((header, index) => {
      row[header] = values[index]?.trim()?.replace(/^"|"$/g, '') || '';
    });
    data.push(row);
  }
  
  return {
    data,
    meta: {
      fields: headers,
      rowCount: data.length
    }
  };
}

export function stringifyCSV(data, headers) {
  if (!data || data.length === 0) return '';
  
  const headerRow = headers.join(',');
  const rows = data.map(row => 
    headers.map(h => {
      const val = row[h];
      return (typeof val === 'string' && (val.includes(',') || val.includes('"'))) 
        ? `"${val.replace(/"/g, '""')}"` 
        : val ?? '';
    }).join(',')
  );
  
  return [headerRow, ...rows].join('\n');
}

export function isNumeric(value) {
  if (value === '' || value === null || value === undefined) return false;
  return !isNaN(parseFloat(value)) && isFinite(value);
}

export function convertToNumber(value) {
  if (isNumeric(value)) {
    return parseFloat(value);
  }
  return null;
}

export function detectVariableTypes(data, fields) {
  const types = {};
  
  fields.forEach(field => {
    const values = data
      .map(row => row[field])
      .filter(v => v !== '' && v !== null && v !== undefined);
    
    if (values.length === 0) {
      types[field] = 'unknown';
      return;
    }
    
    const numericCount = values.filter(isNumeric).length;
    const isDate = /^\d{4}-\d{2}-\d{2}$/.test(values[0]) || 
                   /^\d{2}\/\d{2}\/\d{4}$/.test(values[0]);
    
    if (isDate) {
      types[field] = 'date';
    } else if (numericCount / values.length > 0.8) {
      types[field] = 'numeric';
    } else {
      types[field] = 'categorical';
    }
  });
  
  return types;
}

export function extractNumericColumn(data, field) {
  return data
    .map(row => convertToNumber(row[field]))
    .filter(v => v !== null);
}
