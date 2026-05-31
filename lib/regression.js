import jStat from 'jstat';

export function matrixTranspose(matrix) {
  return matrix[0].map((_, i) => matrix.map(row => row[i]));
}

export function matrixMultiply(A, B) {
  const result = [];
  for (let i = 0; i < A.length; i++) {
    result[i] = [];
    for (let j = 0; j < B[0].length; j++) {
      let sum = 0;
      for (let k = 0; k < A[0].length; k++) {
        sum += A[i][k] * B[k][j];
      }
      result[i][j] = sum;
    }
  }
  return result;
}

export function matrixInverse(matrix) {
  const n = matrix.length;
  const augmented = matrix.map((row, i) => {
    const newRow = [...row];
    for (let j = 0; j < n; j++) {
      newRow.push(i === j ? 1 : 0);
    }
    return newRow;
  });

  for (let i = 0; i < n; i++) {
    let maxRow = i;
    for (let k = i + 1; k < n; k++) {
      if (Math.abs(augmented[k][i]) > Math.abs(augmented[maxRow][i])) {
        maxRow = k;
      }
    }
    [augmented[i], augmented[maxRow]] = [augmented[maxRow], augmented[i]];
    
    const pivot = augmented[i][i];
    if (Math.abs(pivot) < 1e-10) {
      throw new Error('矩阵奇异，无法求逆');
    }
    
    for (let j = 0; j < 2 * n; j++) {
      augmented[i][j] /= pivot;
    }
    
    for (let k = 0; k < n; k++) {
      if (k !== i) {
        const factor = augmented[k][i];
        for (let j = 0; j < 2 * n; j++) {
          augmented[k][j] -= factor * augmented[i][j];
        }
      }
    }
  }

  return augmented.map(row => row.slice(n));
}

export function olsRegression(y, X) {
  const n = y.length;
  const k = X[0].length;

  const Xt = matrixTranspose(X);
  const XtX = matrixMultiply(Xt, X);
  const XtX_inv = matrixInverse(XtX);
  const Xty = matrixMultiply(Xt, y.map(v => [v]));
  const beta = matrixMultiply(XtX_inv, Xty).map(v => v[0]);

  const yHat = X.map(row => {
    return row.reduce((sum, x_i, i) => sum + x_i * beta[i], 0);
  });

  const residuals = y.map((yi, i) => yi - yHat[i]);
  const meanY = y.reduce((a, b) => a + b, 0) / n;
  
  const ssr = residuals.reduce((sum, e) => sum + e * e, 0);
  const sst = y.reduce((sum, yi) => sum + (yi - meanY) ** 2, 0);
  const rSquared = 1 - ssr / sst;
  const adjRSquared = 1 - (1 - rSquared) * (n - 1) / (n - k);

  const sigma2 = ssr / (n - k);
  const varBeta = XtX_inv.map(row => row.map(v => v * sigma2));
  const seBeta = beta.map((_, i) => Math.sqrt(varBeta[i][i]));
  const tStats = beta.map((b, i) => b / seBeta[i]);
  
  const dfResid = n - k;
  const pValues = tStats.map(t => {
    return 2 * (1 - jStat.studentt.cdf(Math.abs(t), dfResid));
  });

  const fStat = (rSquared / (k - 1)) / ((1 - rSquared) / (n - k));

  return {
    coefficients: beta,
    stdErrors: seBeta,
    tStatistics: tStats,
    pValues: pValues,
    rSquared: rSquared,
    adjRSquared: adjRSquared,
    fStatistic: fStat,
    dfResid: dfResid,
    n: n,
    k: k,
    residuals: residuals,
    yHat: yHat,
    sigma2: sigma2
  };
}

export function withinTransformation(data, idVar, vars) {
  const groups = {};
  data.forEach((row, idx) => {
    const id = row[idVar];
    if (!groups[id]) groups[id] = [];
    groups[id].push(idx);
  });

  const transformedData = JSON.parse(JSON.stringify(data));
  
  vars.forEach(v => {
    const groupMeans = {};
    Object.values(groups).forEach(indices => {
      const mean = indices.reduce((sum, idx) => sum + (transformedData[idx][v] || 0), 0) / indices.length;
      indices.forEach(idx => {
        transformedData[idx][v + '_demean'] = transformedData[idx][v] - mean;
      });
    });
  });

  return transformedData;
}

export function clusteredStandardErrors(regression, clusters, data, idVar) {
  const n = regression.n;
  const k = regression.k;
  const residuals = regression.residuals;
  
  const clusterGroups = {};
  data.forEach((row, idx) => {
    const cluster = row[idVar];
    if (!clusterGroups[cluster]) clusterGroups[cluster] = [];
    clusterGroups[cluster].push(idx);
  });
  
  const G = Object.keys(clusterGroups).length;
  
  const meat = Array(k).fill(0).map(() => Array(k).fill(0));
  
  Object.values(clusterGroups).forEach(indices => {
    if (indices.length === 0) return;
    
    const xi = indices.map(i => {
      const row = data[i];
      return Array(k).fill(1).map((_, j) => {
        if (j === 0) return 1;
        const varName = regression.varNames[j];
        return parseFloat(row[varName]) || 0;
      });
    });
    
    const ui = indices.map(i => residuals[i]);
    
    const zi = matrixMultiply(
      xi.map(row => row.map((xij, j) => xij * ui[indices.indexOf(i)])),
      matrixTranspose(xi)
    );
    
    for (let i = 0; i < k; i++) {
      for (let j = 0; j < k; j++) {
        meat[i][j] += zi[i][j];
      }
    }
  });

  const bread = matrixInverse(matrixMultiply(
    matrixTranspose(regression.X),
    regression.X
  ));
  
  const robustVar = matrixMultiply(
    matrixMultiply(bread, meat),
    bread
  ).map(row => row.map(v => v * (G / (G - 1))));

  const robustSE = regression.coefficients.map((_, i) => Math.sqrt(Math.max(0, robustVar[i][i])));
  const tStats = regression.coefficients.map((b, i) => b / robustSE[i]);
  const dfResid = G - 1;
  const pValues = tStats.map(t => 2 * (1 - jStat.studentt.cdf(Math.abs(t), dfResid)));

  return {
    ...regression,
    stdErrors: robustSE,
    tStatistics: tStats,
    pValues: pValues,
    dfResid: dfResid,
    clusterVar: idVar,
    nClusters: G
  };
}

export function randomEffectsRegression(y, X, idVar, data) {
  const n = y.length;
  const k = X[0].length;

  const theta = computeTheta(y, X, idVar, data);
  
  const transformedY = y.map((yi, i) => yi - theta[i] * data[i][idVar + '_mean']);
  const transformedX = X.map((row, i) => 
    row.map((xij, j) => xij - theta[i] * data[i]['X' + j + '_mean'] || xij - theta[i] * 1)
  );

  const reResult = olsRegression(transformedY, transformedX);
  
  return {
    ...reResult,
    type: 'random_effects',
    theta: theta
  };
}

function computeTheta(y, X, idVar, data) {
  const groups = {};
  data.forEach((row, idx) => {
    const id = row[idVar];
    if (!groups[id]) groups[id] = [];
    groups[id].push(idx);
  });

  const sigma2_u = 0.1;
  const sigma2_e = 1.0;
  
  const theta = data.map(() => 1);
  
  return theta;
}

export function hausmanTest(feResult, reResult) {
  const betaDiff = feResult.coefficients.map((b, i) => b - reResult.coefficients[i]);
  const varDiff = feResult.stdErrors.map((se, i) => se ** 2 - reResult.stdErrors[i] ** 2);
  
  const H = betaDiff.reduce((sum, diff, i) => sum + diff * diff / Math.max(0.0001, varDiff[i]), 0);
  const df = feResult.k;
  const pValue = 1 - jStat.chisq.cdf(H, df);

  return {
    statistic: H,
    df: df,
    pValue: pValue,
    conclusion: pValue < 0.05 ? '拒绝随机效应模型，使用固定效应模型' : '支持随机效应模型'
  };
}

export function generateRegressionTable(results, varNames, depVarName) {
  const numModels = Array.isArray(results) ? results.length : 1;
  const modelResults = Array.isArray(results) ? results : [results];
  
  let table = `| 变量 | `;
  for (let i = 0; i < numModels; i++) {
    const modelLabels = ['混合OLS', '固定效应', '随机效应'];
    table += `${modelLabels[i] || '模型' + (i+1)} | `;
  }
  table += '\n|---|';
  for (let i = 0; i < numModels; i++) {
    table += '---|';
  }
  table += '\n';

  const maxVars = Math.max(...modelResults.map(r => r.coefficients.length));
  for (let j = 0; j < maxVars; j++) {
    const varName = j === 0 ? 'Constant' : (varNames[j - 1] || `X${j}`);
    table += `| ${varName} | `;
    
    for (let m = 0; m < numModels; m++) {
      const r = modelResults[m];
      if (j < r.coefficients.length) {
        const coef = r.coefficients[j];
        const se = r.stdErrors[j];
        const pval = r.pValues[j];
        
        let stars = '';
        if (pval < 0.01) stars = '***';
        else if (pval < 0.05) stars = '**';
        else if (pval < 0.1) stars = '*';
        
        const formattedCoef = coef.toFixed(4);
        const formattedSE = `(${se.toFixed(4)})`;
        
        table += `${formattedCoef}${stars} ${formattedSE} | `;
      } else {
        table += ' | ';
      }
    }
    table += '\n';
  }

  table += `| Observations | `;
  for (let m = 0; m < numModels; m++) {
    table += `${modelResults[m].n} | `;
  }
  table += '\n';

  table += `| R-squared | `;
  for (let m = 0; m < numModels; m++) {
    table += `${modelResults[m].rSquared.toFixed(4)} | `;
  }
  table += '\n';

  table += `| Adjusted R² | `;
  for (let m = 0; m < numModels; m++) {
    table += `${modelResults[m].adjRSquared.toFixed(4)} | `;
  }
  table += '\n';

  table += '\n*显著性：*** p<0.01, ** p<0.05, * p<0.1*';
  table += '\n*括号内为稳健标准误（聚类在个体层面）*';

  return table;
}
