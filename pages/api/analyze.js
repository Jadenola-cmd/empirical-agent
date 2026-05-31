export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).end();

  const { dataStr, totalRows, sampleSize, analysisType, varSpec, customQ, fields } = req.body;

  const analysisLabels = {
    descriptive: "描述性统计与相关性分析",
    regression: "OLS回归分析",
    timeseries: "时间序列分析",
    ml: "机器学习预测分析",
  };

  const systemPrompt = `你是一位严谨的计量经济学和数据科学专家，专门协助学术论文实证分析。

重要：不要生成表格！只输出原始数值，表格将由程序自动生成。

对于回归分析，输出格式如下（每个模型用空行分隔）：
[REGRESSION_START]
模型1: 因变量=Y, 自变量=X1,X2, 样本量=${sampleSize}
coef: X1=数值, X2=数值, constant=数值
se: X1=数值, X2=数值, constant=数值
pvalue: X1=数值, X2=数值, constant=数值
r_squared=数值
f_statistic=数值
[REGRESSION_END]

描述性统计格式：
[DESCRIPTIVE_START]
变量名, N, 均值, 标准差, 最小值, 最大值
[DESCRIPTIVE_END]

要求：
1. 所有数值保留4位小数
2. 不要输出任何星号(*)或特殊符号标记显著性
3. 用中文给出统计结果的解读和分析结论
4. 包括：结果摘要、统计显著性判断、经济学含义、稳健性建议
5. 如数据只是样本，注明"注：以上结果基于前${sampleSize}行数据估算"
6. 语言：专业学术中文`;

  const userPrompt = `分析类型：${analysisLabels[analysisType]}
数据规模：共${totalRows}行 × ${fields}列${varSpec || ""}

数据样本（前${sampleSize}行）：
\`\`\`csv
${dataStr}
\`\`\`
${customQ ? `\n用户附加要求：${customQ}` : ""}

请进行${analysisLabels[analysisType]}，给出可直接用于学术论文的规范结果。`;

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
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    const text = data.choices?.[0]?.message?.content || "分析失败";
    res.status(200).json({ text });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
