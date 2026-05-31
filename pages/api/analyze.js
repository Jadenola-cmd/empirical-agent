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
2. 用 Markdown 格式：## 标题，### 小标题，**粗体**，表格用标准 Markdown 表格
3. 包含：分析结果 → 统计解读 → 经济学/业务含义 → 注意事项
4. 回归结果务必包含：系数、标准误（括号内）、t值/p值、显著性星号（***p<0.01, **p<0.05, *p<0.1）、R²、F统计量
5. 描述统计包含：N、均值、标准差、最小值、最大值、中位数
6. 如数据只是样本，结尾注明"注：以上结果基于前${sampleSize}行数据估算，完整分析需使用全部数据"
7. 语言：专业学术中文`;

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
        max_tokens: 2000,
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
