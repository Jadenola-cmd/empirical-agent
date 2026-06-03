import os
from typing import Dict, Optional
import httpx


def interpret_results(results: Dict, custom_question: Optional[str] = None) -> Dict:
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

    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        return {"text": "未配置 DASHSCOPE_API_KEY，无法进行AI解读"}

    try:
        response = httpx.post(
            "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {api_key}",
            },
            json={
                "model": "deepseek-v4-flash",
                "max_tokens": 600,
                "temperature": 0.3,
                "messages": [
                    {"role": "system", "content": "你是计量经济学专家，用专业学术中文输出分析解读。"},
                    {"role": "user", "content": prompt},
                ],
            },
            timeout=30.0,
        )
        data = response.json()
        text = data["choices"][0]["message"]["content"]
        return {"text": text}
    except Exception as e:
        return {"text": f"AI解读失败：{str(e)}"}


def build_summary(results: Dict) -> str:
    lines = []

    if "descriptive" in results:
        d = results["descriptive"]
        lines.append(f"描述性统计：{len(d['vars'])} 个变量")
        for v in d["vars"][:5]:
            lines.append(f"  {v['name']}: N={v['obs']}, 均值={v['mean']:.3f}, SD={v['sd']:.3f}")

    if "correlation" in results:
        c = results["correlation"]
        lines.append(f"相关系数矩阵：{len(c['vars'])} 个变量")

    if "ols" in results:
        r = results["ols"]
        lines.append(f"OLS回归：因变量={r['dep_var']}, N={r['n']}, R²={r['r2']:.3f}")
        for c in r["coefficients"]:
            if c["variable"] != "_cons":
                lines.append(f"  {c['variable']}: coef={c['coef']:.3f}, t={c['t_stat']:.2f}{c['sig']}")

    for key in ("panel_fe", "panel_re"):
        if key in results:
            r = results[key]
            label = "固定效应" if key == "panel_fe" else "随机效应"
            lines.append(f"{label}回归：N={r['n']}, R²(within)={r.get('r2_within')}")
            if r.get("hausman"):
                h = r["hausman"]
                lines.append(f"  Hausman检验：chi2={h['chi2']:.3f}, p={h['p_value']:.3f}, {h['conclusion']}")

    return "\n".join(lines)