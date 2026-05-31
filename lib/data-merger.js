import { extractNumericColumn, isNumeric, convertToNumber } from './data-utils';

export function mergeDataHorizontal(datasets, keyFields) {
  if (datasets.length === 0) return { data: [], meta: { fields: [] } };
  if (datasets.length === 1) return datasets[0];
  
  let mergedData = [...datasets[0].data];
  let mergedFields = new Set(datasets[0].meta.fields);
  
  for (let i = 1; i < datasets.length; i++) {
    const dataset = datasets[i];
    
    const mergedByKey = new Map();
    
    mergedData.forEach(row => {
      const key = keyFields.map(k => row[k] ?? '').join('|');
      mergedByKey.set(key, row);
    });
    
    dataset.data.forEach(row => {
      const key = keyFields.map(k => row[k] ?? '').join('|');
      const existingRow = mergedByKey.get(key);
      
      if (existingRow) {
        Object.keys(row).forEach(field => {
          if (!keyFields.includes(field)) {
            existingRow[field] = row[field];
            mergedFields.add(field);
          }
        });
      }
    });
    
    mergedData = Array.from(mergedByKey.values());
  }
  
  return {
    data: mergedData,
    meta: {
      fields: Array.from(mergedFields),
      rowCount: mergedData.length
    },
    mergeLog: {
      mergedDatasets: datasets.length,
      totalRows: mergedData.length,
      keyFields: keyFields
    }
  };
}

export function mergeDataVertical(datasets, checkConsistency = true) {
  if (datasets.length === 0) return { data: [], meta: { fields: [] } };
  if (datasets.length === 1) return datasets[0];
  
  let allFields = new Set();
  datasets.forEach(ds => ds.meta.fields.forEach(f => allFields.add(f)));
  allFields = Array.from(allFields);
  
  if (checkConsistency) {
    let isConsistent = true;
    for (let i = 1; i < datasets.length; i++) {
      if (datasets[i].meta.fields.length !== datasets[0].meta.fields.length) {
        isConsistent = false;
        break;
      }
      const fieldsMatch = datasets[i].meta.fields.every(
        f => datasets[0].meta.fields.includes(f)
      );
      if (!fieldsMatch) {
        isConsistent = false;
        break;
      }
    }
  }
  
  const mergedData = datasets.flatMap(ds => 
    ds.data.map(row => {
      const newRow = {};
      allFields.forEach(field => {
        newRow[field] = row[field] ?? '';
      });
      return newRow;
    })
  );
  
  return {
    data: mergedData,
    meta: {
      fields: allFields,
      rowCount: mergedData.length
    },
    mergeLog: {
      mergedDatasets: datasets.length,
      totalRows: mergedData.length,
      fieldsConsistent: datasets.every(
        ds => JSON.stringify(ds.meta.fields.sort()) === 
             JSON.stringify(datasets[0].meta.fields.sort())
      )
    }
  };
}
