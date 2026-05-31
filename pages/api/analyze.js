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

输出要求：
1. 使用标准学术格式，结果可直接用于论文
2. 使用标准Markdown表格格式，必须严格遵守：
   - 每一行用 | 开头和结尾
   - 必须包含表头行和分隔行（|---|---|---|）
   - 回归表格格式：
     | 变量 | 模型1 | 模型2 |
     |---|---|---|
     | X1 | 0.123***<br>(0.045) | 0.098**<br>(0.042) |
     | X2 | -0.056<br>(0.038) | |
     | Constant | 2.345<br>(0.567) | 1.876<br>(0.678) |
     | Observations | 1000 | 1000 |
     | R-squared | 0.234 | 0.345 |
   - 表格包含变量名称、系数、标准误、显著性星号
3. 回归表格严格要求：
   - 每列代表一个回归模型
   - 第一列是变量名称
   - 系数后跟显著性星号（***p<0.01, **p<0.05, *p<0.1）
   - 标准误在系数下方括号内，系数和标准误用 <br> 换行在同一单元格内
   - 不使用t值和p值列，标准误直接在系数下方
   - 必须包含Constant（常数项）、Observations、R-squared行
4. 包含：分析结果 → 统计解读 → 经济学/业务含义 → 注意事项
5. 回归结果务必包含：系数、标准误（括号内）、显著性星号、R²、样本量
6. 描述统计包含：N、均值、标准差、最小值、最大值、中位数
7. 如数据只是样本，结尾注明"注：以上结果基于前${sampleSize}行数据估算，完整分析需使用全部数据"
8. 语言：专业学术中文`;

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
