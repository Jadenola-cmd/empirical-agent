export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { dataStr, totalRows, sampleSize, analysisType, varSpec, customQ, fields } = req.body;

  const systemPrompt = `你是计量经济学专家。你必须严格按照指定JSON格式返回数据，不得输出任何JSON以外的内容，不要有任何说明文字、markdown符号或代码块标记。`;

  const prompts = {
    descriptive: `分析以下数据，返回描述性统计和相关系数矩阵。

数据（共${totalRows}行，样本${sampleSize}行）：
${dataStr}

严格按以下JSON格式返回，不输出任何其他内容：
{
  "type": "descriptive",
  "title": "描述性统计与相关性分析",
  "descriptive": {
    "vars": [
      {"name": "变量名", "obs": 100, "mean": 1.234, "sd": 0.567, "min": 0.100, "median": 1.200, "max": 3.400}
    ]
  },
  "correlation": {
    "vars": ["变量1", "变量2"],
    "matrix": [
      [{"coef": 1.000, "sig": ""}, {"coef": 0.532, "sig": "***"}],
      [{"coef": 0.532, "sig": "***"}, {"coef": 1.000, "sig": ""}]
    ]
  },
  "notes": "显著性说明：***p<0.01, **p<0.05, *p<0.1",
  "interpretation": "用2-3句话描述主要发现"
}`,

    regression: `分析以下数据，进行OLS回归分析。
${varSpec || ""}

数据（共${totalRows}行，样本${sampleSize}行）：
${dataStr}
${customQ ? `\n附加要求：${customQ}` : ""}

严格按以下JSON格式返回，不输出任何其他内容：
{
  "type": "regression",
  "title": "回归分析结果",
  "models": [
    {
      "name": "(1)",
      "depvar": "被解释变量名",
      "coefficients": [
        {"var": "变量名", "coef": 0.234, "se": 0.056, "t": 4.18, "sig": "***", "is_control": false}
      ],
      "cons": {"coef": -1.133, "se": 1.234, "t": -0.65, "sig": ""},
      "n": 200,
      "r2": 0.091,
      "r2_a": 0.090,
      "f": 2382.951,
      "ind_fe": "No",
      "year_fe": "Yes"
    }
  ],
  "notes": "括号内为t值，***p<0.01, **p<0.05, *p<0.1",
  "interpretation": "用3-4句话描述主要回归结果和经济学含义"
}`,

    timeseries: `分析以下时间序列数据。

数据（共${totalRows}行，样本${sampleSize}行）：
${dataStr}
${customQ ? `\n附加要求：${customQ}` : ""}

严格按以下JSON格式返回：
{
  "type": "timeseries",
  "title": "时间序列分析结果",
  "stationarity": [
    {"var": "变量名", "adf_stat": -3.45, "p_value": 0.012, "conclusion": "平稳"}
  ],
  "autocorrelation": [
    {"lag": 1, "acf": 0.234, "pacf": 0.198, "sig": "***"}
  ],
  "model_suggestion": "ARIMA(1,1,1)",
  "notes": "***p<0.01, **p<0.05, *p<0.1",
  "interpretation": "用3-4句话描述时间序列特征和建议"
}`,

    ml: `分析以下数据的机器学习预测潜力。

数据（共${totalRows}行，样本${sampleSize}行）：
${dataStr}
${customQ ? `\n附加要求：${customQ}` : ""}

严格按以下JSON格式返回：
{
  "type": "ml",
  "title": "机器学习预测分析",
  "feature_importance": [
    {"var": "变量名", "importance": 0.234, "rank": 1}
  ],
  "model_comparison": [
    {"model": "Random Forest", "rmse": 0.123, "r2": 0.789, "recommendation": true}
  ],
  "diagnostics": {
    "overfitting_risk": "低",
    "sample_size_adequacy": "充足",
    "missing_rate": "2.3%"
  },
  "notes": "基于样本数据估算",
  "interpretation": "用3-4句话描述预测分析建议"
}`
  };

  const userPrompt = prompts[analysisType] || prompts.descriptive;

  try {
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${process.env.DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: "deepseek-v4-flash",
        max_tokens: 4000,
        temperature: 0.1,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    let text = data.choices?.[0]?.message?.content || "{}";
    // Strip markdown code blocks if present
    text = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    
    // Validate JSON
    const parsed = JSON.parse(text);
    res.status(200).json({ result: parsed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
