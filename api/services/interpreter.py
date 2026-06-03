import os
import json
from typing import Dict, Optional


def interpret_results(results: Dict, custom_question: Optional[str] = None) -> Dict:
    """
    用 DeepSeek 对统计结果进行学术解读
    AI 只做文字解读，不做任何数值计算
    """
    import dashscope
    from dashscope import Generation

    dashscope.api_key = os.getenv("DASHSCOPE_API_KEY")

    # 把数值结果转成简要摘要给 AI
    summary = build_summary(results)

    prompt = f"""你是一位计量经济学专家，请对以下实证分析结果进行学术解读。

分析结果摘要：
{summary}

{f'用户附加问题：{custom_question}' if custom_question else ''}

要求：
1. 用专业学术中文
2. 解读系数的经济学含义
3. 说明统计显著性的含义
4. 指出结果的局限性
5. 200字以内，简洁精准"""

    response = Generation.call(
        model="deepseek-v4-flash",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
    )

    text = response.output.text if hasattr(response, "output") else "解读失败"
    return {"text": text}


def build_summary(results: Dict) -> str:
    lines = []
    if "descriptive" in results:
        d = results["descriptive"]
        lines.append(f"描述性统计：{len(d['vars'])} 个变量")
        for v in d["vars"][:5]:
            lines.append(f"  {v['name']}: N={v['obs']}, 均值={v['mean']:.3f}, SD={v['sd']:.3f}")

    if "ols" in results:
        r = results["ols"]
        lines.append(f"OLS回归：因变量={r['dep_var']}, N={r['n']}, R²={r['r2']:.3f}, F={r['f_stat']}")
        for c in r["coefficients"]:
            if c["variable"] != "_cons":
                lines.append(f"  {c['variable']}: coef={c['coef']:.3f}, t={c['t_stat']:.2f}, {c['sig']}")

    for key in ("panel_fe", "panel_re"):
        if key in results:
            r = results[key]
            lines.append(f"{'固定效应' if key=='panel_fe' else '随机效应'}：N={r['n']}, R²(within)={r.get('r2_within')}")
            if r.get("hausman"):
                h = r["hausman"]
                lines.append(f"  Hausman检验：chi2={h['chi2']:.3f}, p={h['p_value']:.3f}, {h['conclusion']}")

    return "\n".join(lines)
