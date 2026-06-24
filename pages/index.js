import React, { useState, useRef, useEffect } from "react";
import Head from "next/head";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

function sigStars(p) {
  if (p == null) return "";
  if (p < 0.01) return "***";
  if (p < 0.05) return "**";
  if (p < 0.1) return "*";
  return "";
}

// ─── 埋点 ───────────────────────────────────────────
function generateUuid() {
  // crypto.randomUUID() 仅在安全上下文（HTTPS/localhost）可用，HTTP 访问时需降级
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function getVisitorId() {
  if (typeof window === "undefined") return null;
  try {
    let id = localStorage.getItem("visitor_id");
    if (!id) {
      id = generateUuid();
      localStorage.setItem("visitor_id", id);
    }
    return id;
  } catch (e) {
    return null;
  }
}

function track(event, props) {
  if (typeof window === "undefined") return;
  try {
    fetch(`${API_URL}/api/leads/event`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event, visitor_id: getVisitorId(), props: props || null }),
    }).catch(() => {});
  } catch (e) {
    // 埋点失败不影响页面正常使用
  }
}

// ─── 导出工具 ───────────────────────────────────────
function exportXlsx(analyzeResults, cleanedData) {
  import("xlsx").then(XLSX => {
    const wb = XLSX.utils.book_new();

    if (cleanedData?.data?.length) {
      const ws = XLSX.utils.json_to_sheet(cleanedData.data);
      XLSX.utils.book_append_sheet(wb, ws, "清洗数据");
    }

    const r = analyzeResults?.results;
    if (!r) { XLSX.writeFile(wb, "实证分析结果.xlsx"); return; }

    if (r.descriptive?.vars) {
      const rows = [
        ["VarName", "Obs", "Mean", "SD", "Min", "Median", "Max"],
        ...r.descriptive.vars.map(v => [
          v.name,
          v.obs,
          v.mean != null ? +v.mean.toFixed(3) : "",
          v.sd != null ? +v.sd.toFixed(3) : "",
          v.min != null ? +v.min.toFixed(3) : "",
          v.median != null ? +v.median.toFixed(3) : "",
          v.max != null ? +v.max.toFixed(3) : "",
        ]),
        [],
        [r.descriptive.notes || "样本标准差（ddof=1），与 Stata summarize 一致"],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "描述统计");
    }

    if (r.correlation?.vars) {
      const vars = r.correlation.vars;
      const header = ["", ...vars.map((_, i) => `(${i + 1})`)];
      const dataRows = r.correlation.matrix.map((row, i) => [
        vars[i],
        ...row.map((cell, j) => i === j ? "1" : `${cell.coef?.toFixed(3) ?? "—"}${cell.sig}`),
      ]);
      const rows = [header, ...dataRows, [], [r.correlation.notes || "***p<0.01, **p<0.05, *p<0.1"]];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "相关矩阵");
    }

    function buildRegSheet(reg, label) {
      if (!reg?.coefficients) return null;
      const isPanel = reg.type === "fe" || reg.type === "re";
      const dummySet = new Set(reg.dummy_vars || []);
      const cons = reg.coefficients.find(c => c.variable === "_cons");
      const mainVars = reg.coefficients.filter(c => c.variable !== "_cons");
      const rows = [];
      rows.push([label, "(1)"]);
      rows.push(["", reg.dep_var]);
      rows.push([]);
      mainVars.forEach(c => {
        rows.push([c.variable, `${(c.coef?.toFixed(3) ?? "—")}${c.sig}`]);
        rows.push(["", `(${c.t_stat?.toFixed(2) ?? "—"})`]);
      });
      if (cons) {
        rows.push(["_cons", `${(cons.coef?.toFixed(3) ?? "—")}${cons.sig}`]);
        rows.push(["", `(${cons.t_stat?.toFixed(2) ?? "—"})`]);
      }
      rows.push([]);
      (reg.categorical_vars || []).forEach(cv => rows.push([`${cv} 虚拟化`, "Yes"]));
      rows.push(["时间固定效应", reg.time_effects ? "Yes" : "No"]);
      rows.push(["N", reg.n]);
      const isBinary = reg.type === "probit" || reg.type === "logit";
      if (isPanel) {
        rows.push(["R² (within)", reg.r2_within?.toFixed(3)]);
        rows.push(["R² (overall)", reg.r2_overall?.toFixed(3)]);
      } else if (isBinary) {
        rows.push(["Pseudo R² (McFadden)", reg.pseudo_r2?.toFixed(3)]);
        rows.push(["Log-likelihood", reg.log_likelihood?.toFixed(3)]);
        rows.push(["LR χ²", reg.lr_chi2?.toFixed(3)]);
      } else {
        rows.push(["R²", reg.r2?.toFixed(3)]);
        rows.push(["Adj. R²", reg.r2_adj?.toFixed(3)]);
        rows.push(["F", reg.f_stat?.toFixed(3)]);
      }
      if (reg.hausman) {
        rows.push([]);
        rows.push([`Hausman检验: χ²=${reg.hausman.chi2}, p=${reg.hausman.p_value}`]);
        rows.push([reg.hausman.conclusion]);
      }
      if (reg.margeff?.length) {
        rows.push([]);
        rows.push(["平均边际效应（AME）"]);
        rows.push(["变量", "dy/dx", "Std.Err.", "z", "p"]);
        reg.margeff.forEach(m => {
          rows.push([m.variable, `${m.dydx?.toFixed(4)}${m.sig}`, m.std_error?.toFixed(4), m.z_stat?.toFixed(2), m.p_value?.toFixed(3)]);
        });
      }
      rows.push([]);
      rows.push([reg.notes || "括号内为t值，***p<0.01, **p<0.05, *p<0.1"]);
      if (reg.dropped_vars?.length) {
        rows.push([`注：${reg.dropped_vars.join(", ")} 因完全共线性被自动移除`]);
      }
      return XLSX.utils.aoa_to_sheet(rows);
    }

    // 并列对比 sheet
    const regModels = [
      { key: "ols", label: "OLS", data: r.ols },
      { key: "panel_fe", label: "固定效应", data: r.panel_fe },
      { key: "panel_re", label: "随机效应", data: r.panel_re },
    ].filter(m => m.data?.coefficients?.length);
    if (regModels.length >= 2) {
      const allDummies = new Set(regModels.flatMap(m => m.data.dummy_vars || []));
      const seenV = new Set();
      const mainVarNames = [];
      regModels.forEach(m => m.data.coefficients.forEach(c => {
        if (c.variable !== "_cons" && !allDummies.has(c.variable) && !seenV.has(c.variable)) {
          seenV.add(c.variable); mainVarNames.push(c.variable);
        }
      }));
      const allCatV = [...new Set(regModels.flatMap(m => m.data.categorical_vars || []))];
      const hasCons = regModels.some(m => m.data.coefficients.some(c => c.variable === "_cons"));
      const header = ["", ...regModels.map((m, i) => `(${i+1}) ${m.label}`)];
      const subHeader = ["dep_var", ...regModels.map(m => m.data.dep_var)];
      const cmpRows = [header, subHeader, []];
      function getC(data, v) { return data.coefficients.find(c => c.variable === v); }
      mainVarNames.forEach(v => {
        cmpRows.push([v, ...regModels.map(m => { const c = getC(m.data, v); return c ? `${(c.coef?.toFixed(3) ?? "—")}${c.sig}` : "—"; })]);
        cmpRows.push(["", ...regModels.map(m => { const c = getC(m.data, v); return c ? `(${c.t_stat?.toFixed(2) ?? "—"})` : ""; })]);
      });
      if (hasCons) {
        cmpRows.push(["_cons", ...regModels.map(m => { const c = getC(m.data, "_cons"); return c ? `${(c.coef?.toFixed(3) ?? "—")}${c.sig}` : "—"; })]);
        cmpRows.push(["", ...regModels.map(m => { const c = getC(m.data, "_cons"); return c ? `(${c.t_stat?.toFixed(2) ?? "—"})` : ""; })]);
      }
      cmpRows.push([]);
      allCatV.forEach(cv => cmpRows.push([`${cv} 虚拟化`, ...regModels.map(m => (m.data.categorical_vars || []).includes(cv) ? "Yes" : "No")]));
      cmpRows.push(["时间固定效应", ...regModels.map(m => m.data.time_effects ? "Yes" : "No")]);
      cmpRows.push(["N", ...regModels.map(m => m.data.n)]);
      if (regModels.some(m => m.data.type === "ols")) cmpRows.push(["R²", ...regModels.map(m => m.data.type === "ols" ? m.data.r2?.toFixed(3) : "—")]);
      if (regModels.some(m => m.data.type === "fe" || m.data.type === "re")) cmpRows.push(["R² (within)", ...regModels.map(m => (m.data.type === "fe" || m.data.type === "re") ? m.data.r2_within?.toFixed(3) : "—")]);
      cmpRows.push(["SE 类型", ...regModels.map(m => m.data.se_type)]);
      cmpRows.push([]);
      cmpRows.push(["括号内为t值，***p<0.01, **p<0.05, *p<0.1"]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(cmpRows), "回归对比");
    }

    if (r.pca?.components?.length) {
      const p = r.pca;
      const su = p.suitability;
      const cs = p.composite_score;
      const rows = [];
      rows.push(["主成分分析结果", `${p.matrix_label}，N=${p.n}`]);
      rows.push([]);
      if (su) {
        rows.push(["适用性检验"]);
        rows.push(["KMO 抽样适当性度量", su.kmo ?? "—", su.kmo_label]);
        rows.push([
          "Bartlett 球形检验",
          su.bartlett_chi2 != null ? `χ²(${su.bartlett_df})=${su.bartlett_chi2}` : "—",
          su.bartlett_p != null ? `p=${su.bartlett_p}` : "",
          su.bartlett_sig ? "显著，适合做主成分分析" : "不显著，可能不适合做主成分分析",
        ]);
        rows.push([]);
      }
      rows.push(["主成分", "特征值", "方差贡献率", "累计贡献率", "是否保留"]);
      p.components.forEach(c => rows.push([
        c.component, c.eigenvalue, `${(c.explained * 100).toFixed(2)}%`, `${(c.cumulative * 100).toFixed(2)}%`, c.retained ? "Yes" : "—",
      ]));
      rows.push([]);
      rows.push([`主成分载荷（已保留 ${p.n_retained} 个主成分）`]);
      rows.push(["变量", ...Array.from({ length: p.n_retained }, (_, j) => `Comp${j + 1}`)]);
      p.loadings.forEach(row => rows.push([row.variable, ...Array.from({ length: p.n_retained }, (_, j) => row[`Comp${j + 1}`])]));
      if (cs) {
        rows.push([]);
        rows.push(["综合得分"]);
        rows.push([cs.formula]);
        rows.push(["均值", cs.mean, "标准差", cs.std, "最小值", cs.min, "最大值", cs.max]);
        rows.push(["权重", ...cs.weights.map(w => `${w.component}=${w.weight}`)]);
        rows.push([]);
        rows.push(["综合得分最高的样本（行号/得分）", ...cs.top.map(t => `#${t.row}: ${t.score}`)]);
        rows.push(["综合得分最低的样本（行号/得分）", ...cs.bottom.map(t => `#${t.row}: ${t.score}`)]);
      }
      rows.push([]);
      rows.push([p.notes || ""]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "主成分分析");
    }

    if (r.iv?.coefficients?.length) {
      const iv = r.iv;
      const cons = iv.coefficients.find(c => c.variable === "_cons");
      const mainVars = iv.coefficients.filter(c => c.variable !== "_cons");
      const endogSet = new Set(iv.endog_vars || []);
      const rows = [];
      rows.push(["工具变量法 2SLS 回归结果", "(1)"]);
      rows.push(["", iv.dep_var]);
      rows.push([]);
      mainVars.forEach(c => {
        rows.push([`${c.variable}${endogSet.has(c.variable) ? "（内生）" : ""}`, `${(c.coef?.toFixed(3) ?? "—")}${c.sig}`]);
        rows.push(["", `(${c.t_stat?.toFixed(2) ?? "—"})`]);
      });
      if (cons) {
        rows.push(["_cons", `${(cons.coef?.toFixed(3) ?? "—")}${cons.sig}`]);
        rows.push(["", `(${cons.t_stat?.toFixed(2) ?? "—"})`]);
      }
      rows.push(["N", iv.n]);
      rows.push([]);
      if (iv.first_stage?.length) {
        rows.push(["第一阶段诊断（弱工具变量检验，经验法则 F<10）"]);
        iv.first_stage.forEach(f => rows.push([f.endog_var, `F = ${f.f_stat}`, f.weak ? "弱工具变量" : "通过检验"]));
        rows.push([]);
      }
      if (iv.overid_test) {
        rows.push(["过度识别检验（Sargan）", `统计量=${iv.overid_test.stat}`, `p=${iv.overid_test.p_value}`]);
        rows.push([iv.overid_test.conclusion]);
        rows.push([]);
      }
      rows.push([iv.notes || "括号内为t值，***p<0.01, **p<0.05, *p<0.1"]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "工具变量2SLS");
    }

    if (r.did_event?.event_coefs?.length) {
      const de = r.did_event;
      const rows = [["多时点 DID 事件研究结果"]];
      if (de.overall_result?.coefficients?.length) {
        rows.push([]);
        rows.push(["整体 ATT 估计（TWFE，_post_treat 系数）"]);
        const att = de.overall_result.coefficients.find(c => c.variable === "_post_treat");
        if (att) {
          rows.push(["变量", "系数", "t值", "p值", "95% CI 下界", "95% CI 上界", "显著性"]);
          rows.push([
            "_post_treat（ATT）",
            att.coef?.toFixed(4),
            att.t_stat?.toFixed(3),
            att.p_value?.toFixed(3),
            (att.coef - 1.96 * att.std_error)?.toFixed(4),
            (att.coef + 1.96 * att.std_error)?.toFixed(4),
            att.sig || ""
          ]);
          rows.push(["N", de.overall_result.n]);
        }
      }
      rows.push([]);
      rows.push(["事件研究系数（Event Study，基期 t=−1）"]);
      rows.push(["相对期", "系数", "标准误", "t值", "p值", "95% CI 下界", "95% CI 上界", "显著性"]);
      de.event_coefs.forEach(ec => {
        const label = ec.period === -1 ? "t=−1（基期）" : ec.period > 0 ? `t=+${ec.period}` : `t=${ec.period}`;
        rows.push([
          label,
          ec.is_base ? 0 : ec.coef?.toFixed(4),
          ec.is_base ? "—" : ec.se?.toFixed(4),
          "—",
          ec.p_value != null ? ec.p_value?.toFixed(3) : "—",
          ec.is_base ? "—" : ec.ci_low?.toFixed(4),
          ec.is_base ? "—" : ec.ci_high?.toFixed(4),
          ec.sig || (ec.is_base ? "（归零）" : "")
        ]);
      });
      if (de.parallel_trends_event) {
        rows.push([]);
        rows.push(["平行趋势检验", de.parallel_trends_event.conclusion]);
      }
      rows.push([]);
      rows.push([de.notes || ""]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "多时点DID");
    }

    if (r.ols) { const ws = buildRegSheet(r.ols, "OLS 回归结果"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "OLS"); }
    if (r.panel_fe) { const ws = buildRegSheet(r.panel_fe, "固定效应回归（xtreg, fe）"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "固定效应"); }
    if (r.panel_re) { const ws = buildRegSheet(r.panel_re, "随机效应回归（xtreg, re）"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "随机效应"); }
    if (r.probit) { const ws = buildRegSheet(r.probit, "Probit 回归结果"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "Probit"); }
    if (r.logit) { const ws = buildRegSheet(r.logit, "Logit 回归结果"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "Logit"); }
    if (r.moderation) { const ws = buildRegSheet(r.moderation, "调节效应回归（交互项，已中心化）"); if (ws) XLSX.utils.book_append_sheet(wb, ws, "调节效应"); }

    if (r.mediation) {
      const md = r.mediation;
      const steps = [
        { label: "总效应 c", data: md.step1 },
        { label: "路径 a", data: md.step2 },
        { label: "路径 b / c'", data: md.step3 },
      ];
      function getC(stepData, v) { return stepData?.coefficients?.find(c => c.variable === v); }
      function fmt(c) { return c ? [`${(c.coef?.toFixed(3) ?? "—")}${c.sig}`, `(${c.t_stat?.toFixed(2) ?? "—"})`] : ["—", ""]; }
      const rows = [["中介效应检验结果（Baron-Kenny 三步法）"]];
      rows.push(["", ...steps.map((s, i) => `(${i + 1}) ${s.label}`)]);
      rows.push(["dep_var", ...steps.map(s => s.data?.dep_var)]);
      rows.push([]);
      const [iv1, iv2] = fmt(getC(md.step1, md.indep_var));
      const [iv3, iv4] = fmt(getC(md.step2, md.indep_var));
      const [iv5, iv6] = fmt(getC(md.step3, md.indep_var));
      rows.push([md.indep_var, iv1, iv3, iv5]);
      rows.push(["", iv2, iv4, iv6]);
      const [m1, m2] = fmt(getC(md.step3, md.mediator_var));
      rows.push([md.mediator_var, "—", "—", m1]);
      rows.push(["", "", "", m2]);
      if (md.control_vars?.length) rows.push(["控制变量", "Yes", "Yes", "Yes"]);
      rows.push(["N", ...steps.map(s => s.data?.n)]);
      rows.push(["R²", ...steps.map(s => s.data?.r2?.toFixed(3) ?? "—")]);
      rows.push([]);
      rows.push([`判定结论：${md.mediation_type}`]);
      rows.push([md.conclusion]);
      if (md.sobel) {
        rows.push([]);
        rows.push(["Sobel 检验（间接效应 a×b 显著性）"]);
        rows.push([`间接效应=${md.sobel.indirect_effect}`, `SE=${md.sobel.se}`, `z=${md.sobel.z_stat}${md.sobel.sig}`, `p=${md.sobel.p_value}`]);
      }
      rows.push([]);
      rows.push([md.notes || "括号内为t值，***p<0.01, **p<0.05, *p<0.1"]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "中介效应");
    }

    if (r.heterogeneity?.groups?.length) {
      const ht = r.heterogeneity;
      const valid = ht.groups.filter(g => g.result?.coefficients?.length);
      if (valid.length) {
        const seenV = new Set();
        const mainVars = [];
        valid.forEach(g => g.result.coefficients.forEach(c => {
          if (c.variable !== "_cons" && !seenV.has(c.variable)) { seenV.add(c.variable); mainVars.push(c.variable); }
        }));
        const hasCons = valid.some(g => g.result.coefficients.some(c => c.variable === "_cons"));
        const isPanel = ht.model_type === "fe";
        function getC(g, v) { return g.result?.coefficients?.find(c => c.variable === v); }
        const rows = [[`异质性分析 · 分组对比（按 ${ht.group_var} 拆分）`]];
        rows.push(["", ...ht.groups.map((g, i) => `(${i + 1}) ${g.label}`)]);
        mainVars.forEach(v => {
          rows.push([v, ...ht.groups.map(g => { const c = getC(g, v); return c ? `${(c.coef?.toFixed(3) ?? "—")}${c.sig}` : "—"; })]);
          rows.push(["", ...ht.groups.map(g => { const c = getC(g, v); return c ? `(${c.t_stat?.toFixed(2) ?? "—"})` : ""; })]);
        });
        if (hasCons) {
          rows.push(["_cons", ...ht.groups.map(g => { const c = getC(g, "_cons"); return c ? `${(c.coef?.toFixed(3) ?? "—")}${c.sig}` : "—"; })]);
          rows.push(["", ...ht.groups.map(g => { const c = getC(g, "_cons"); return c ? `(${c.t_stat?.toFixed(2) ?? "—"})` : ""; })]);
        }
        rows.push(["N", ...ht.groups.map(g => g.result ? g.n : (g.error || "—"))]);
        rows.push([isPanel ? "R² (within)" : "R²", ...ht.groups.map(g => isPanel ? (g.result?.r2_within?.toFixed(3) ?? "—") : (g.result?.r2?.toFixed(3) ?? "—"))]);
        rows.push([]);
        rows.push([ht.notes || "括号内为t值，***p<0.01, **p<0.05, *p<0.1"]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "异质性分析");
      }
    }

    if (r.psm) {
      const ps = r.psm;
      const rows = [["倾向得分匹配（PSM）结果"]];
      rows.push([]);
      rows.push(["ATT", `${ps.att?.toFixed(4)}${ps.sig}`]);
      rows.push(["SE", ps.se != null ? ps.se.toFixed(4) : "—"]);
      rows.push(["t", ps.t_stat ?? "—"]);
      rows.push(["p", ps.p_value ?? "—"]);
      rows.push(["处理组 N", ps.n_treated]);
      rows.push(["对照组 N", ps.n_control]);
      rows.push(["匹配成功数", ps.n_matched]);
      rows.push(["未匹配数", ps.n_unmatched]);
      rows.push(["超出共同支撑域", ps.n_outside_support]);
      if (ps.balance?.length) {
        rows.push([]);
        rows.push(["平衡性检验（对照 Stata pstest）"]);
        rows.push(["协变量", "样本", "处理组均值", "对照组均值", "%Bias", "%Reduct|Bias|", "t", "p>|t|"]);
        ps.balance.forEach(b => {
          rows.push([b.variable, "Unmatched", b.treated_mean_unmatched, b.control_mean_unmatched, b.bias_unmatched, "", b.t_unmatched ?? "", b.p_unmatched ?? ""]);
          rows.push(["", "Matched", b.treated_mean_matched ?? "", b.control_mean_matched ?? "", b.bias_matched ?? "", b.pct_reduct ?? "", b.t_matched ?? "", b.p_matched ?? ""]);
        });
      }
      if (ps.balance_summary) {
        const bs = ps.balance_summary;
        rows.push([]);
        rows.push(["Pseudo R²", bs.ps_r2, "LR χ²", bs.lr_chi2, "p>χ²", bs.lr_chi2_pvalue]);
        rows.push(["Mean |Bias|（匹配前→后）", `${bs.mean_bias_unmatched} → ${bs.mean_bias_matched ?? "—"}`]);
        rows.push(["Median |Bias|（匹配前→后）", `${bs.median_bias_unmatched} → ${bs.median_bias_matched ?? "—"}`]);
      }
      rows.push([]);
      rows.push([ps.notes || ""]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PSM");
    }

    if (r.did_robustness) {
      const dr = r.did_robustness;
      const rows = [["DID 稳健性检验"]];
      rows.push(["模式", dr.mode === "staggered" ? "交错处理时点" : "同质处理时点"]);
      if (dr.mode === "staggered") rows.push(["处理组个体数", dr.n_treated_entities]);
      rows.push([]);
      rows.push(["基准估计：_did 系数", `${dr.baseline_coef}（p=${dr.baseline_p_value}）`]);
      rows.push([]);
      const pb = dr.placebo;
      if (pb) {
        rows.push(["安慰剂检验", `重复 ${pb.n_runs} 次`]);
        if (pb.p_value != null) {
          rows.push(["随机系数均值", pb.mean]);
          rows.push(["随机系数标准差", pb.std]);
          rows.push(["伪p值", pb.p_value]);
        }
        rows.push([pb.conclusion]);
        if (pb.coefs?.length > 0) {
          rows.push([]);
          rows.push(["安慰剂系数分布（共" + pb.coefs.length + "次）"]);
          rows.push(pb.coefs);
        }
        rows.push([]);
      }
      const ex = dr.exclude_policy_period;
      if (ex) {
        rows.push(["剔除政策当期后 _did 系数", `${ex.coef?.toFixed(3)}${ex.sig}`]);
        rows.push(["t值", ex.t_stat?.toFixed(2)]);
        rows.push(["N", ex.n]);
        rows.push([]);
      }
      rows.push([dr.notes || ""]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "DID稳健性检验");
    }

    if (r.psm_did) {
      const pd2 = r.psm_did;
      const rows = [["PSM-DID 基期锁定匹配"]];
      rows.push([]);
      rows.push(["匹配模式", pd2.mode]);
      rows.push(["处理组个体总数", pd2.n_treated_total]);
      rows.push(["匹配成功处理组数", pd2.n_matched_treated]);
      rows.push(["基期无观测剔除数", pd2.n_excluded_missing_baseline]);
      rows.push(["超出caliper未匹配数", pd2.n_excluded_caliper]);
      rows.push(["对照组使用数", pd2.n_control_used]);
      rows.push(["面板还原后实体数", pd2.n_final_entities]);
      if (pd2.blocks?.length) {
        rows.push([]);
        rows.push(["分Block诊断"]);
        rows.push(["基期", "处理组候选", "对照组候选", "匹配成功", "未匹配", "Pseudo R²"]);
        pd2.blocks.forEach(b => rows.push([b.baseline_year, b.n_treated_candidates, b.n_control_candidates, b.n_matched, b.n_unmatched, b.ps_r2 ?? ""]));
      }
      if (pd2.balance?.length) {
        rows.push([]);
        rows.push(["平衡性检验（基期截面，跨block合并）"]);
        rows.push(["协变量", "样本", "处理组均值", "对照组均值", "%Bias", "%Reduct|Bias|", "t", "p>|t|"]);
        pd2.balance.forEach(b => {
          rows.push([b.variable, "Unmatched", b.treated_mean_unmatched, b.control_mean_unmatched, b.bias_unmatched, "", b.t_unmatched ?? "", b.p_unmatched ?? ""]);
          rows.push(["", "Matched", b.treated_mean_matched ?? "", b.control_mean_matched ?? "", b.bias_matched ?? "", b.pct_reduct ?? "", b.t_matched ?? "", b.p_matched ?? ""]);
        });
      }
      if (pd2.balance_summary) {
        const bs = pd2.balance_summary;
        rows.push([]);
        rows.push(["Mean |Bias|（匹配前→后）", `${bs.mean_bias_unmatched} → ${bs.mean_bias_matched ?? "—"}`]);
        rows.push(["Median |Bias|（匹配前→后）", `${bs.median_bias_unmatched} → ${bs.median_bias_matched ?? "—"}`]);
      }
      if (pd2.mapping?.length) {
        rows.push([]);
        rows.push(["匹配映射表"]);
        rows.push(["处理组个体", "基期", "倾向得分", "匹配对照个体"]);
        pd2.mapping.forEach(m => rows.push([m.entity, m.baseline_year, m.pscore, (m.matched_controls || []).join(", ")]));
      }
      rows.push([]);
      rows.push([pd2.notes || ""]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "PSM-DID诊断");

      const twfeWs = buildRegSheet(pd2.twfe, "PSM-DID 双向固定效应估计（_did 系数即 ATT）");
      if (twfeWs) XLSX.utils.book_append_sheet(wb, twfeWs, "PSM-DID TWFE");

      if (pd2.event_study?.event_coefs?.length) {
        const es = pd2.event_study;
        const esRows = [["PSM-DID 事件研究系数（基期 t=−1）"]];
        esRows.push([]);
        esRows.push(["相对期", "系数", "标准误", "p值", "95% CI 下界", "95% CI 上界", "显著性"]);
        es.event_coefs.forEach(ec => {
          const label = ec.period === -1 ? "t=−1（基期）" : ec.period > 0 ? `t=+${ec.period}` : `t=${ec.period}`;
          esRows.push([
            label,
            ec.is_base ? 0 : ec.coef?.toFixed(4),
            ec.is_base ? "—" : ec.se?.toFixed(4),
            ec.p_value != null ? ec.p_value?.toFixed(3) : "—",
            ec.is_base ? "—" : ec.ci_low?.toFixed(4),
            ec.is_base ? "—" : ec.ci_high?.toFixed(4),
            ec.sig || (ec.is_base ? "（归零）" : "")
          ]);
        });
        if (es.parallel_trends_event) {
          esRows.push([]);
          esRows.push(["平行趋势检验", es.parallel_trends_event.conclusion]);
        }
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(esRows), "PSM-DID事件研究");
      }

      if (pd2.restored_panel?.length) {
        const panelWs = XLSX.utils.json_to_sheet(pd2.restored_panel, { header: pd2.restored_panel_cols });
        XLSX.utils.book_append_sheet(wb, panelWs, "PSM-DID匹配面板数据");
      }
    }

    XLSX.writeFile(wb, `实证分析_${new Date().toISOString().slice(0, 10)}.xlsx`);
  });
}

function exportDoFile(doClean, doAnalyze) {
  const content = [
    "* ════════════════════════════════════",
    "* Stata Do 文件（由 Empirical Agent 自动生成）",
    `* 生成时间：${new Date().toLocaleString("zh-CN")}`,
    "* ════════════════════════════════════",
    "",
    doClean || "",
    doAnalyze || "",
    "",
    "* 文件结束",
  ].join("\n");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `empirical_${new Date().toISOString().slice(0, 10)}.do`;
  a.click();
}

// ─── 数据预览表格 ───────────────────────────────────
function DataPreviewTable({ preview, columns, title }) {
  if (!preview?.length) return null;
  const cols = columns || Object.keys(preview[0]);
  return (
    <div className="preview-block">
      <div className="prev-title">{title || "数据预览（前10行）"}</div>
      <div className="prev-scroll">
        <table className="prev-table">
          <thead><tr>{cols.map(c => <th key={c}>{c}</th>)}</tr></thead>
          <tbody>
            {preview.map((row, i) => (
              <tr key={i}>{cols.map(c => <td key={c}>{String(row[c] ?? "")}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 字段映射 ───────────────────────────────────────
function FieldMapper({ files, fieldMaps, onChange }) {
  if (!files?.length) return null;
  return (
    <div className="field-mapper">
      <div className="fm-hint">将各文件的列名统一为标准名（解决"股票代码 vs 证券代码"等问题）。留空表示不改名。</div>
      {files.map(f => (
        <div key={f.filename} className="fm-file">
          <div className="fm-fname">📄 {f.filename}</div>
          <div className="fm-cols">
            {f.columns.map(col => {
              const mapped = fieldMaps[f.filename]?.[col] || "";
              return (
                <div key={col} className="fm-row">
                  <span className="fm-orig">{col}</span>
                  <span className="fm-arrow">→</span>
                  <input
                    className="fm-input"
                    value={mapped}
                    placeholder={col}
                    onChange={e => {
                      const val = e.target.value.trim();
                      onChange(prev => {
                        const next = { ...prev };
                        if (!next[f.filename]) next[f.filename] = {};
                        if (val && val !== col) {
                          next[f.filename][col] = val;
                        } else {
                          delete next[f.filename][col];
                        }
                        return next;
                      });
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── 合并类型检查徽章 ────────────────────────────────
function MergeTypeBadge({ mergeCheck }) {
  if (!mergeCheck) return null;
  const colors = { "1:1": "#2a7a2a", "1:N": "#2c4a8a", "N:N": "#8a2c2c", "unknown": "#888", "no_keys": "#888" };
  return (
    <div className="merge-check">
      <span className="mc-type" style={{ background: colors[mergeCheck.type] || "#888" }}>{mergeCheck.type}</span>
      {mergeCheck.warning && <span className="mc-warn">{mergeCheck.warning}</span>}
      {!mergeCheck.warning && mergeCheck.type !== "no_keys" && mergeCheck.type !== "unknown" && (
        <span className="mc-ok">✓ 合并类型正常</span>
      )}
      <div className="mc-details">
        {mergeCheck.details?.map((d, i) => (
          <span key={i} className={`mc-detail ${d.is_unique ? "ok" : "warn"}`}>{d.file}: {d.message}</span>
        ))}
      </div>
    </div>
  );
}

// ─── 学术表格 ───────────────────────────────────────
function DescriptiveTable({ data }) {
  if (!data?.vars?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">描述性统计</div>
      <div className="tbl-scroll">
        <table className="acad-table">
          <thead><tr>
            <th className="col-var">VarName</th>
            <th>Obs</th><th>Mean</th><th>SD</th>
            <th>Min</th><th>Median</th><th>Max</th>
          </tr></thead>
          <tbody>
            {data.vars.map((v, i) => (
              <tr key={i}>
                <td className="col-var">{v.name}</td>
                <td>{v.obs.toLocaleString()}</td>
                <td>{v.mean?.toFixed(3) ?? "—"}</td>
                <td>{v.sd?.toFixed(3) ?? "—"}</td>
                <td>{v.min?.toFixed(3) ?? "—"}</td>
                <td>{v.median?.toFixed(3) ?? "—"}</td>
                <td>{v.max?.toFixed(3) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function CorrelationTable({ data }) {
  if (!data?.vars?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">相关系数矩阵</div>
      <div className="tbl-scroll">
        <table className="acad-table corr-tbl">
          <thead><tr>
            <th className="col-var"></th>
            {data.vars.map((v, i) => <th key={i}>({i + 1})</th>)}
          </tr></thead>
          <tbody>
            {data.vars.map((v, i) => (
              <tr key={i}>
                <td className="col-var">{v}</td>
                {(data.matrix[i] || []).map((cell, j) => (
                  <td key={j} className="col-corr">
                    {i === j ? "1" : <>{cell.coef?.toFixed(3) ?? "—"}<sup className="sig">{cell.sig}</sup></>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

// 需激活码解锁的高级分析类型（与后端 api/routes/analyze.py 的 RESTRICTED_ANALYSIS_TYPES 保持一致）
// 范围：本次新增的高级功能（PSM/DID稳健性检验/Probit/Logit）；已上线的免费功能不纳入锁定
const LOCKED_ANALYSIS_TYPES = ["psm", "did_robustness", "probit", "logit", "psm_did"];

// ─── 分析方法注册表 ───────────────────────────────────
// 新增一种分析方法：在此追加一条配置即可，卡片分组、勾选逻辑均由它驱动，
// 无需在渲染代码里新增 if 分支（category 决定卡片分组，UI 按其在数组中
// 首次出现的顺序自动生成分组标签，不写死分组列表）。
const ANALYSIS_REGISTRY = [
  { type: "descriptive",   icon: "📊", title: "描述性统计",   desc: "均值/SD/分布 · 对齐 Stata summarize", category: "数据探索" },
  { type: "correlation",   icon: "🔗", title: "相关系数矩阵", desc: "Pearson + 显著性 · 对齐 Stata pwcorr", category: "数据探索" },
  { type: "panel_balance", icon: "⚖️", title: "面板平衡性检查", desc: "xtdescribe · 检测缺失观测", category: "数据探索" },
  { type: "ols",           icon: "📈", title: "OLS 回归",     desc: "普通最小二乘 · 稳健/聚类SE", category: "主回归分析" },
  { type: "panel_fe",      icon: "🏛️", title: "固定效应",    desc: "entity FE · Hausman检验", category: "主回归分析" },
  { type: "panel_re",      icon: "🎲", title: "随机效应",     desc: "GLS估计 · xtreg, re", category: "主回归分析" },
  { type: "probit",        icon: "📉", title: "Probit 回归",  desc: "二元被解释变量 · MLE + 边际效应", category: "主回归分析" },
  { type: "logit",         icon: "📉", title: "Logit 回归",   desc: "二元被解释变量 · MLE + 边际效应", category: "主回归分析" },
  { type: "did",           icon: "⏱️", title: "双重差分 DID", desc: "面板双向FE · 平行趋势检验", category: "因果识别" },
  { type: "did_event",     icon: "📅", title: "多时点DID事件研究", desc: "事件窗口系数 · 平行趋势可视化检验", category: "因果识别" },
  { type: "iv",            icon: "🪛", title: "工具变量法 2SLS", desc: "两阶段最小二乘 · 弱工具变量检验", category: "因果识别" },
  { type: "moderation",    icon: "🔀", title: "调节效应分析", desc: "交互项回归 · 自动中心化", category: "机制检验" },
  { type: "mediation",     icon: "🧩", title: "中介效应分析", desc: "Baron-Kenny 三步法 + Sobel 检验", category: "机制检验" },
  { type: "heterogeneity", icon: "🧬", title: "异质性分析",   desc: "分组回归对比", category: "稳健性检验" },
  { type: "did_robustness", icon: "🛡️", title: "DID稳健性检验", desc: "安慰剂检验 · 剔除政策当期重估", category: "稳健性检验" },
  { type: "psm",           icon: "🎯", title: "倾向得分匹配 PSM", desc: "Logit倾向得分 · 近邻匹配 + 平衡性检验", category: "因果识别" },
  { type: "psm_did",       icon: "🧷", title: "PSM-DID 基期锁定匹配", desc: "基期PSM匹配 + 双向FE-DID + 事件研究", category: "因果识别" },
  { type: "pca",           icon: "🧮", title: "主成分分析 PCA", desc: "降维 · 载荷与方差贡献率", category: "数据探索" },
];

function EventStudyChart({ coefs, windowPre, windowPost }) {
  const W = 580, H = 270;
  const pad = { top: 28, right: 120, bottom: 52, left: 64 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const allY = coefs.flatMap(c => c.is_base ? [0] : [c.ci_low, c.ci_high, c.coef]).filter(v => v != null);
  const rawMin = Math.min(...allY, 0);
  const rawMax = Math.max(...allY, 0);
  const yPad = (rawMax - rawMin) * 0.2 || 0.05;
  const yMin = rawMin - yPad, yMax = rawMax + yPad;

  const minP = -windowPre, maxP = windowPost;
  const xOf = p => pad.left + ((p - minP) / (maxP - minP)) * iW;
  const yOf = v => pad.top + (1 - (v - yMin) / (yMax - yMin)) * iH;
  const y0 = yOf(0);

  // nice Y ticks
  const range = yMax - yMin || 0.1;
  const raw = range / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const nice = [1,2,2.5,5,10].find(s => s * mag >= raw) * mag;
  const yTicks = [];
  for (let t = Math.ceil(yMin / nice) * nice; t <= yMax + 1e-9; t = Math.round((t + nice) * 1e9) / 1e9)
    yTicks.push(t);

  const fmtY = v => Math.abs(v) >= 1 ? v.toFixed(2) : Math.abs(v) >= 0.01 ? v.toFixed(3) : v.toFixed(4);
  const pLabel = p => p === 0 ? 't=0' : p > 0 ? `t+${p}` : `t${p}`;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block', margin: '8px auto 0' }}>
      {/* 零线 */}
      {y0 >= pad.top && y0 <= H - pad.bottom && (
        <line x1={pad.left} x2={W - pad.right} y1={y0} y2={y0} stroke="#ddd" strokeWidth={1} />
      )}
      {/* 政策时点竖线 */}
      <line x1={xOf(0)} x2={xOf(0)} y1={pad.top} y2={H - pad.bottom}
        stroke="#888" strokeWidth={1} strokeDasharray="5,4" />
      <text x={xOf(0) + 4} y={pad.top + 11} fontSize={9} fill="#888">政策时点</text>

      {/* 误差棒 + 点 */}
      {coefs.map(c => {
        const cx = xOf(c.period), cy = yOf(c.coef);
        const color = c.is_base ? '#bbb' : c.period < 0 ? '#3b82f6' : '#ef4444';
        return (
          <g key={c.period}>
            {!c.is_base && c.ci_low != null && (() => {
              const yH = yOf(c.ci_high), yL = yOf(c.ci_low);
              return <>
                <line x1={cx} x2={cx} y1={yH} y2={yL} stroke={color} strokeWidth={1.5} />
                <line x1={cx - 4} x2={cx + 4} y1={yH} y2={yH} stroke={color} strokeWidth={1.5} />
                <line x1={cx - 4} x2={cx + 4} y1={yL} y2={yL} stroke={color} strokeWidth={1.5} />
              </>;
            })()}
            <circle cx={cx} cy={cy} r={c.is_base ? 4 : 5}
              fill={c.is_base ? 'white' : color}
              stroke={color} strokeWidth={c.is_base ? 2 : 0} />
          </g>
        );
      })}

      {/* X 轴 */}
      <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} stroke="#555" strokeWidth={1} />
      {coefs.map(c => (
        <g key={c.period}>
          <line x1={xOf(c.period)} x2={xOf(c.period)} y1={H - pad.bottom} y2={H - pad.bottom + 4} stroke="#555" strokeWidth={1} />
          <text x={xOf(c.period)} y={H - pad.bottom + 15} textAnchor="middle" fontSize={10} fill="#444">
            {pLabel(c.period)}{c.is_base ? '' : ''}
          </text>
          {c.is_base && <text x={xOf(c.period)} y={H - pad.bottom + 26} textAnchor="middle" fontSize={9} fill="#999">(基期)</text>}
        </g>
      ))}
      <text x={pad.left + iW / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="#666">事件时间（以 t=−1 为基期）</text>

      {/* Y 轴 */}
      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={H - pad.bottom} stroke="#555" strokeWidth={1} />
      {yTicks.map(t => (
        <g key={t}>
          <line x1={pad.left - 4} x2={pad.left} y1={yOf(t)} y2={yOf(t)} stroke="#555" strokeWidth={1} />
          <text x={pad.left - 7} y={yOf(t) + 4} textAnchor="end" fontSize={10} fill="#444">{fmtY(t)}</text>
        </g>
      ))}
      <text x={13} y={pad.top + iH / 2} textAnchor="middle" fontSize={10} fill="#666"
        transform={`rotate(-90,13,${pad.top + iH / 2})`}>系数估计值</text>

      {/* 图例 */}
      <g transform={`translate(${W - pad.right + 12},${pad.top + 10})`}>
        <circle cx={5} cy={5} r={4} fill="#3b82f6" /><text x={14} y={9} fontSize={10} fill="#444">政策前期</text>
        <circle cx={5} cy={22} r={4} fill="#ef4444" /><text x={14} y={26} fontSize={10} fill="#444">政策后期</text>
        <circle cx={5} cy={39} r={4} fill="white" stroke="#bbb" strokeWidth={2} /><text x={14} y={43} fontSize={10} fill="#444">基期 (t=−1)</text>
        <line x1={1} x2={9} y1={56} y2={56} stroke="#888" strokeWidth={1} strokeDasharray="4,3" /><text x={14} y={60} fontSize={10} fill="#444">政策时点</text>
        <text x={0} y={76} fontSize={9} fill="#888">误差棒 = 95% CI</text>
      </g>
    </svg>
  );
}

function PlaceboHistogram({ coefs, baseline }) {
  if (!coefs?.length) return null;
  const W = 480, H = 200;
  const pad = { top: 24, right: 20, bottom: 36, left: 40 };
  const iW = W - pad.left - pad.right;
  const iH = H - pad.top - pad.bottom;

  const allVals = [...coefs, baseline];
  const rawMin = Math.min(...allVals);
  const rawMax = Math.max(...allVals);
  const range = (rawMax - rawMin) || 1;
  const xPad = range * 0.08;
  const xMin = rawMin - xPad, xMax = rawMax + xPad;

  const nBins = 12;
  const binW = (xMax - xMin) / nBins;
  const bins = new Array(nBins).fill(0);
  coefs.forEach(c => {
    let idx = Math.floor((c - xMin) / binW);
    if (idx < 0) idx = 0;
    if (idx >= nBins) idx = nBins - 1;
    bins[idx]++;
  });
  const maxCount = Math.max(...bins, 1);

  const xOf = v => pad.left + ((v - xMin) / (xMax - xMin)) * iW;
  const yOf = c => pad.top + (1 - c / maxCount) * iH;
  const barW = iW / nBins;
  const fmtX = v => Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3);
  const baseX = xOf(baseline);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxWidth: W, display: 'block', margin: '8px auto 0' }}>
      {bins.map((cnt, i) => {
        const x = pad.left + i * barW;
        const y = yOf(cnt);
        return <rect key={i} x={x + 1} y={y} width={Math.max(barW - 2, 1)} height={(H - pad.bottom) - y}
          fill="#93c5fd" stroke="#60a5fa" strokeWidth={0.5} />;
      })}
      <line x1={baseX} x2={baseX} y1={pad.top} y2={H - pad.bottom}
        stroke="#ef4444" strokeWidth={2} strokeDasharray="5,3" />
      <text x={baseX} y={pad.top - 8} textAnchor="middle" fontSize={10} fill="#ef4444">真实估计值</text>

      <line x1={pad.left} x2={W - pad.right} y1={H - pad.bottom} y2={H - pad.bottom} stroke="#555" strokeWidth={1} />
      <text x={pad.left} y={H - pad.bottom + 16} textAnchor="start" fontSize={10} fill="#444">{fmtX(xMin)}</text>
      <text x={W - pad.right} y={H - pad.bottom + 16} textAnchor="end" fontSize={10} fill="#444">{fmtX(xMax)}</text>
      <text x={pad.left + iW / 2} y={H - 4} textAnchor="middle" fontSize={10} fill="#666">安慰剂随机重分配系数分布（_did）</text>

      <line x1={pad.left} x2={pad.left} y1={pad.top} y2={H - pad.bottom} stroke="#555" strokeWidth={1} />
      <text x={pad.left - 6} y={pad.top + 4} textAnchor="end" fontSize={10} fill="#444">{maxCount}</text>
      <text x={pad.left - 6} y={H - pad.bottom} textAnchor="end" fontSize={10} fill="#444">0</text>
    </svg>
  );
}

function EventStudyTable({ data }) {
  if (!data?.event_coefs?.length) return null;
  const pt = data.parallel_trends_event;
  const seType = { unadjusted: '常规', robust: '稳健', clustered: '聚类' }[data.se_type] || data.se_type;
  const fmtP = p => p == null ? '—' : p < 0.001 ? '<0.001' : p.toFixed(3);

  return (
    <div className="result-block">
      <div className="rb-title">多时点 DID 事件研究</div>
      <div className="rb-meta">
        被解释变量：<strong>{data.dep_var}</strong>　观测数：{data.n}　个体数：{data.n_entities}
        事件窗口：[{-data.window_pre}, {data.window_post}]　基期：t=−1　标准误：{seType}
      </div>

      {/* 系数图 */}
      <EventStudyChart coefs={data.event_coefs} windowPre={data.window_pre} windowPost={data.window_post} />
      <div style={{ textAlign: 'center', fontSize: 11, color: '#888', margin: '4px 0 12px' }}>
        图：事件研究系数图，点为系数估计值，误差棒为 95% 置信区间
      </div>

      {/* 期刊标准表格 */}
      <table className="acad-table reg-tbl">
        <thead>
          <tr>
            <th className="col-var">相对期</th>
            <th className="col-reg">(1)<br /><span className="depvar">{data.dep_var}</span></th>
            <th className="col-reg">p 值</th>
            <th className="col-reg">95% CI</th>
          </tr>
        </thead>
        <tbody>
          {data.event_coefs.map(row => {
            const isBase = row.is_base;
            const isPre = !isBase && row.period < 0;
            const periodLabel = row.period === 0 ? 't = 0' : row.period > 0 ? `t = +${row.period}` : `t = ${row.period}`;
            return (
              <tr key={row.period} style={isBase ? { color: '#999', fontStyle: 'italic', background: '#fafafa' } : isPre ? { background: '#f0f6ff' } : {}}>
                <td className="col-var">{periodLabel}{isBase ? '（基期）' : ''}</td>
                <td className="col-reg">
                  {isBase ? <><div>0</div><div className="tval">(—)</div></> : <>
                    <div>{row.coef?.toFixed(4)}<sup className="sig">{row.sig}</sup></div>
                    <div className="tval">({row.se?.toFixed(4)})</div>
                  </>}
                </td>
                <td className="col-reg">{fmtP(row.p_value)}</td>
                <td className="col-reg">{isBase ? '—' : `[${row.ci_low?.toFixed(4)}, ${row.ci_high?.toFixed(4)}]`}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      {/* 平行趋势检验 */}
      {pt && (
        <div className={pt.pass ? 'hausman-box' : 'dropped-warn'} style={{ marginTop: 10 }}>
          <strong>平行趋势检验</strong>：{pt.conclusion}
        </div>
      )}

      <div className="rb-note">
        注：括号内为{seType}标准误；***p&lt;0.01，**p&lt;0.05，*p&lt;0.1；
        政策前期（蓝色）系数不显著支持平行趋势假设；
        {data.notes?.split('；').slice(-1)[0]}
      </div>
    </div>
  );
}

function RegressionTable({ data, label, bracketMode = "t" }) {
  if (!data?.coefficients?.length) return null;
  const dummySet = new Set(data.dummy_vars || []);
  const cons = data.coefficients.find(c => c.variable === "_cons");
  const mainVars = data.coefficients.filter(c => c.variable !== "_cons" && !dummySet.has(c.variable));
  const dummyVars = data.coefficients.filter(c => dummySet.has(c.variable));
  const isPanel = data.type === "fe" || data.type === "re";
  const isBinary = data.type === "probit" || data.type === "logit";
  const catVars = data.categorical_vars || [];

  function renderCoefCell(c) {
    const bracket = bracketMode === "se" ? c.std_error?.toFixed(3) : c.t_stat?.toFixed(2);
    return (
      <td className="col-reg">
        <div>{(c.coef?.toFixed(3) ?? "—")}<sup className="sig">{c.sig}</sup></div>
        <div className="tval">({bracket ?? "—"})</div>
      </td>
    );
  }

  return (
    <div className="result-block">
      <div className="tbl-title">{label || "回归结果"}</div>
      {data.dropped_vars?.length > 0 && (
        <div className="dropped-warn">⚠️ 以下变量因完全共线性被自动移除（对齐 Stata omit 行为）：{data.dropped_vars.join(", ")}</div>
      )}
      <table className="acad-table reg-tbl">
        <thead><tr>
          <th className="col-var"></th>
          <th className="col-reg">(1)<br /><span className="depvar">{data.dep_var}</span></th>
        </tr></thead>
        <tbody>
          {mainVars.map((c, i) => (
            <tr key={i}>
              <td className="col-var">{c.variable}</td>
              {renderCoefCell(c)}
            </tr>
          ))}
          {dummyVars.map((c, i) => (
            <tr key={"d" + i} className="dummy-coef-row">
              <td className="col-var">{c.variable}</td>
              {renderCoefCell(c)}
            </tr>
          ))}
          {cons && (
            <tr>
              <td className="col-var">_cons</td>
              {renderCoefCell(cons)}
            </tr>
          )}
          {catVars.map(cv => (
            <tr key={"cat_" + cv} className="fe-row">
              <td className="col-var">{cv} 虚拟化</td>
              <td className="col-reg">Yes</td>
            </tr>
          ))}
          <tr className="fe-row"><td className="col-var">时间固定效应</td><td className="col-reg">{data.time_effects ? "Yes" : "No"}</td></tr>
          <tr className="stat-row"><td className="col-var">N</td><td className="col-reg">{data.n?.toLocaleString()}</td></tr>
          {isPanel ? (
            <>
              <tr className="stat-row"><td className="col-var">R² (within)</td><td className="col-reg">{data.r2_within?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">R² (overall)</td><td className="col-reg">{data.r2_overall?.toFixed(3)}</td></tr>
            </>
          ) : isBinary ? (
            <>
              <tr className="stat-row"><td className="col-var">Pseudo R² (McFadden)</td><td className="col-reg">{data.pseudo_r2?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">Log-likelihood</td><td className="col-reg">{data.log_likelihood?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">LR χ²</td><td className="col-reg">{data.lr_chi2?.toFixed(3)}{data.lr_pvalue != null && <sup className="sig">{sigStars(data.lr_pvalue)}</sup>}</td></tr>
            </>
          ) : (
            <>
              <tr className="stat-row"><td className="col-var">R²</td><td className="col-reg">{data.r2?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">Adj. R²</td><td className="col-reg">{data.r2_adj?.toFixed(3)}</td></tr>
              <tr className="stat-row"><td className="col-var">F</td><td className="col-reg">{data.f_stat?.toFixed(3)}</td></tr>
            </>
          )}
        </tbody>
      </table>
      {data.hausman && (
        <div className="hausman-box">
          <strong>Hausman 检验</strong>：χ²={data.hausman.chi2}，p={data.hausman.p_value}
          <br />{data.hausman.conclusion}
        </div>
      )}
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function MarginalEffectsTable({ data }) {
  if (!data?.margeff?.length) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">平均边际效应（AME）</div>
      <table className="acad-table reg-tbl">
        <thead><tr>
          <th className="col-var">变量</th>
          <th className="col-reg">dy/dx</th>
          <th className="col-reg">Std. Err.</th>
          <th className="col-reg">z</th>
          <th className="col-reg">p</th>
        </tr></thead>
        <tbody>
          {data.margeff.map((m, i) => (
            <tr key={i}>
              <td className="col-var">{m.variable}</td>
              <td className="col-reg">{m.dydx?.toFixed(4)}<sup className="sig">{m.sig}</sup></td>
              <td className="col-reg">{m.std_error?.toFixed(4)}</td>
              <td className="col-reg">{m.z_stat?.toFixed(2)}</td>
              <td className="col-reg">{m.p_value?.toFixed(3)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="tbl-note">dy/dx 表示自变量变化对“被解释变量=1”概率的平均边际影响，对应 Stata margins, dydx(*)；***p&lt;0.01, **p&lt;0.05, *p&lt;0.1</div>
    </div>
  );
}

function PSMBalanceTable({ balance, balanceSummary, showPsR2 = true }) {
  if (!balance?.length) return null;
  return (
    <>
      <div className="tbl-scroll">
        <table className="acad-table reg-tbl" style={{ marginTop: 10 }}>
          <thead><tr>
            <th className="col-var">协变量</th>
            <th className="col-reg">样本</th>
            <th className="col-reg">处理组均值</th>
            <th className="col-reg">对照组均值</th>
            <th className="col-reg">%Bias</th>
            <th className="col-reg">%Reduct|Bias|</th>
            <th className="col-reg">t</th>
            <th className="col-reg">p&gt;|t|</th>
          </tr></thead>
          <tbody>
            {balance.map((b, i) => (
              <React.Fragment key={i}>
                <tr>
                  <td className="col-var" rowSpan={2}>{b.variable}</td>
                  <td className="col-reg">Unmatched</td>
                  <td className="col-reg">{b.treated_mean_unmatched}</td>
                  <td className="col-reg">{b.control_mean_unmatched}</td>
                  <td className="col-reg">{b.bias_unmatched}</td>
                  <td className="col-reg">—</td>
                  <td className="col-reg">{b.t_unmatched ?? "—"}</td>
                  <td className="col-reg">{b.p_unmatched ?? "—"}</td>
                </tr>
                <tr className="dummy-coef-row">
                  <td className="col-reg">Matched</td>
                  <td className="col-reg">{b.treated_mean_matched ?? "—"}</td>
                  <td className="col-reg">{b.control_mean_matched ?? "—"}</td>
                  <td className="col-reg">{b.bias_matched ?? "—"}{Math.abs(b.bias_matched ?? 0) >= 10 ? " ⚠️" : ""}</td>
                  <td className="col-reg">{b.pct_reduct ?? "—"}</td>
                  <td className="col-reg">{b.t_matched ?? "—"}</td>
                  <td className="col-reg">{b.p_matched ?? "—"}</td>
                </tr>
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {balanceSummary && (
        <div className="tbl-note">
          {showPsR2 && <>Pseudo R² = {balanceSummary.ps_r2}　LR χ² = {balanceSummary.lr_chi2}（p = {balanceSummary.lr_chi2_pvalue}）<br /></>}
          Mean |Bias|: {balanceSummary.mean_bias_unmatched} → {balanceSummary.mean_bias_matched ?? "—"}
          Median |Bias|: {balanceSummary.median_bias_unmatched} → {balanceSummary.median_bias_matched ?? "—"}
        </div>
      )}
    </>
  );
}

function PSMTable({ data }) {
  if (!data) return null;
  return (
    <div className="result-block">
      <div className="tbl-title">倾向得分匹配（PSM）结果</div>
      <table className="acad-table reg-tbl">
        <thead><tr>
          <th className="col-var"></th>
          <th className="col-reg">ATT</th>
        </tr></thead>
        <tbody>
          <tr>
            <td className="col-var">{data.dep_var}</td>
            <td className="col-reg">
              <div>{data.att?.toFixed(4)}<sup className="sig">{data.sig}</sup></div>
              <div className="tval">({data.se != null ? data.se.toFixed(4) : "—"})</div>
            </td>
          </tr>
          <tr className="stat-row"><td className="col-var">t</td><td className="col-reg">{data.t_stat ?? "—"}</td></tr>
          <tr className="stat-row"><td className="col-var">p</td><td className="col-reg">{data.p_value ?? "—"}</td></tr>
          <tr className="stat-row"><td className="col-var">处理组 N</td><td className="col-reg">{data.n_treated?.toLocaleString()}</td></tr>
          <tr className="stat-row"><td className="col-var">对照组 N</td><td className="col-reg">{data.n_control?.toLocaleString()}</td></tr>
          <tr className="stat-row"><td className="col-var">匹配成功数</td><td className="col-reg">{data.n_matched?.toLocaleString()}</td></tr>
          <tr className="stat-row"><td className="col-var">未匹配数</td><td className="col-reg">{data.n_unmatched?.toLocaleString()}</td></tr>
          <tr className="stat-row"><td className="col-var">超出共同支撑域</td><td className="col-reg">{data.n_outside_support?.toLocaleString()}</td></tr>
        </tbody>
      </table>
      <PSMBalanceTable balance={data.balance} balanceSummary={data.balance_summary} />
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function PSMDIDResult({ data }) {
  if (!data) return null;
  return (
    <div className="result-block">
      <div className="rb-title">PSM-DID 基期锁定匹配</div>
      <div className="rb-meta">
        {data.mode}　处理组个体 {data.n_treated_total} 个，匹配成功 {data.n_matched_treated} 个
        （基期无观测剔除 {data.n_excluded_missing_baseline} 个，超出caliper未匹配 {data.n_excluded_caliper} 个）
        　对照组使用 {data.n_control_used} 个　面板还原后共 {data.n_final_entities} 个实体
      </div>

      <table className="acad-table reg-tbl" style={{ marginTop: 10 }}>
        <thead><tr>
          <th className="col-var">基期（Baseline Year）</th>
          <th className="col-reg">处理组候选</th>
          <th className="col-reg">对照组候选</th>
          <th className="col-reg">匹配成功</th>
          <th className="col-reg">未匹配</th>
          <th className="col-reg">Pseudo R²</th>
        </tr></thead>
        <tbody>
          {data.blocks?.map((b, i) => (
            <tr key={i}>
              <td className="col-var">{b.baseline_year}</td>
              <td className="col-reg">{b.n_treated_candidates}</td>
              <td className="col-reg">{b.n_control_candidates}</td>
              <td className="col-reg">{b.n_matched}</td>
              <td className="col-reg">{b.n_unmatched}</td>
              <td className="col-reg">{b.ps_r2 ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tbl-title" style={{ marginTop: 10 }}>平衡性检验（基期截面，跨block合并）</div>
      <PSMBalanceTable balance={data.balance} balanceSummary={data.balance_summary} showPsR2={false} />

      {data.mapping?.length > 0 && (
        <>
          <div className="tbl-title" style={{ marginTop: 10 }}>
            匹配映射表（仅展示前 {Math.min(20, data.mapping.length)} / {data.mapping.length} 条，完整匹配关系及还原后的面板数据请见 Excel 导出）
          </div>
          <div className="tbl-scroll">
            <table className="acad-table reg-tbl">
              <thead><tr>
                <th className="col-var">处理组个体</th>
                <th className="col-reg">基期</th>
                <th className="col-reg">倾向得分</th>
                <th className="col-reg">匹配对照个体</th>
              </tr></thead>
              <tbody>
                {data.mapping.slice(0, 20).map((m, i) => (
                  <tr key={i}>
                    <td className="col-var">{m.entity}</td>
                    <td className="col-reg">{m.baseline_year}</td>
                    <td className="col-reg">{m.pscore}</td>
                    <td className="col-reg">{m.matched_controls.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function CompareTable({ results }) {
  const [bracketMode, setBracketMode] = useState("t");

  const modelDefs = [
    { key: "ols",      label: "OLS" },
    { key: "panel_fe", label: "固定效应" },
    { key: "panel_re", label: "随机效应" },
  ];
  const models = modelDefs.filter(m => results?.[m.key]?.coefficients?.length).map(m => ({ ...m, data: results[m.key] }));
  if (models.length < 2) return null;

  // Collect main variable names (excluding dummy vars and _cons)
  const dummySets = models.map(m => new Set(m.data.dummy_vars || []));
  const seenVars = new Set();
  const mainVars = [];
  for (const { data } of models) {
    for (const c of data.coefficients) {
      if (c.variable === "_cons") continue;
      const isDummy = models.some(m => (m.data.dummy_vars || []).includes(c.variable));
      if (!isDummy && !seenVars.has(c.variable)) {
        seenVars.add(c.variable);
        mainVars.push(c.variable);
      }
    }
  }
  const hasCons = models.some(m => m.data.coefficients.some(c => c.variable === "_cons"));
  const allCatVars = [...new Set(models.flatMap(m => m.data.categorical_vars || []))];

  function getCoef(modelData, varName) {
    return modelData.coefficients.find(c => c.variable === varName);
  }
  function renderCell(coef) {
    if (!coef) return <td className="col-reg compare-cell">—</td>;
    const bracket = bracketMode === "se" ? coef.std_error?.toFixed(3) : coef.t_stat?.toFixed(2);
    return (
      <td className="col-reg compare-cell">
        <div>{(coef.coef?.toFixed(3) ?? "—")}<sup className="sig">{coef.sig}</sup></div>
        <div className="tval">({bracket ?? "—"})</div>
      </td>
    );
  }

  return (
    <div className="result-block">
      <div className="tbl-title-row">
        <span className="tbl-title">回归结果对比</span>
        <span className="bracket-toggle">
          括号内：
          <button className={`btn-tog ${bracketMode === "t" ? "active" : ""}`} onClick={() => setBracketMode("t")}>t 值</button>
          <button className={`btn-tog ${bracketMode === "se" ? "active" : ""}`} onClick={() => setBracketMode("se")}>标准误</button>
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="acad-table reg-tbl compare-tbl">
          <thead><tr>
            <th className="col-var"></th>
            {models.map((m, i) => (
              <th key={m.key} className="col-reg">
                ({i + 1}) {m.label}<br /><span className="depvar">{m.data.dep_var}</span>
              </th>
            ))}
          </tr></thead>
          <tbody>
            {mainVars.map(v => (
              <tr key={v}>
                <td className="col-var">{v}</td>
                {models.map(m => <React.Fragment key={m.key}>{renderCell(getCoef(m.data, v))}</React.Fragment>)}
              </tr>
            ))}
            {hasCons && (
              <tr>
                <td className="col-var">_cons</td>
                {models.map(m => <React.Fragment key={m.key}>{renderCell(getCoef(m.data, "_cons"))}</React.Fragment>)}
              </tr>
            )}
            {allCatVars.map(cv => (
              <tr key={"cat_" + cv} className="fe-row">
                <td className="col-var">{cv} 虚拟化</td>
                {models.map(m => <td key={m.key} className="col-reg">{(m.data.categorical_vars || []).includes(cv) ? "Yes" : "No"}</td>)}
              </tr>
            ))}
            <tr className="fe-row">
              <td className="col-var">时间固定效应</td>
              {models.map(m => <td key={m.key} className="col-reg">{m.data.time_effects ? "Yes" : "No"}</td>)}
            </tr>
            <tr className="stat-row">
              <td className="col-var">N</td>
              {models.map(m => <td key={m.key} className="col-reg">{m.data.n?.toLocaleString()}</td>)}
            </tr>
            {models.some(m => m.data.type === "ols") && (
              <tr className="stat-row">
                <td className="col-var">R²</td>
                {models.map(m => <td key={m.key} className="col-reg">{m.data.type === "ols" ? m.data.r2?.toFixed(3) : "—"}</td>)}
              </tr>
            )}
            {models.some(m => m.data.type === "fe" || m.data.type === "re") && (
              <tr className="stat-row">
                <td className="col-var">R² (within)</td>
                {models.map(m => <td key={m.key} className="col-reg">{(m.data.type === "fe" || m.data.type === "re") ? m.data.r2_within?.toFixed(3) : "—"}</td>)}
              </tr>
            )}
            <tr className="stat-row">
              <td className="col-var">SE 类型</td>
              {models.map(m => <td key={m.key} className="col-reg">{m.data.se_type}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="tbl-note">括号内为{bracketMode === "t" ? "t 值" : "标准误"}，***p&lt;0.01, **p&lt;0.05, *p&lt;0.1</div>
    </div>
  );
}

// ─── 中介效应分析：Baron-Kenny 三步合并对比表（对齐论文常见排版，三步并列为列而非堆叠三张表）──
function MediationTable({ data }) {
  const [bracketMode, setBracketMode] = useState("t");
  const { step1, step2, step3, indep_var, mediator_var, control_vars } = data;
  const steps = [
    { key: "step1", label: "总效应 c",     data: step1 },
    { key: "step2", label: "路径 a",       data: step2 },
    { key: "step3", label: "路径 b / c'",  data: step3 },
  ];

  function getCoef(stepData, varName) {
    return stepData?.coefficients?.find(c => c.variable === varName);
  }
  function renderCell(coef) {
    if (!coef) return <td className="col-reg compare-cell">—</td>;
    const bracket = bracketMode === "se" ? coef.std_error?.toFixed(3) : coef.t_stat?.toFixed(2);
    return (
      <td className="col-reg compare-cell">
        <div>{(coef.coef?.toFixed(3) ?? "—")}<sup className="sig">{coef.sig}</sup></div>
        <div className="tval">({bracket ?? "—"})</div>
      </td>
    );
  }

  return (
    <div className="result-block">
      <div className="tbl-title-row">
        <span className="tbl-title">中介效应检验结果 · Baron-Kenny 三步法</span>
        <span className="bracket-toggle">
          括号内：
          <button className={`btn-tog ${bracketMode === "t" ? "active" : ""}`} onClick={() => setBracketMode("t")}>t 值</button>
          <button className={`btn-tog ${bracketMode === "se" ? "active" : ""}`} onClick={() => setBracketMode("se")}>标准误</button>
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="acad-table reg-tbl compare-tbl">
          <thead><tr>
            <th className="col-var"></th>
            {steps.map((s, i) => (
              <th key={s.key} className="col-reg">
                ({i + 1}) {s.data?.dep_var}<br /><span className="depvar">{s.label}</span>
              </th>
            ))}
          </tr></thead>
          <tbody>
            <tr>
              <td className="col-var">{indep_var}</td>
              {steps.map(s => <React.Fragment key={s.key}>{renderCell(getCoef(s.data, indep_var))}</React.Fragment>)}
            </tr>
            <tr>
              <td className="col-var">{mediator_var}</td>
              <td className="col-reg compare-cell">—</td>
              <td className="col-reg compare-cell">—</td>
              {renderCell(getCoef(step3, mediator_var))}
            </tr>
            {(control_vars || []).length > 0 && (
              <tr className="fe-row">
                <td className="col-var">控制变量</td>
                {steps.map(s => <td key={s.key} className="col-reg">Yes</td>)}
              </tr>
            )}
            <tr>
              <td className="col-var">_cons</td>
              {steps.map(s => <React.Fragment key={s.key}>{renderCell(getCoef(s.data, "_cons"))}</React.Fragment>)}
            </tr>
            <tr className="stat-row">
              <td className="col-var">N</td>
              {steps.map(s => <td key={s.key} className="col-reg">{s.data?.n?.toLocaleString()}</td>)}
            </tr>
            <tr className="stat-row">
              <td className="col-var">R²</td>
              {steps.map(s => <td key={s.key} className="col-reg">{s.data?.r2?.toFixed(3) ?? "—"}</td>)}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="tbl-note">
        括号内为{bracketMode === "t" ? "t 值" : "标准误"}，***p&lt;0.01, **p&lt;0.05, *p&lt;0.1；
        模型(1)估计 X→Y 总效应 c，模型(2)估计 X→M 路径 a，模型(3)纳入 M 后估计 X 的直接效应 c' 及 M→Y 路径 b
      </div>
    </div>
  );
}

// ─── 异质性分析：分组对比表（通用，按 data.groups 动态列数渲染）──
function HeterogeneityTable({ data }) {
  const [bracketMode, setBracketMode] = useState("t");
  if (!data?.groups?.length) return null;
  const valid = data.groups.filter(g => g.result?.coefficients?.length);
  if (!valid.length) return null;

  const seenVars = new Set();
  const mainVars = [];
  valid.forEach(g => g.result.coefficients.forEach(c => {
    if (c.variable !== "_cons" && !seenVars.has(c.variable)) { seenVars.add(c.variable); mainVars.push(c.variable); }
  }));
  const hasCons = valid.some(g => g.result.coefficients.some(c => c.variable === "_cons"));
  const isPanel = data.model_type === "fe";

  function getCoef(g, v) { return g.result?.coefficients?.find(c => c.variable === v); }
  function renderCell(coef) {
    if (!coef) return <td className="col-reg compare-cell">—</td>;
    const bracket = bracketMode === "se" ? coef.std_error?.toFixed(3) : coef.t_stat?.toFixed(2);
    return (
      <td className="col-reg compare-cell">
        <div>{(coef.coef?.toFixed(3) ?? "—")}<sup className="sig">{coef.sig}</sup></div>
        <div className="tval">({bracket ?? "—"})</div>
      </td>
    );
  }

  return (
    <div className="result-block">
      <div className="tbl-title-row">
        <span className="tbl-title">异质性分析 · 分组对比（按 {data.group_var} 拆分）</span>
        <span className="bracket-toggle">
          括号内：
          <button className={`btn-tog ${bracketMode === "t" ? "active" : ""}`} onClick={() => setBracketMode("t")}>t 值</button>
          <button className={`btn-tog ${bracketMode === "se" ? "active" : ""}`} onClick={() => setBracketMode("se")}>标准误</button>
        </span>
      </div>
      <div className="tbl-scroll">
        <table className="acad-table reg-tbl compare-tbl">
          <thead><tr>
            <th className="col-var"></th>
            {data.groups.map((g, i) => (
              <th key={i} className="col-reg">({i + 1}) {g.label}<br /><span className="depvar">N = {g.n?.toLocaleString?.() ?? g.n}</span></th>
            ))}
          </tr></thead>
          <tbody>
            {mainVars.map(v => (
              <tr key={v}>
                <td className="col-var">{v}</td>
                {data.groups.map((g, i) => <React.Fragment key={i}>{renderCell(getCoef(g, v))}</React.Fragment>)}
              </tr>
            ))}
            {hasCons && (
              <tr>
                <td className="col-var">_cons</td>
                {data.groups.map((g, i) => <React.Fragment key={i}>{renderCell(getCoef(g, "_cons"))}</React.Fragment>)}
              </tr>
            )}
            <tr className="stat-row">
              <td className="col-var">N</td>
              {data.groups.map((g, i) => <td key={i} className="col-reg">{g.result ? (g.n?.toLocaleString?.() ?? g.n) : (g.error || "—")}</td>)}
            </tr>
            <tr className="stat-row">
              <td className="col-var">{isPanel ? "R² (within)" : "R²"}</td>
              {data.groups.map((g, i) => (
                <td key={i} className="col-reg">
                  {isPanel ? (g.result?.r2_within?.toFixed(3) ?? "—") : (g.result?.r2?.toFixed(3) ?? "—")}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

// ─── 工具变量法 2SLS：回归结果 + 第一阶段 F 检验 + 过度识别检验 ──
function IVTable({ data }) {
  const [bracketMode, setBracketMode] = useState("t");
  if (!data?.coefficients?.length) return null;
  const cons = data.coefficients.find(c => c.variable === "_cons");
  const mainVars = data.coefficients.filter(c => c.variable !== "_cons");
  const endogSet = new Set(data.endog_vars || []);

  function renderCoefCell(c) {
    const bracket = bracketMode === "se" ? c.std_error?.toFixed(3) : c.t_stat?.toFixed(2);
    return (
      <td className="col-reg">
        <div>{(c.coef?.toFixed(3) ?? "—")}<sup className="sig">{c.sig}</sup></div>
        <div className="tval">({bracket ?? "—"})</div>
      </td>
    );
  }

  return (
    <div className="result-block">
      <div className="tbl-title-row">
        <span className="tbl-title">工具变量法 2SLS 回归结果</span>
        <span className="bracket-toggle">
          括号内：
          <button className={`btn-tog ${bracketMode === "t" ? "active" : ""}`} onClick={() => setBracketMode("t")}>t 值</button>
          <button className={`btn-tog ${bracketMode === "se" ? "active" : ""}`} onClick={() => setBracketMode("se")}>标准误</button>
        </span>
      </div>
      <table className="acad-table reg-tbl">
        <thead><tr>
          <th className="col-var"></th>
          <th className="col-reg">(1)<br /><span className="depvar">{data.dep_var}</span></th>
        </tr></thead>
        <tbody>
          {mainVars.map((c, i) => (
            <tr key={i} className={endogSet.has(c.variable) ? "dummy-coef-row" : ""}>
              <td className="col-var">{c.variable}{endogSet.has(c.variable) && <span className="vh"> (内生)</span>}</td>
              {renderCoefCell(c)}
            </tr>
          ))}
          {cons && (
            <tr>
              <td className="col-var">_cons</td>
              {renderCoefCell(cons)}
            </tr>
          )}
          <tr className="fe-row"><td className="col-var">工具变量</td><td className="col-reg">{(data.instrument_vars || []).join(", ")}</td></tr>
          <tr className="stat-row"><td className="col-var">N</td><td className="col-reg">{data.n?.toLocaleString()}</td></tr>
          <tr className="stat-row"><td className="col-var">R²</td><td className="col-reg">{data.r2?.toFixed(3) ?? "—"}</td></tr>
        </tbody>
      </table>
      {data.first_stage?.length > 0 && (
        <div className={data.first_stage.some(f => f.weak) ? "dropped-warn" : "hausman-box"}>
          <strong>第一阶段 F 检验（弱工具变量诊断）</strong>
          {data.first_stage.map(f => (
            <div key={f.variable}>
              {f.variable}：F = {f.f_stat}，p = {f.f_pvalue}
              {f.weak ? "（F<10，存在弱工具变量风险）" : "（F≥10，未发现弱工具变量问题）"}
            </div>
          ))}
        </div>
      )}
      {data.overid_test && (
        <div className={data.overid_test.p_value >= 0.1 ? "hausman-box" : "dropped-warn"}>
          <strong>过度识别检验（Sargan）</strong>：统计量={data.overid_test.stat}，p={data.overid_test.p_value}
          <br />{data.overid_test.conclusion}
        </div>
      )}
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

// ─── 主成分分析 PCA：方差贡献率表 + 载荷表 ──
function PCATable({ data }) {
  if (!data?.components?.length) return null;
  const su = data.suitability;
  const cs = data.composite_score;
  return (
    <div className="result-block">
      <div className="tbl-title">主成分分析结果（{data.matrix_label}，N={data.n?.toLocaleString()}）</div>
      {su && (
        <div className={(su.kmo != null && su.kmo >= 0.6 && su.bartlett_sig) ? "hausman-box" : "dropped-warn"} style={{ marginBottom: 16 }}>
          <strong>适用性检验</strong>
          <br />KMO 抽样适当性度量 = {su.kmo != null ? su.kmo.toFixed(4) : "—"}（{su.kmo_label}）
          <br />Bartlett 球形检验：{su.bartlett_chi2 != null
            ? <>χ²({su.bartlett_df}) = {su.bartlett_chi2.toFixed(3)}，p {su.bartlett_p < 0.001 ? "< 0.001" : `= ${su.bartlett_p.toFixed(4)}`}
                {su.bartlett_sig ? "，显著（拒绝相关系数矩阵为单位矩阵的原假设，适合做主成分分析）" : "，不显著（变量间相关性可能不足，不太适合做主成分分析）"}</>
            : "—（相关系数矩阵奇异，无法计算）"}
        </div>
      )}
      <div className="tbl-scroll">
        <table className="acad-table reg-tbl">
          <thead><tr>
            <th className="col-var">主成分</th>
            <th className="col-reg">特征值</th>
            <th className="col-reg">方差贡献率</th>
            <th className="col-reg">累计贡献率</th>
            <th className="col-reg">是否保留</th>
          </tr></thead>
          <tbody>
            {data.components.map(c => (
              <tr key={c.component} className={c.retained ? "" : "dummy-coef-row"}>
                <td className="col-var">{c.component}</td>
                <td className="col-reg">{c.eigenvalue.toFixed(3)}</td>
                <td className="col-reg">{(c.explained * 100).toFixed(2)}%</td>
                <td className="col-reg">{(c.cumulative * 100).toFixed(2)}%</td>
                <td className="col-reg">{c.retained ? "Yes" : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tbl-title" style={{ marginTop: 16 }}>主成分载荷（仅展示已保留的 {data.n_retained} 个主成分）</div>
      <div className="tbl-scroll">
        <table className="acad-table reg-tbl">
          <thead><tr>
            <th className="col-var">变量</th>
            {Array.from({ length: data.n_retained }, (_, j) => (
              <th key={j} className="col-reg">Comp{j + 1}</th>
            ))}
          </tr></thead>
          <tbody>
            {data.loadings.map(row => (
              <tr key={row.variable}>
                <td className="col-var">{row.variable}</td>
                {Array.from({ length: data.n_retained }, (_, j) => (
                  <td key={j} className="col-reg">{row[`Comp${j + 1}`]?.toFixed(3)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cs && (
        <>
          <div className="tbl-title" style={{ marginTop: 16 }}>综合得分（按方差贡献率加权）</div>
          <div className="hausman-box" style={{ marginBottom: 12 }}>
            {cs.formula}
            <br />均值 = {cs.mean.toFixed(4)}　标准差 = {cs.std.toFixed(4)}　最小值 = {cs.min.toFixed(4)}　最大值 = {cs.max.toFixed(4)}
            {data.score_column && (
              <><br /><strong>已自动生成新变量「{data.score_column}」</strong>并写入清洗数据，可直接在后续回归等分析中作为变量选用（无需重新清洗）</>
            )}
          </div>
          <div className="tbl-scroll">
            <table className="acad-table reg-tbl">
              <thead><tr>
                <th className="col-var">权重</th>
                {cs.weights.map(w => <th key={w.component} className="col-reg">{w.component}</th>)}
              </tr></thead>
              <tbody>
                <tr>
                  <td className="col-var">方差贡献率占比</td>
                  {cs.weights.map(w => <td key={w.component} className="col-reg">{w.weight.toFixed(4)}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="tbl-scroll" style={{ marginTop: 8 }}>
            <table className="acad-table reg-tbl">
              <thead><tr>
                <th className="col-var">综合得分最高的样本（行号）</th>
                <th className="col-reg">得分</th>
                <th className="col-var">综合得分最低的样本（行号）</th>
                <th className="col-reg">得分</th>
              </tr></thead>
              <tbody>
                {cs.top.map((t, i) => (
                  <tr key={i}>
                    <td className="col-var">#{t.row}</td>
                    <td className="col-reg">{t.score.toFixed(4)}</td>
                    <td className="col-var">#{cs.bottom[i]?.row}</td>
                    <td className="col-reg">{cs.bottom[i] != null ? cs.bottom[i].score.toFixed(4) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <div className="tbl-note">{data.notes}</div>
    </div>
  );
}

function TagSelector({ options, selected, onChange, single, dtypes }) {
  function dtBadge(col) {
    if (!dtypes) return null;
    const t = dtypes[col] || "";
    if (t.startsWith("float"))    return <span className="dt-badge dt-num">float</span>;
    if (t.startsWith("int"))      return <span className="dt-badge dt-int">int</span>;
    if (t.startsWith("datetime")) return <span className="dt-badge dt-date">日期</span>;
    if (t === "object" || t.startsWith("string")) return <span className="dt-badge dt-str">文本</span>;
    if (t.startsWith("bool"))     return <span className="dt-badge dt-bool">bool</span>;
    if (t) return <span className="dt-badge dt-other">{t.split("[")[0]}</span>;
    return null;
  }
  return (
    <div className="tag-sel">
      {options.map(opt => (
        <span key={opt} className={`vtag ${selected.includes(opt) ? "sel" : ""}`}
          onClick={() => {
            if (single) onChange(selected.includes(opt) ? [] : [opt]);
            else onChange(selected.includes(opt) ? selected.filter(v => v !== opt) : [...selected, opt]);
          }}>{opt}{dtBadge(opt)}</span>
      ))}
    </div>
  );
}

// ─── 主组件 ─────────────────────────────────────────
export default function Home() {
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const [filePreviews, setFilePreviews] = useState([]);
  const [fieldMaps, setFieldMaps] = useState({});
  const [showFieldMapper, setShowFieldMapper] = useState(false);
  const [mergeStrategy, setMergeStrategy] = useState("inner");
  const [mergeKeys, setMergeKeys] = useState([]);
  const [mergeCheck, setMergeCheck] = useState(null);
  const [mergeCheckLoading, setMergeCheckLoading] = useState(false);
  const [missingStrategy, setMissingStrategy] = useState("drop");
  const [missingCols, setMissingCols] = useState([]);
  const [outlierStrategy, setOutlierStrategy] = useState("none");
  const [outlierThreshold, setOutlierThreshold] = useState(3.0);
  const [dropCols, setDropCols] = useState([]);
  const [strCols, setStrCols] = useState([]);
  const [logVars, setLogVars] = useState([]);
  const [dedupVars, setDedupVars] = useState([]);
  const [dedupKeep, setDedupKeep] = useState("first");
  const [winsorizeVars, setWinsorizeVars] = useState([]);
  const [winsorizeLower, setWinsorizeLower] = useState(1);
  const [winsorizeUpper, setWinsorizeUpper] = useState(99);
  const [lagVars, setLagVars] = useState([]);
  const [lagPeriods, setLagPeriods] = useState(1);
  const [lagEntityVar, setLagEntityVar] = useState("");
  const [lagTimeVar, setLagTimeVar] = useState("");
  const [cleanedData, setCleanedData] = useState(null);
  const [cleanReport, setCleanReport] = useState(null);
  const [cleanPreview, setCleanPreview] = useState(null);
  const [doClean, setDoClean] = useState("");
  const [layer1Loading, setLayer1Loading] = useState(false);
  const [isCleaning, setIsCleaning] = useState(false);        // true when /merge-and-clean is running
  const [sessionId, setSessionId] = useState(null);           // server-side raw-file cache session
  const [cleanedSessionId, setCleanedSessionId] = useState(null); // server-side cleaned-data session
  const [uploadProgress, setUploadProgress] = useState(null); // null | 0-100
  const [uploadSpeed, setUploadSpeed] = useState(null);       // bytes/s
  const [uploadETA, setUploadETA] = useState(null);           // seconds

  const [analysisTypes, setAnalysisTypes] = useState([]);
  const [selectedVars, setSelectedVars] = useState([]);
  const [depVar, setDepVar] = useState("");
  const [indepVars, setIndepVars] = useState([]);
  const [controlVars, setControlVars] = useState([]);
  const [entityVar, setEntityVar] = useState("");
  const [timeVar, setTimeVar] = useState("");
  const [robustSE, setRobustSE] = useState(false);
  const [clusterVar, setClusterVar] = useState("");
  const [timeEffects, setTimeEffects] = useState(false);
  const [moderatorVar, setModeratorVar] = useState("");
  const [treatmentVar, setTreatmentVar] = useState("");
  const [psmNeighbors, setPsmNeighbors] = useState(1);
  const [psmCaliper, setPsmCaliper] = useState("");
  const [policyTime, setPolicyTime] = useState("");
  const [treatTimeVar, setTreatTimeVar] = useState("");
  const [windowPre, setWindowPre] = useState(3);
  const [windowPost, setWindowPost] = useState(3);
  const [mediatorVar, setMediatorVar] = useState("");
  const [groupVar, setGroupVar] = useState("");
  const [groupMethod, setGroupMethod] = useState("median");
  const [endogVars, setEndogVars] = useState([]);
  const [instrumentVars, setInstrumentVars] = useState([]);
  const [pcaStandardize, setPcaStandardize] = useState(true);
  const [analyzeResults, setAnalyzeResults] = useState(null);
  const [doAnalyze, setDoAnalyze] = useState("");
  const [layer2Loading, setLayer2Loading] = useState(false);
  const [interpret, setInterpret] = useState(false);
  const [customQ, setCustomQ] = useState("");

  const [showUnlockModal, setShowUnlockModal] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [unlockCodeInput, setUnlockCodeInput] = useState("");
  const [unlockError, setUnlockError] = useState("");
  const [unlockVerifying, setUnlockVerifying] = useState(false);
  const [unlockContact, setUnlockContact] = useState("");
  const [unlockSubmitting, setUnlockSubmitting] = useState(false);
  const [unlockIssuedCode, setUnlockIssuedCode] = useState("");

  const fileRef = useRef();

  useEffect(() => {
    track("page_view");
    try {
      if (localStorage.getItem("activation_unlocked") === "1") setUnlocked(true);
    } catch (e) {}
  }, []);

  function fmtSize(b) {
    if (!b) return "0 B";
    if (b < 1024) return `${b} B`;
    if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
    return `${(b / 1024 / 1024).toFixed(1)} MB`;
  }
  function fmtSpeed(bps) {
    if (bps < 1024) return `${Math.round(bps)} B/s`;
    if (bps < 1024 * 1024) return `${(bps / 1024).toFixed(0)} KB/s`;
    return `${(bps / 1024 / 1024).toFixed(1)} MB/s`;
  }
  function fmtETA(s) {
    if (!s || s < 1) return "< 1秒";
    if (s < 60) return `${Math.round(s)}秒`;
    return `${Math.floor(s / 60)}分${Math.round(s % 60)}秒`;
  }

  function openUnlockModal(source = "locked_analysis_card") {
    setUnlockError("");
    setUnlockIssuedCode("");
    setShowUnlockModal(true);
    track("unlock_modal_shown", { source });
  }

  function handleExport(format, doExport) {
    if (!unlocked) {
      track("export_blocked", { format });
      openUnlockModal("export");
      return;
    }
    doExport();
    track("export_clicked", { format });
  }

  function unlockWithCode(code) {
    try {
      localStorage.setItem("activation_code", code);
      localStorage.setItem("activation_unlocked", "1");
    } catch (e) {}
    setUnlocked(true);
    track("unlock_success");
  }

  async function verifyUnlockCode() {
    const code = unlockCodeInput.trim();
    if (!code) return;
    setUnlockVerifying(true);
    setUnlockError("");
    try {
      const res = await fetch(`${API_URL}/api/activation/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json();
      if (data.valid) {
        unlockWithCode(code);
      } else {
        setUnlockError("激活码无效，请检查后重试");
      }
    } catch (e) {
      setUnlockError("校验失败，请检查网络后重试");
    }
    setUnlockVerifying(false);
  }

  async function submitUnlockContact() {
    const contact = unlockContact.trim();
    if (!contact) return;
    setUnlockSubmitting(true);
    try {
      const res = await fetch(`${API_URL}/api/leads/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contact, source: "unlock_modal" }),
      });
      const data = await res.json();
      if (data.activation_code) {
        setUnlockIssuedCode(data.activation_code);
        unlockWithCode(data.activation_code);
      }
    } catch (e) {
      setUnlockError("提交失败，请检查网络后重试");
    }
    setUnlockSubmitting(false);
    track("unlock_contact_submitted", { source: "unlock_modal" });
  }

  async function handleUpload(newFiles) {
    if (!newFiles.length) return;
    const combined = [...uploadedFiles, ...Array.from(newFiles)].slice(0, 5);
    setUploadedFiles(combined);
    const form = new FormData();
    combined.forEach(f => form.append("files", f));
    setLayer1Loading(true);
    setUploadProgress(0);
    setUploadSpeed(null);
    setUploadETA(null);
    try {
      const text = await new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const t0 = Date.now();
        xhr.upload.onprogress = e => {
          if (!e.lengthComputable || !e.total) return;
          const pct = Math.round((e.loaded / e.total) * 100);
          const elapsed = (Date.now() - t0) / 1000;
          const speed = elapsed > 0.2 ? e.loaded / elapsed : 0;
          const eta = speed > 0 ? (e.total - e.loaded) / speed : null;
          setUploadProgress(pct);
          if (speed > 0) setUploadSpeed(speed);
          setUploadETA(eta);
        };
        xhr.upload.onload = () => { setUploadProgress(100); setUploadSpeed(null); setUploadETA(null); };
        xhr.onload  = () => xhr.status < 300 ? resolve(xhr.responseText) : reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        xhr.onerror = () => reject(new Error("网络错误，请检查连接"));
        xhr.open("POST", `${API_URL}/api/clean/upload`);
        xhr.send(form);
      });
      const json = JSON.parse(text);
      if (!json.files) throw new Error(json.detail || "上传失败");
      setFilePreviews(json.files);
      setSessionId(json.session_id || null);
      setMergeCheck(null);
      track("file_uploaded", { file_count: combined.length });
    } catch (e) { alert("上传失败：" + e.message); }
    setLayer1Loading(false);
    setUploadProgress(null);
    setUploadSpeed(null);
    setUploadETA(null);
  }

  function removeFile(idx) {
    const fn = uploadedFiles[idx]?.name;
    const newFiles = uploadedFiles.filter((_, i) => i !== idx);
    const newPreviews = filePreviews.filter((_, i) => i !== idx);
    setUploadedFiles(newFiles);
    setFilePreviews(newPreviews);
    setMergeKeys([]);
    setDropCols([]);
    setStrCols([]);
    setLogVars([]);
    setLagVars([]);
    setLagEntityVar("");
    setLagTimeVar("");
    setFieldMaps(prev => { const n = { ...prev }; delete n[fn]; return n; });
    setMergeCheck(null);
    setSessionId(null);
    setCleanedSessionId(null);
    setCleanedData(null);
    setCleanReport(null);
    setCleanPreview(null);
  }

  async function handleCheckMerge() {
    if (!uploadedFiles.length || !mergeKeys.length) return;
    setMergeCheckLoading(true);
    const form = new FormData();
    const mergeConfig = { keys: mergeKeys, field_maps: fieldMaps };
    if (sessionId) {
      mergeConfig.session_id = sessionId;
    } else {
      uploadedFiles.forEach(f => form.append("files", f));
    }
    form.append("merge_config", JSON.stringify(mergeConfig));
    try {
      const res = await fetch(`${API_URL}/api/clean/check-merge`, { method: "POST", body: form });
      const json = await res.json();
      setMergeCheck(json);
    } catch (e) { alert("检查失败：" + e.message); }
    setMergeCheckLoading(false);
  }

  async function handleClean() {
    if (!uploadedFiles.length) return;
    setLayer1Loading(true);
    setIsCleaning(true);
    setCleanedData(null); setCleanReport(null); setCleanPreview(null);
    const form = new FormData();
    const mergeConfig = {
      strategy: mergeStrategy,
      keys: mergeKeys,
      files_order: uploadedFiles.map(f => f.name),
      field_maps: fieldMaps,
    };
    if (sessionId) {
      mergeConfig.session_id = sessionId;
    } else {
      uploadedFiles.forEach(f => form.append("files", f));
    }
    form.append("merge_config", JSON.stringify(mergeConfig));
    form.append("clean_config", JSON.stringify({
      missing: missingStrategy,
      missing_cols: missingCols,
      outlier: outlierStrategy,
      outlier_threshold: outlierThreshold,
      drop_cols: dropCols,
      str_cols: strCols,
      dedup_vars: dedupVars,
      dedup_keep: dedupKeep,
      log_vars: logVars,
      winsorize_vars: winsorizeVars,
      winsorize_lower: winsorizeLower,
      winsorize_upper: winsorizeUpper,
      lag_vars: lagVars,
      lag_periods: lagPeriods,
      lag_entity_var: lagEntityVar || null,
      lag_time_var: lagTimeVar || null,
    }));
    try {
      const res = await fetch(`${API_URL}/api/clean/merge-and-clean`, { method: "POST", body: form });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "清洗失败");
      setCleanedData({ data: json.data, columns: json.columns, dtypes: json.dtypes || {} });
      setCleanReport(json.report);
      setCleanPreview(json.preview);
      setDoClean(json.do_clean || "");
      setCleanedSessionId(json.cleaned_session_id || null);
      track("clean_completed");
    } catch (e) { alert("清洗失败：" + e.message); }
    setLayer1Loading(false);
    setIsCleaning(false);
  }

  async function handleAnalyze() {
    if (!cleanedData) return alert("请先完成数据清洗");
    if (!analysisTypes.length) return alert("请选择至少一种分析方法");
    setLayer2Loading(true);
    setAnalyzeResults(null);
    track("analysis_run", { analysis_types: analysisTypes, interpret });
    try {
      const body = {
        analysis_types: analysisTypes,
        variables: selectedVars.length ? selectedVars : null,
        dep_var: depVar || null,
        indep_vars: indepVars.length ? indepVars : null,
        control_vars: controlVars.length ? controlVars : null,
        entity_var: entityVar || null,
        time_var: timeVar || null,
        time_effects: timeEffects,
        robust_se: robustSE,
        cluster_var: clusterVar || null,
        moderator_var: moderatorVar || null,
        treatment_var: treatmentVar || null,
        policy_time: policyTime === "" ? null : Number(policyTime),
        treat_time_var: treatTimeVar || null,
        window_pre: windowPre,
        window_post: windowPost,
        mediator_var: mediatorVar || null,
        group_var: groupVar || null,
        group_method: groupMethod,
        endog_vars: endogVars.length ? endogVars : null,
        instrument_vars: instrumentVars.length ? instrumentVars : null,
        standardize: pcaStandardize,
        interpret,
        custom_question: customQ || null,
        activation_code: (typeof window !== "undefined" && localStorage.getItem("activation_code")) || null,
        psm_neighbors: psmNeighbors,
        psm_caliper: psmCaliper === "" ? null : psmCaliper,
      };
      if (cleanedSessionId) {
        body.cleaned_session_id = cleanedSessionId;
      } else {
        body.data = cleanedData.data;
      }
      const res = await fetch(`${API_URL}/api/analyze/run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || "分析失败");
      setAnalyzeResults(json);
      setDoAnalyze(json.do_analyze || "");
      track("analysis_success", { analysis_types: analysisTypes });

      // PCA 综合得分已由后端写回完整数据并生成新的 cleaned_session_id：
      // 同步更新前端缓存的清洗数据/会话，使综合得分可作为新变量在后续回归分析中选用
      const pcaResult = json.results?.pca;
      if (pcaResult?.new_cleaned_session_id && pcaResult?.score_column) {
        const col = pcaResult.score_column;
        const scoreMap = {};
        (pcaResult.composite_score?.values || []).forEach(v => { scoreMap[v.row] = v.score; });
        setCleanedSessionId(pcaResult.new_cleaned_session_id);
        setCleanedData(prev => prev ? {
          ...prev,
          data: prev.data.map((rec, i) => ({ ...rec, [col]: scoreMap[i] ?? null })),
          columns: prev.columns.includes(col) ? prev.columns : [...prev.columns, col],
          dtypes: { ...prev.dtypes, [col]: "float64" },
        } : prev);
      }
    } catch (e) {
      alert("分析失败：" + e.message);
      track("analysis_error", { analysis_types: analysisTypes, error: e.message });
    }
    setLayer2Loading(false);
  }

  const allCols = filePreviews.flatMap(f => f.columns);
  const mappedCols = filePreviews.flatMap(f =>
    f.columns.map(c => fieldMaps[f.filename]?.[c] || c)
  );
  const uniqueCols = [...new Set(allCols)];
  const uniqueMappedCols = [...new Set(mappedCols)];
  const cleanedCols = cleanedData?.columns || [];
  const needsPanel = analysisTypes.some(t => ["panel_fe", "panel_re", "panel_balance", "did", "did_robustness", "did_event", "psm_did"].includes(t));
  const needsReg = analysisTypes.some(t => ["ols", "panel_fe", "panel_re", "probit", "logit", "moderation", "mediation", "did", "did_event", "did_robustness", "heterogeneity", "iv", "psm", "psm_did"].includes(t));
  const needsSE = analysisTypes.some(t => ["ols", "panel_fe", "panel_re", "probit", "logit", "moderation", "mediation", "did", "did_event", "did_robustness", "heterogeneity", "iv", "psm_did"].includes(t));
  const needsModeration = analysisTypes.includes("moderation");
  const needsMediation = analysisTypes.includes("mediation");
  const needsDID = analysisTypes.some(t => t === "did" || t === "did_robustness");
  const needsDIDEvent = analysisTypes.includes("did_event");
  const needsHeterogeneity = analysisTypes.includes("heterogeneity");
  const needsIV = analysisTypes.includes("iv");
  const needsPCA = analysisTypes.includes("pca");
  const needsIndepVars = analysisTypes.some(t => ["ols", "panel_fe", "panel_re", "probit", "logit", "moderation", "mediation", "heterogeneity", "psm", "psm_did"].includes(t));
  const needsPSM = analysisTypes.includes("psm");
  const needsPSMDID = analysisTypes.includes("psm_did");
  const needsPSMConfig = needsPSM || needsPSMDID;
  const sectionNum = (base) => filePreviews.length > 1 ? base : base - 1;

  return (
    <>
      <Head>
        <title>论文实证分析平台</title>
        <link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </Head>

      <div className="app">
        <div className="jheader">
          <span className="jname">Empirical Research Platform</span>
          <span className="jmeta">数据清洗 · 统计分析 · 论文规范输出</span>
          <a href="/docs" className="jnav-link">📖 查看使用文档</a>
        </div>
        <div className="title-block">
          <h1>论文实证分析<span>平台</span></h1>
          <p className="sub">与 Stata 结果一致 · 两层架构 · 面板数据支持</p>
        </div>

        <div className="layer-badge">第一层：数据清洗</div>

        {/* 01 上传 */}
        <div className="section">
          <div className="sh"><span className="sn">01</span><span className="st">上传数据文件</span><span className="shint">最多5个</span></div>
          <div className={`upload-zone ${layer1Loading ? "uploading" : ""}`}
            onClick={() => !layer1Loading && fileRef.current.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => { e.preventDefault(); if (!layer1Loading) handleUpload(e.dataTransfer.files); }}>
            <input type="file" ref={fileRef} accept=".csv,.xlsx,.dta" multiple style={{ display: "none" }}
              onChange={e => handleUpload(e.target.files)} />
            <div className="uicon">{layer1Loading ? "⏳" : "📂"}</div>
            <h3>{layer1Loading ? (isCleaning ? "清洗中…" : uploadProgress !== null && uploadProgress < 100 ? "上传中…" : "解析中…") : "上传数据文件"}</h3>
            <p>支持 .csv / .xlsx / .dta · 可多选</p>
          </div>

          {uploadProgress !== null && (
            <div className="upload-progress-wrap">
              <div className="up-bar-bg">
                <div className="up-bar-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
              <div className="up-info">
                {uploadProgress < 100
                  ? <>{uploadProgress}%{uploadSpeed > 0 && <> · {fmtSpeed(uploadSpeed)}</>}{uploadETA !== null && uploadETA > 0 && <> · 预计剩余 {fmtETA(uploadETA)}</>}</>
                  : <>上传完成 · 服务器解析文件中<span className="dots-anim">…</span></>
                }
              </div>
            </div>
          )}

          {layer1Loading && uploadProgress !== null && filePreviews.length === 0 && uploadedFiles.length > 0 && (
            <div className="file-cards">
              {uploadedFiles.map((f, i) => (
                <div key={i} className="file-card fc-pending">
                  <div className="fc-header"><div className="fc-name">📄 {f.name}</div></div>
                  <div className="fc-meta">{fmtSize(f.size)} · 待解析</div>
                </div>
              ))}
            </div>
          )}

          {filePreviews.length > 0 && (
            <div className="file-cards">
              {filePreviews.map((f, i) => (
                <div key={i} className="file-card">
                  <div className="fc-header">
                    <div className="fc-name">📄 {f.filename}</div>
                    <button className="fc-del" onClick={() => removeFile(i)}>✕</button>
                  </div>
                  <div className="fc-meta">{f.rows.toLocaleString()} 行 × {f.cols} 列 · {fmtSize(uploadedFiles.find(u => u.name === f.filename)?.size)}</div>
                  <div className="fc-cols">
                    {f.columns.map(c => {
                      const dtype = f.dtypes?.[c] || "";
                      const isNum = dtype.includes("float") || dtype.includes("int");
                      const mappedName = fieldMaps[f.filename]?.[c];
                      return (
                        <span key={c} className={`fc-col-tag ${isNum ? "num" : "str"}`}>
                          {mappedName ? `${c}→${mappedName}` : c}
                        </span>
                      );
                    })}
                  </div>
                  {Object.entries(f.missing || {}).some(([, v]) => v > 0) && (
                    <div className="fc-missing">
                      缺失：{Object.entries(f.missing).filter(([, v]) => v > 0).map(([k, v]) => `${k}(${v})`).join(", ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* 02 字段映射 */}
        {filePreviews.length > 0 && (
          <div className="section">
            <div className="sh">
              <span className="sn">02</span>
              <span className="st">字段映射</span>
              <span className="shint">可选 · 统一列名</span>
              <button className="toggle-btn" onClick={() => setShowFieldMapper(v => !v)}>
                {showFieldMapper ? "收起 ▲" : "展开 ▼"}
              </button>
            </div>
            {showFieldMapper && (
              <FieldMapper files={filePreviews} fieldMaps={fieldMaps} onChange={setFieldMaps} />
            )}
          </div>
        )}

        {/* 03 合并配置（多文件时显示） */}
        {filePreviews.length > 1 && (
          <div className="section">
            <div className="sh"><span className="sn">03</span><span className="st">合并配置</span></div>
            <div className="config-grid">
              <div className="config-item">
                <label className="cfg-label">合并方式</label>
                <div className="radio-group">
                  {[["inner","取交集"],["left","左连接"],["outer","取并集"],["concat","纵向堆叠"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${mergeStrategy === v ? "sel" : ""}`} onClick={() => setMergeStrategy(v)}>{l}</label>
                  ))}
                </div>
              </div>
              {mergeStrategy !== "concat" && (
                <div className="config-item">
                  <label className="cfg-label">合并键（映射后列名）</label>
                  <TagSelector options={uniqueMappedCols} selected={mergeKeys} onChange={keys => { setMergeKeys(keys); setMergeCheck(null); }} />
                  {mergeKeys.length > 0 && (
                    <button className="check-btn" onClick={handleCheckMerge} disabled={mergeCheckLoading}>
                      {mergeCheckLoading ? "检查中…" : "🔍 检查合并类型"}
                    </button>
                  )}
                  <MergeTypeBadge mergeCheck={mergeCheck} />
                </div>
              )}
            </div>
          </div>
        )}

        {/* 04 清洗配置 */}
        {filePreviews.length > 0 && (
          <div className="section">
            <div className="sh">
              <span className="sn">{filePreviews.length > 1 ? "04" : "03"}</span>
              <span className="st">清洗配置</span>
            </div>
            <div className="config-grid">
              <div className="config-item">
                <label className="cfg-label">缺失值处理</label>
                <div className="radio-group">
                  {[["drop","删除行"],["mean","均值填充"],["median","中位数填充"],["ffill","前向填充"],["zero","填0"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${missingStrategy === v ? "sel" : ""}`} onClick={() => setMissingStrategy(v)}>{l}</label>
                  ))}
                </div>
                <div style={{marginTop:8}}>
                  <span className="cfg-label" style={{fontSize:12,color:"#666"}}>
                    作用列 <span className="vh">留空 = 全部列；选择后只对选中列执行上述操作，其余列保留原始空值</span>
                  </span>
                  <TagSelector
                    options={uniqueCols}
                    selected={missingCols}
                    onChange={setMissingCols}
                    dtypes={filePreviews[0]?.dtypes}
                  />
                </div>
              </div>
              <div className="config-item">
                <label className="cfg-label">异常值处理</label>
                <div className="radio-group">
                  {[["none","不处理"],["zscore","Z-score"],["iqr","IQR法"]].map(([v, l]) => (
                    <label key={v} className={`radio-btn ${outlierStrategy === v ? "sel" : ""}`} onClick={() => setOutlierStrategy(v)}>{l}</label>
                  ))}
                </div>
                {outlierStrategy !== "none" && (
                  <input className="threshold-input" type="number" value={outlierThreshold} step="0.5" min="1"
                    onChange={e => setOutlierThreshold(parseFloat(e.target.value))}
                    placeholder={outlierStrategy === "zscore" ? "σ倍数（默认3）" : "IQR倍数（默认1.5）"} />
                )}
              </div>
              {uniqueCols.length > 0 && (
                <div className="config-item">
                  <label className="cfg-label">强制文本型列 <span className="cfg-hint">防止股票代码被识别为数字</span></label>
                  <TagSelector options={uniqueCols} selected={strCols} onChange={setStrCols} />
                </div>
              )}
              {uniqueCols.length > 0 && (
                <div className="config-item">
                  <label className="cfg-label">删除重复值 <span className="cfg-hint">按选中变量判定重复，常用于清理 1:N / N:N 合并产生的重复行</span></label>
                  <TagSelector options={uniqueCols} selected={dedupVars} onChange={setDedupVars} />
                  {dedupVars.length > 0 && (
                    <div className="radio-group">
                      {[["first", "保留首次出现"], ["last", "保留末次出现"], ["none", "重复组全部删除"]].map(([v, l]) => (
                        <label key={v} className={`radio-btn ${dedupKeep === v ? "sel" : ""}`} onClick={() => setDedupKeep(v)}>{l}</label>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {uniqueCols.length > 0 && (
                <div className="config-item">
                  <label className="cfg-label">对数变换 <span className="cfg-hint">生成 ln_xxx 新列</span></label>
                  <TagSelector options={uniqueCols} selected={logVars} onChange={setLogVars} />
                </div>
              )}
              {uniqueCols.length > 0 && (
                <div className="config-item">
                  <label className="cfg-label">缩尾处理 Winsorize <span className="cfg-hint">按百分位截断极端值</span></label>
                  <TagSelector options={uniqueCols} selected={winsorizeVars} onChange={setWinsorizeVars} />
                  {winsorizeVars.length > 0 && (
                    <div className="winsor-pcts">
                      <input className="threshold-input" type="number" value={winsorizeLower} step="0.5" min="0" max="50"
                        onChange={e => setWinsorizeLower(parseFloat(e.target.value))} placeholder="下分位%（默认1）" />
                      <span>% – </span>
                      <input className="threshold-input" type="number" value={winsorizeUpper} step="0.5" min="50" max="100"
                        onChange={e => setWinsorizeUpper(parseFloat(e.target.value))} placeholder="上分位%（默认99）" />
                      <span>%</span>
                    </div>
                  )}
                </div>
              )}
              {uniqueCols.length > 0 && (
                <div className="config-item">
                  <label className="cfg-label">滞后自变量 <span className="cfg-hint">生成 xxx_lag1...lagN 新列，面板数据按个体分组+时间排序后滞后</span></label>
                  <TagSelector options={uniqueCols} selected={lagVars} onChange={setLagVars} />
                  {lagVars.length > 0 && (
                    <>
                      <input className="threshold-input" type="number" value={lagPeriods} step="1" min="1" max="10"
                        onChange={e => setLagPeriods(Math.max(1, parseInt(e.target.value) || 1))}
                        placeholder="滞后期数（默认1）" />
                      <div style={{ marginTop: 8 }}>
                        <span className="cfg-label" style={{ fontSize: 12, color: "#666" }}>个体变量 <span className="vh">面板数据建议填写，否则按当前行序滞后</span></span>
                        <TagSelector options={uniqueCols} selected={lagEntityVar ? [lagEntityVar] : []} onChange={v => setLagEntityVar(v[0] || "")} single />
                      </div>
                      <div style={{ marginTop: 8 }}>
                        <span className="cfg-label" style={{ fontSize: 12, color: "#666" }}>时间变量</span>
                        <TagSelector options={uniqueCols} selected={lagTimeVar ? [lagTimeVar] : []} onChange={v => setLagTimeVar(v[0] || "")} single />
                      </div>
                    </>
                  )}
                </div>
              )}
              {uniqueCols.length > 0 && (
                <div className="config-item" style={{ gridColumn: "1 / -1" }}>
                  <label className="cfg-label">删除列 <span className="cfg-hint">可选</span></label>
                  <TagSelector options={uniqueCols} selected={dropCols} onChange={setDropCols} />
                </div>
              )}
            </div>
            <button className="run-btn" onClick={handleClean} disabled={layer1Loading}>
              {layer1Loading ? "处理中…" : "执行清洗 →"}
            </button>
          </div>
        )}

        {/* 清洗报告 */}
        {cleanReport && (
          <div className="clean-report">
            <div className="cr-title">✅ 清洗完成</div>
            <div className="cr-stats">
              <span>{cleanReport.rows_before.toLocaleString()} 行 → {cleanReport.rows_after.toLocaleString()} 行</span>
              <span>处理缺失值 {cleanReport.missing_handled} 个</span>
              <span>移除异常值 {cleanReport.outliers_removed} 行</span>
            </div>
            {cleanReport.steps?.map((s, i) => <div key={i} className="cr-step">• {s.step}：{s.detail}</div>)}
          </div>
        )}

        {/* 数据预览 */}
        {cleanPreview && (
          <DataPreviewTable
            preview={cleanPreview}
            columns={cleanedCols}
            title={`清洗后数据预览（前10行，共 ${cleanedData?.data?.length?.toLocaleString()} 行）`}
          />
        )}

        {/* ══ LAYER 2 ══ */}
        {cleanedData && (
          <>
            <hr className="divider" />
            <div className="layer-badge">第二层：实证分析</div>

            {/* 01 分析方法 */}
            <div className="section">
              <div className="sh"><span className="sn">01</span><span className="st">选择分析方法</span><span className="shint">可多选 · 按类别分组</span></div>
              {/* 卡片按 ANALYSIS_REGISTRY 中的 category 分组渲染：
                  分组顺序、标签均由注册表数据驱动，新增/调整分类无需改这段渲染逻辑 */}
              {(() => {
                const categories = [];
                ANALYSIS_REGISTRY.forEach(e => { if (!categories.includes(e.category)) categories.push(e.category); });
                return categories.map(cat => (
                  <div key={cat} className="acat-block">
                    <div className="acat-label"><span>{cat}</span></div>
                    <div className="analysis-grid">
                      {ANALYSIS_REGISTRY.filter(e => e.category === cat).map(card => {
                        const isLocked = LOCKED_ANALYSIS_TYPES.includes(card.type) && !unlocked;
                        return (
                          <div key={card.type}
                            className={`acard ${analysisTypes.includes(card.type) ? "active" : ""} ${isLocked ? "locked" : ""}`}
                            onClick={() => isLocked ? openUnlockModal() : setAnalysisTypes(prev => {
                              if (card.type === "psm_did" && !prev.includes("psm_did") && !prev.includes("did_event") && windowPost === 3) {
                                setWindowPost(5);
                              }
                              return prev.includes(card.type) ? prev.filter(t => t !== card.type) : [...prev, card.type];
                            })}>
                            {isLocked && <div className="lock-badge">🔒</div>}
                            <div className="ci">{card.icon}</div>
                            <div className="ct">{card.title}</div>
                            <div className="cd">{card.desc}</div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ));
              })()}
            </div>

            {/* 02 变量配置 */}
            <div className="section">
              <div className="sh"><span className="sn">02</span><span className="st">变量配置</span></div>
              <div className="var-box">
                <div className="var-row">
                  <span className="vl">参与分析的变量 <span className="vh">不选=全部数值列{needsPCA ? "；主成分分析将对这里选中的变量做降维" : ""}</span></span>
                  <TagSelector options={cleanedCols} selected={selectedVars} onChange={setSelectedVars} dtypes={cleanedData?.dtypes} />
                </div>
                {needsPCA && (
                  <div className="var-row">
                    <span className="vl">是否标准化 <span className="vh">变量量纲不一致时建议标准化（基于相关系数矩阵），对应 Stata pca 默认行为</span></span>
                    <div className="radio-group">
                      {[[true, "标准化（相关系数矩阵）"], [false, "不标准化（协方差矩阵）"]].map(([v, l]) => (
                        <label key={String(v)} className={`radio-btn ${pcaStandardize === v ? "sel" : ""}`} onClick={() => setPcaStandardize(v)}>{l}</label>
                      ))}
                    </div>
                  </div>
                )}
                {needsReg && (
                  <div className="config-group">
                    <div className="config-group-title">通用配置</div>
                    <div className="var-row">
                      <span className="vl">被解释变量 Y</span>
                      <TagSelector options={cleanedCols} selected={depVar ? [depVar] : []} onChange={v => setDepVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                    </div>
                    {needsIndepVars && (
                      <div className="var-row">
                        <span className="vl">
                          {needsPSMConfig ? "匹配协变量" : "解释变量 X"}
                          {needsModeration && needsMediation && <span className="vh">调节/中介效应分析均取第一个选中的变量作为 X</span>}
                          {needsModeration && !needsMediation && <span className="vh">调节效应分析取第一个选中的变量作为 X</span>}
                          {!needsModeration && needsMediation && <span className="vh">中介效应分析取第一个选中的变量作为 X</span>}
                          {needsPSMConfig && <span className="vh">用于估计倾向得分的协变量（与下方控制变量共同构成 Logit 的解释变量）</span>}
                        </span>
                        <TagSelector options={cleanedCols.filter(c => c !== depVar && c !== treatmentVar)} selected={indepVars} onChange={setIndepVars} dtypes={cleanedData?.dtypes} />
                      </div>
                    )}
                    <div className="var-row">
                      <span className="vl">控制变量 <span className="vh">可不选</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && (needsPSMConfig || !indepVars.includes(c)) && c !== moderatorVar && c !== treatmentVar && c !== mediatorVar && c !== groupVar && !endogVars.includes(c) && !instrumentVars.includes(c))} selected={controlVars} onChange={setControlVars} dtypes={cleanedData?.dtypes} />
                    </div>
                    {needsSE && (
                      <div className="var-row">
                        <span className="vl">标准误</span>
                        <div className="radio-group">
                          {[["conventional","常规SE"],["robust","稳健SE(HC1)"],["cluster","聚类SE"]].map(([v, l]) => (
                            <label key={v}
                              className={`radio-btn ${(v === "conventional" && !robustSE && !clusterVar) || (v === "robust" && robustSE && !clusterVar) || (v === "cluster" && clusterVar) ? "sel" : ""}`}
                              onClick={() => {
                                if (v === "conventional") { setRobustSE(false); setClusterVar(""); }
                                else if (v === "robust") { setRobustSE(true); setClusterVar(""); }
                                else if (v === "cluster") { setRobustSE(false); }
                              }}>{l}</label>
                          ))}
                        </div>
                        {!robustSE && (
                          <div style={{ marginTop: 8 }}>
                            <span className="vl">聚类变量</span>
                            <TagSelector options={cleanedCols} selected={clusterVar ? [clusterVar] : []} onChange={v => setClusterVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {(needsPSM || needsDID || needsDIDEvent || needsPSMDID) && (
                  <div className="config-group">
                    <div className="config-group-title">处理组变量 Treatment</div>
                    <div className="var-row">
                      <span className="vl">
                        取值0/1，标识个体是否属于处理组/接受处理
                        <span className="vh">用于：{[needsPSM && "PSM", needsDID && "DID/DID稳健性检验", needsDIDEvent && "DID事件研究", needsPSMDID && "PSM-DID"].filter(Boolean).join("、")}</span>
                      </span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar)} selected={treatmentVar ? [treatmentVar] : []} onChange={v => {
                        const newVal = v[0] || "";
                        setTreatmentVar(newVal);
                        if (needsPSMConfig && newVal) {
                          setIndepVars(prev => prev.filter(c => c !== newVal));
                          setControlVars(prev => prev.filter(c => c !== newVal));
                        }
                      }} single dtypes={cleanedData?.dtypes} />
                    </div>
                  </div>
                )}
                {needsModeration && (
                  <div className="config-group">
                    <div className="config-group-title">调节效应分析 配置</div>
                    <div className="var-row">
                      <span className="vl">调节变量 M <span className="vh">将与 X 中心化后构造交互项</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && !indepVars.includes(c))} selected={moderatorVar ? [moderatorVar] : []} onChange={v => setModeratorVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                    </div>
                  </div>
                )}
                {needsMediation && (
                  <div className="config-group">
                    <div className="config-group-title">中介效应分析 配置</div>
                    <div className="var-row">
                      <span className="vl">中介变量 M <span className="vh">Baron-Kenny 三步法：依次估计 Y~X、M~X、Y~X+M</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && !indepVars.includes(c))} selected={mediatorVar ? [mediatorVar] : []} onChange={v => setMediatorVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                    </div>
                  </div>
                )}
                {needsHeterogeneity && (
                  <div className="config-group">
                    <div className="config-group-title">异质性分析 配置</div>
                    <div className="var-row">
                      <span className="vl">分组变量 Group <span className="vh">按其取值将样本拆分为多组，分别估计同一回归并列对比</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && !indepVars.includes(c))} selected={groupVar ? [groupVar] : []} onChange={v => setGroupVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                    </div>
                    <div className="var-row">
                      <span className="vl">分组方式 <span className="vh">分组阈值基于全样本计算，保证各组可比</span></span>
                      <div className="radio-group">
                        {[["median", "中位数二分"], ["quantile", "三分位三分"], ["category", "按类别取值（≤6组）"]].map(([v, l]) => (
                          <label key={v} className={`radio-btn ${groupMethod === v ? "sel" : ""}`} onClick={() => setGroupMethod(v)}>{l}</label>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                {needsIV && (
                  <div className="config-group">
                    <div className="config-group-title">工具变量法 配置</div>
                    <div className="var-row">
                      <span className="vl">内生解释变量 Endogenous <span className="vh">与误差项相关、需要工具变量纠正的解释变量</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && !instrumentVars.includes(c))} selected={endogVars} onChange={setEndogVars} dtypes={cleanedData?.dtypes} />
                    </div>
                    <div className="var-row">
                      <span className="vl">工具变量 Instruments <span className="vh">与内生变量相关、但与误差项无关；数量须 ≥ 内生变量数</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && !endogVars.includes(c))} selected={instrumentVars} onChange={setInstrumentVars} dtypes={cleanedData?.dtypes} />
                    </div>
                  </div>
                )}
                {needsPSMConfig && (
                  <div className="config-group">
                    <div className="config-group-title">
                      {[needsPSM && "PSM", needsPSMDID && "PSM-DID"].filter(Boolean).join(" / ")} 配置
                    </div>
                    <div className="var-row">
                      <span className="vl">近邻数 <span className="vh">每个处理组个体匹配的对照组个体数量，默认1（最近邻）</span></span>
                      <input className="threshold-input" type="number" min="1" max="10" value={psmNeighbors}
                        onChange={e => setPsmNeighbors(Math.max(1, parseInt(e.target.value) || 1))} />
                    </div>
                    <div className="var-row">
                      <span className="vl">Caliper <span className="vh">倾向得分匹配的最大允许距离，留空表示不限制</span></span>
                      <input className="threshold-input" type="number" step="0.01" min="0" value={psmCaliper}
                        onChange={e => setPsmCaliper(e.target.value === "" ? "" : parseFloat(e.target.value))}
                        placeholder="如 0.05（可留空）" />
                    </div>
                  </div>
                )}
                {needsDID && (
                  <div className="config-group">
                    <div className="config-group-title">
                      {[analysisTypes.includes("did") && "DID", analysisTypes.includes("did_robustness") && "DID稳健性检验"].filter(Boolean).join(" / ")} 配置
                    </div>
                    {!treatTimeVar && (
                      <div className="var-row">
                        <span className="vl">政策时点 Policy Time <span className="vh">政策实施的年份，≥该值视为政策后；如使用下方"处理时间列"（交错处理），可留空</span></span>
                        <input className="threshold-input" type="text" inputMode="numeric" value={policyTime}
                          onChange={e => { if (/^-?\d*$/.test(e.target.value)) setPolicyTime(e.target.value); }}
                          onFocus={e => e.target.select()}
                          placeholder="如 2015" />
                      </div>
                    )}
                    {!(needsDIDEvent || needsPSMDID) && (
                      <div className="var-row">
                        <span className="vl">处理时间列（交错处理）<span className="vh">可选。各个体政策实施年份（整数），控制组留空即可，系统将空值识别为"从未受处理"；若不填则使用上方统一政策时点</span></span>
                        <TagSelector options={cleanedCols.filter(c => c !== depVar && c !== treatmentVar)} selected={treatTimeVar ? [treatTimeVar] : []} onChange={v => setTreatTimeVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                        {treatTimeVar && (
                          <div className="panel-tip" style={{marginTop:6,color:"#856404",background:"#fff3cd",padding:"6px 10px",borderRadius:4,fontSize:13}}>
                            ⚠️ 数据清洗时请勿对「{treatTimeVar}」列填充缺失值——空值代表该个体从未受处理，是模型识别控制组的依据。
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
                {(needsDIDEvent || needsPSMDID) && (
                  <div className="config-group">
                    <div className="config-group-title">
                      {[needsDIDEvent && "DID事件研究", needsPSMDID && "PSM-DID"].filter(Boolean).join(" / ")} 配置
                    </div>
                    <div className="var-row">
                      <span className="vl">处理时间列（交错处理）<span className="vh">可选。各个体政策实施年份（整数），控制组留空即可，系统将空值识别为"从未受处理"；若不填则使用下方/上方统一政策时点</span></span>
                      <TagSelector options={cleanedCols.filter(c => c !== depVar && c !== treatmentVar)} selected={treatTimeVar ? [treatTimeVar] : []} onChange={v => setTreatTimeVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                      {treatTimeVar && (
                        <div className="panel-tip" style={{marginTop:6,color:"#856404",background:"#fff3cd",padding:"6px 10px",borderRadius:4,fontSize:13}}>
                          ⚠️ 数据清洗时请勿对「{treatTimeVar}」列填充缺失值——空值代表该个体从未受处理，是模型识别控制组的依据。
                        </div>
                      )}
                    </div>
                    {!treatTimeVar && !needsDID && (
                      <div className="var-row">
                        <span className="vl">政策时点 Policy Time <span className="vh">同质处理：所有处理组统一的政策实施年份</span></span>
                        <input className="threshold-input" type="text" inputMode="numeric" value={policyTime}
                          onChange={e => { if (/^-?\d*$/.test(e.target.value)) setPolicyTime(e.target.value); }}
                          onFocus={e => e.target.select()}
                          placeholder="如 2015" />
                      </div>
                    )}
                    <div className="var-row">
                      <span className="vl">事件窗口 <span className="vh">政策前后各展示几期，默认前3后3</span></span>
                      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                        <span style={{ fontSize: 13, color: "#666" }}>前</span>
                        <input className="threshold-input" type="number" min="1" max="10" value={windowPre}
                          onChange={e => setWindowPre(Math.max(1, parseInt(e.target.value) || 3))}
                          style={{ width: 60 }} />
                        <span style={{ fontSize: 13, color: "#666" }}>期　后</span>
                        <input className="threshold-input" type="number" min="1" max="10" value={windowPost}
                          onChange={e => setWindowPost(Math.max(1, parseInt(e.target.value) || 3))}
                          style={{ width: 60 }} />
                        <span style={{ fontSize: 13, color: "#666" }}>期</span>
                      </div>
                    </div>
                  </div>
                )}
                {needsPanel && (
                  <div className="config-group">
                    <div className="config-group-title">面板数据设置</div>
                    <div className="var-row">
                      <span className="vl">个体变量 <span className="vh">企业/机构唯一ID，如 stkcd、firm_id（选文本或整数列）</span></span>
                      <TagSelector options={cleanedCols} selected={entityVar ? [entityVar] : []} onChange={v => setEntityVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                    </div>
                    <div className="var-row">
                      <span className="vl">时间变量 <span className="vh">年份整数列，如 year（不要选日期列）</span></span>
                      <TagSelector options={cleanedCols} selected={timeVar ? [timeVar] : []} onChange={v => setTimeVar(v[0] || "")} single dtypes={cleanedData?.dtypes} />
                      {timeVar && (() => {
                        const t = cleanedData?.dtypes?.[timeVar] || "";
                        const isDate = t.startsWith("datetime") || /日期|date|时间|time/i.test(timeVar);
                        if (!isDate) return null;
                        return (
                          <div className="panel-tip warn">
                            ⚠️ "{timeVar}" 是日期列，系统会自动提取年份。建议在清洗阶段新增年份整数列（如 year）以获得最准确的结果。
                          </div>
                        );
                      })()}
                    </div>
                    {analysisTypes.includes("panel_fe") && (
                      <div className="var-row">
                        <span className="vl">时间固定效应 <span className="vh">双向FE，对应 Stata xtreg, fe absorb(year) / i.year，仅对固定效应模型生效</span></span>
                        <label className={`radio-btn ${timeEffects ? "sel" : ""}`} onClick={() => setTimeEffects(v => !v)}>
                          {timeEffects ? "✓ 开启（双向FE）" : "关闭（仅个体FE）"}
                        </label>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* 03 AI解读 */}
            <div className="section">
              <div className="sh"><span className="sn">03</span><span className="st">AI 解读（可选）</span></div>
              <div className="interp-row">
                <label className={`radio-btn ${interpret ? "sel" : ""}`} onClick={() => {
                  if (!interpret) track("interpret_used");
                  setInterpret(!interpret);
                }}>
                  {interpret ? "✓ 开启" : "开启 AI 解读"}
                </label>
                {interpret && (
                  <textarea className="custom-q" value={customQ} onChange={e => setCustomQ(e.target.value)}
                    placeholder="附加问题，如：请解读核心变量的经济学含义" />
                )}
              </div>
              <button className="run-btn" onClick={handleAnalyze} disabled={layer2Loading}>
                {layer2Loading ? "分析中…" : "运行分析 →"}
              </button>
            </div>

            {/* 结果 */}
            {analyzeResults && (
              <div className="result-area">
                <div className="sh"><span className="sn">OUT</span><span className="st">分析结果</span></div>
                <div className="result-paper">
                  <div className="result-header">
                    <span className="rbadge">{analysisTypes.join(" + ").toUpperCase()}</span>
                    <span className="rtitle">实证分析报告</span>
                    <div className="export-btns">
                      <button className="export-btn" onClick={() => handleExport("xlsx", () => exportXlsx(analyzeResults, cleanedData))}>⬇ xlsx{!unlocked && " 🔒"}</button>
                      <button className="export-btn" onClick={() => handleExport("do", () => exportDoFile(doClean, doAnalyze))}>⬇ do 文件{!unlocked && " 🔒"}</button>
                      <button className="export-btn" onClick={() => handleExport("txt", () => {
                        const el = document.getElementById("result-content");
                        if (!el) return;
                        const blob = new Blob([el.innerText], { type: "text/plain" });
                        const a = document.createElement("a");
                        a.href = URL.createObjectURL(blob);
                        a.download = `实证分析_${new Date().toISOString().slice(0,10)}.txt`;
                        a.click();
                      })}>⬇ txt{!unlocked && " 🔒"}</button>
                    </div>
                  </div>
                  <div className="result-body" id="result-content">
                    {analyzeResults.errors && Object.entries(analyzeResults.errors).map(([k, v]) => (
                      <div key={k} className="err-box">❌ {k}: {v}</div>
                    ))}
                    {analyzeResults.results?.descriptive && <DescriptiveTable data={analyzeResults.results.descriptive} />}
                    {analyzeResults.results?.correlation && <CorrelationTable data={analyzeResults.results.correlation} />}
                    {analyzeResults.results?.pca && <PCATable data={analyzeResults.results.pca} />}
                    <CompareTable results={analyzeResults.results} />
                    {analyzeResults.results?.ols && <RegressionTable data={analyzeResults.results.ols} label="OLS 回归结果" />}
                    {analyzeResults.results?.panel_fe && <RegressionTable data={analyzeResults.results.panel_fe} label="固定效应回归（xtreg, fe）" />}
                    {analyzeResults.results?.panel_re && <RegressionTable data={analyzeResults.results.panel_re} label="随机效应回归（xtreg, re）" />}
                    {analyzeResults.results?.probit && <RegressionTable data={analyzeResults.results.probit} label="Probit 回归结果" />}
                    {analyzeResults.results?.probit && <MarginalEffectsTable data={analyzeResults.results.probit} />}
                    {analyzeResults.results?.logit && <RegressionTable data={analyzeResults.results.logit} label="Logit 回归结果" />}
                    {analyzeResults.results?.logit && <MarginalEffectsTable data={analyzeResults.results.logit} />}
                    {analyzeResults.results?.panel_balance && (() => {
                      const pb = analyzeResults.results.panel_balance;
                      return (
                        <div className="result-block">
                          <div className="tbl-title">面板平衡性检查（xtdescribe）</div>
                          <div className={pb.is_balanced ? "hausman-box" : "dropped-warn"}>
                            {pb.n_entities.toLocaleString()} 个体 × {pb.n_times.toLocaleString()} 时间点，
                            应有 {pb.expected_obs.toLocaleString()} 条观测，实有 {pb.actual_obs.toLocaleString()} 条
                            <br />{pb.notes}
                          </div>
                        </div>
                      );
                    })()}
                    {analyzeResults.results?.moderation && <RegressionTable data={analyzeResults.results.moderation} label="调节效应回归（交互项，已中心化）" />}
                    {analyzeResults.results?.mediation && (() => {
                      const md = analyzeResults.results.mediation;
                      const established = md.mediation_type === "完全中介" || md.mediation_type === "部分中介";
                      return (
                        <>
                          <MediationTable data={md} />
                          <div className={established ? "hausman-box" : "dropped-warn"}>
                            <strong>判定结论：{md.mediation_type}</strong>
                            <br />{md.conclusion}
                            <br /><span style={{ fontSize: 11, opacity: 0.75 }}>{md.notes}</span>
                          </div>
                          {md.sobel && (
                            <div className={md.sobel.significant ? "hausman-box" : "dropped-warn"}>
                              <strong>Sobel 检验（间接效应 a×b 显著性）</strong>
                              <br />间接效应 = {md.sobel.indirect_effect}，标准误 = {md.sobel.se}，
                              z = {md.sobel.z_stat}<sup className="sig">{md.sobel.sig}</sup>，p = {md.sobel.p_value}
                              <br />{md.sobel.significant
                                ? "间接效应在 p<0.1 水平上显著，与 Baron-Kenny 三步法结论可相互印证"
                                : "间接效应未通过 Sobel 检验（p≥0.1），建议结合三步法结论谨慎解读中介作用"}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {analyzeResults.results?.psm && <PSMTable data={analyzeResults.results.psm} />}
                    {analyzeResults.results?.heterogeneity && <HeterogeneityTable data={analyzeResults.results.heterogeneity} />}
                    {analyzeResults.results?.iv && <IVTable data={analyzeResults.results.iv} />}
                    {analyzeResults.results?.did && (() => {
                      const d = analyzeResults.results.did;
                      const pt = d.parallel_trends;
                      return (
                        <>
                          <RegressionTable data={d} label="双重差分 DID（个体+时间双向固定效应）" />
                          {pt && (
                            <div className={pt.pass ? "hausman-box" : "dropped-warn"}>
                              <strong>平行趋势检验</strong>（政策前样本，处理组×时间趋势交互项）：
                              系数={pt.interaction_coef}，p={pt.p_value}
                              <br />{pt.conclusion}
                            </div>
                          )}
                        </>
                      );
                    })()}
                    {analyzeResults.results?.did_event && (
                      <>
                        {analyzeResults.results.did_event.overall_result && (
                          <RegressionTable
                            data={analyzeResults.results.did_event.overall_result}
                            label="多时点 DID 整体效应估计（TWFE，_post_treat 系数即 ATT）"
                          />
                        )}
                        <EventStudyTable data={analyzeResults.results.did_event} />
                      </>
                    )}
                    {analyzeResults.results?.did_robustness && (() => {
                      const dr = analyzeResults.results.did_robustness;
                      const pb = dr.placebo;
                      const ex = dr.exclude_policy_period;
                      const modeLabel = dr.mode === "staggered" ? "交错处理时点" : "同质处理时点";
                      return (
                        <>
                          <div className="result-block">
                            <div className="tbl-title">
                              DID 稳健性检验
                              <span className="mode-badge" style={{ marginLeft: 8, fontSize: 12, fontWeight: "normal", color: "#666", border: "1px solid #ddd", borderRadius: 4, padding: "1px 6px" }}>
                                {modeLabel}{dr.mode === "staggered" && dr.n_treated_entities != null ? ` · 处理组个体数 ${dr.n_treated_entities}` : ""}
                              </span>
                            </div>
                            <div className="hausman-box">
                              <strong>基准估计</strong>：_did 系数 = {dr.baseline_coef}{sigStars(dr.baseline_p_value)}（p={dr.baseline_p_value}）
                            </div>
                            {pb && (
                              <div className={pb.p_value != null && pb.p_value < 0.1 ? "hausman-box" : "dropped-warn"} style={{ marginTop: 10 }}>
                                <strong>安慰剂检验</strong>（随机重新分配处理组身份，重复 {pb.n_runs} 次）：
                                {pb.p_value != null ? (
                                  <>随机系数均值={pb.mean}，标准差={pb.std}，伪p值={pb.p_value}</>
                                ) : null}
                                <br />{pb.conclusion}
                                {pb.coefs?.length > 0 && (
                                  <PlaceboHistogram coefs={pb.coefs} baseline={dr.baseline_coef} />
                                )}
                              </div>
                            )}
                            {ex && (
                              <div className="hausman-box" style={{ marginTop: 10 }}>
                                <strong>剔除政策当期后</strong>：_did 系数 = {ex.coef?.toFixed(3)}{ex.sig}（t={ex.t_stat?.toFixed(2)}，N={ex.n?.toLocaleString()}），完整回归结果见下表
                              </div>
                            )}
                            <div className="tbl-note">{dr.notes}</div>
                          </div>
                          {dr.baseline_result && (
                            <RegressionTable data={dr.baseline_result} label="DID稳健性检验 · 基准估计（完整回归）" />
                          )}
                          {dr.exclude_period_result && (
                            <RegressionTable data={dr.exclude_period_result} label="DID稳健性检验 · 剔除政策当期后（完整回归）" />
                          )}
                        </>
                      );
                    })()}
                    {analyzeResults.results?.psm_did && (
                      <>
                        <PSMDIDResult data={analyzeResults.results.psm_did} />
                        <RegressionTable data={analyzeResults.results.psm_did.twfe} label="PSM-DID 双向固定效应估计（_did 系数即 ATT）" />
                        <EventStudyTable data={analyzeResults.results.psm_did.event_study} />
                      </>
                    )}
                    {analyzeResults.interpretation && (
                      <div className="interp-result">
                        <div className="ir-title">AI 解读</div>
                        <div className="ir-text">{analyzeResults.interpretation.text}</div>
                      </div>
                    )}
                  </div>
                  <div className="result-footer">* 统计计算由 Python statsmodels/linearmodels 完成，与 Stata 结果一致</div>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {showUnlockModal && (
        <div className="trial-modal-mask" onClick={() => setShowUnlockModal(false)}>
          <div className="trial-modal" onClick={(e) => e.stopPropagation()}>
            <button className="trial-modal-close" onClick={() => setShowUnlockModal(false)}>✕</button>
            {unlocked ? (
              <>
                <div className="trial-modal-title">✅ 已解锁高级功能</div>
                <div className="trial-modal-desc">
                  {unlockIssuedCode
                    ? <>你的激活码：<strong>{unlockIssuedCode}</strong>（已自动保存，下次访问无需重新输入）</>
                    : "激活码已验证，高级分析方法已解锁。"}
                </div>
                <button className="trial-modal-submit" onClick={() => setShowUnlockModal(false)}>知道了</button>
              </>
            ) : (
              <>
                <div className="trial-modal-title">🔒 高级功能需激活码解锁</div>
                <div className="trial-modal-desc">
                  已有激活码可直接输入解锁；没有的话，留下邮箱或微信即可立即获取试用激活码。
                </div>
                <div className="trial-modal-form">
                  <input
                    className="trial-modal-input"
                    type="text"
                    placeholder="输入激活码"
                    value={unlockCodeInput}
                    onChange={(e) => setUnlockCodeInput(e.target.value)}
                  />
                  <button
                    className="trial-modal-submit"
                    disabled={unlockVerifying || !unlockCodeInput.trim()}
                    onClick={verifyUnlockCode}
                  >
                    {unlockVerifying ? "校验中…" : "解锁"}
                  </button>
                </div>
                <div className="trial-modal-form">
                  <input
                    className="trial-modal-input"
                    type="text"
                    placeholder="没有激活码？留下邮箱或微信，立即获取"
                    value={unlockContact}
                    onChange={(e) => setUnlockContact(e.target.value)}
                  />
                  <button
                    className="trial-modal-submit"
                    disabled={unlockSubmitting || !unlockContact.trim()}
                    onClick={submitUnlockContact}
                  >
                    {unlockSubmitting ? "提交中…" : "获取激活码"}
                  </button>
                </div>
                {unlockError && <div className="dropped-warn" style={{ marginTop: 8 }}>{unlockError}</div>}
              </>
            )}
          </div>
        </div>
      )}

      <style jsx global>{`
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { background: #f7f5f0; color: #1a1a1a; font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }
        .app { max-width: 1000px; margin: 0 auto; padding: 48px 24px; }
        .jheader { border-top: 3px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; padding: 14px 0 10px; margin-bottom: 36px; display: flex; justify-content: space-between; align-items: center; gap: 16px; }
        .jname { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; }
        .jmeta { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #8a8078; }
        .jnav-link { font-family: 'IBM Plex Mono', monospace; font-size: 12px; font-weight: 500; color: #2c4a8a; text-decoration: none; border: 1px solid #2c4a8a; border-radius: 14px; padding: 5px 14px; white-space: nowrap; transition: background 0.15s, color 0.15s; }
        .jnav-link:hover { background: #2c4a8a; color: white; }
        .title-block { margin-bottom: 36px; padding-bottom: 28px; border-bottom: 1px solid #ddd8cc; }
        .title-block h1 { font-family: 'Playfair Display', serif; font-size: 30px; font-weight: 700; margin-bottom: 8px; }
        .title-block h1 span { color: #2c4a8a; }
        .sub { font-family: 'Playfair Display', serif; font-size: 14px; color: #8a8078; font-style: italic; }
        .layer-badge { display: inline-block; background: #2c4a8a; color: white; font-size: 11px; font-weight: 700; letter-spacing: 2px; padding: 4px 14px; border-radius: 4px; margin-bottom: 24px; font-family: 'IBM Plex Mono', monospace; }
        .section { margin-bottom: 28px; }
        .sh { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; flex-wrap: wrap; }
        .sn { font-family: 'IBM Plex Mono', monospace; font-size: 10px; color: #2c4a8a; font-weight: 500; background: rgba(44,74,138,0.08); border: 1px solid rgba(44,74,138,0.2); padding: 2px 8px; border-radius: 3px; letter-spacing: 1px; }
        .st { font-size: 12px; font-weight: 600; letter-spacing: 2px; text-transform: uppercase; color: #3a3530; }
        .shint { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; background: #f0ece3; border: 1px solid #ddd8cc; padding: 2px 8px; border-radius: 10px; }
        .toggle-btn { font-size: 11px; padding: 3px 10px; border: 1px solid #ddd8cc; border-radius: 4px; cursor: pointer; background: #f0ece3; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; margin-left: auto; }
        .toggle-btn:hover { border-color: #2c4a8a; color: #2c4a8a; }
        .upload-zone { border: 2px dashed #ddd8cc; border-radius: 8px; padding: 40px 24px; text-align: center; cursor: pointer; background: #fffef9; transition: all 0.2s; }
        .upload-zone:hover { border-color: #2c4a8a; }
        .upload-zone.uploading { cursor: default; opacity: 0.75; pointer-events: none; }
        .upload-progress-wrap { margin-top: 10px; }
        .up-bar-bg { height: 4px; background: #e8e4dc; border-radius: 2px; overflow: hidden; }
        .up-bar-fill { height: 100%; background: #2c4a8a; border-radius: 2px; transition: width 0.25s ease; }
        .up-info { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #5a5a5a; margin-top: 5px; }
        .fc-pending { opacity: 0.55; }
        @keyframes dots { 0%,20%{content:'.'} 40%{content:'..'} 60%,100%{content:'...'} }
        .dots-anim::after { content: ''; animation: dots 1.2s steps(1) infinite; }
        .dots-anim { font-style: italic; }
        .uicon { font-size: 28px; margin-bottom: 10px; }
        .upload-zone h3 { font-family: 'Playfair Display', serif; font-size: 15px; margin-bottom: 4px; }
        .upload-zone p { font-size: 12px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; }
        .file-cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 10px; margin-top: 14px; }
        .file-card { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 12px 14px; }
        .fc-header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4px; }
        .fc-name { font-size: 12px; font-weight: 600; color: #2c4a8a; font-family: 'IBM Plex Mono', monospace; }
        .fc-del { background: none; border: none; color: #bbb; cursor: pointer; font-size: 12px; padding: 0 2px; line-height: 1; }
        .fc-del:hover { color: #8a2c2c; }
        .fc-meta { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; margin-bottom: 6px; }
        .fc-cols { display: flex; flex-wrap: wrap; gap: 4px; }
        .fc-col-tag { font-size: 10px; padding: 1px 6px; border-radius: 3px; font-family: 'IBM Plex Mono', monospace; }
        .fc-col-tag.num { background: rgba(44,74,138,0.08); color: #2c4a8a; border: 1px solid rgba(44,74,138,0.2); }
        .fc-col-tag.str { background: #f0ece3; color: #8a8078; border: 1px solid #ddd8cc; }
        .fc-missing { font-size: 11px; color: #8a2c2c; margin-top: 6px; font-family: 'IBM Plex Mono', monospace; }
        .field-mapper { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; }
        .fm-hint { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; margin-bottom: 12px; }
        .fm-file { margin-bottom: 16px; }
        .fm-file:last-child { margin-bottom: 0; }
        .fm-fname { font-size: 11px; font-weight: 600; color: #2c4a8a; font-family: 'IBM Plex Mono', monospace; margin-bottom: 8px; }
        .fm-cols { display: flex; flex-wrap: wrap; gap: 8px; }
        .fm-row { display: flex; align-items: center; gap: 6px; }
        .fm-orig { font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; min-width: 80px; }
        .fm-arrow { font-size: 11px; color: #bbb; }
        .fm-input { font-size: 11px; font-family: 'IBM Plex Mono', monospace; border: 1px solid #ddd8cc; border-radius: 4px; padding: 3px 8px; background: #f7f5f0; outline: none; width: 100px; }
        .fm-input:focus { border-color: #2c4a8a; background: white; }
        .config-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
        @media (max-width: 600px) { .config-grid { grid-template-columns: 1fr; } }
        .cfg-label { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #8a8078; display: block; margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; }
        .cfg-hint { font-size: 10px; color: #bbb; font-weight: 400; letter-spacing: 0; text-transform: none; }
        .check-btn { margin-top: 10px; font-size: 11px; padding: 4px 12px; border: 1px solid #2c4a8a; border-radius: 4px; cursor: pointer; background: white; color: #2c4a8a; font-family: 'IBM Plex Mono', monospace; display: block; }
        .check-btn:hover { background: rgba(44,74,138,0.06); }
        .check-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .merge-check { margin-top: 10px; display: flex; align-items: flex-start; flex-wrap: wrap; gap: 8px; }
        .mc-type { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 700; color: white; padding: 2px 10px; border-radius: 4px; }
        .mc-warn { font-size: 11px; color: #8a2c2c; font-family: 'IBM Plex Mono', monospace; background: rgba(138,44,44,0.06); padding: 2px 8px; border-radius: 4px; border: 1px solid rgba(138,44,44,0.2); }
        .mc-ok { font-size: 11px; color: #2a7a2a; font-family: 'IBM Plex Mono', monospace; }
        .mc-details { width: 100%; display: flex; flex-wrap: wrap; gap: 6px; margin-top: 4px; }
        .mc-detail { font-size: 11px; font-family: 'IBM Plex Mono', monospace; padding: 2px 8px; border-radius: 4px; }
        .mc-detail.ok { background: rgba(42,122,42,0.08); color: #2a7a2a; border: 1px solid rgba(42,122,42,0.2); }
        .mc-detail.warn { background: rgba(138,44,44,0.06); color: #8a2c2c; border: 1px solid rgba(138,44,44,0.2); }
        .radio-group { display: flex; flex-wrap: wrap; gap: 6px; }
        .radio-btn { font-size: 11px; padding: 4px 10px; border: 1px solid #ddd8cc; border-radius: 4px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; transition: all 0.15s; user-select: none; }
        .radio-btn.sel { background: #2c4a8a; color: white; border-color: #2c4a8a; }
        .radio-btn:hover:not(.sel) { border-color: #2c4a8a; color: #2c4a8a; }
        .threshold-input { margin-top: 8px; width: 160px; background: #f7f5f0; border: 1px solid #ddd8cc; border-radius: 6px; padding: 5px 10px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; outline: none; }
        .winsor-pcts { display: flex; align-items: center; gap: 4px; margin-top: 8px; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #8a8078; }
        .winsor-pcts .threshold-input { margin-top: 0; width: 130px; }
        .tag-sel { display: flex; flex-wrap: wrap; gap: 6px; }
        .vtag { background: #f0ece3; border: 1px solid #ddd8cc; border-radius: 4px; padding: 3px 10px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; cursor: pointer; transition: all 0.15s; user-select: none; }
        .vtag:hover { border-color: #2c4a8a; color: #2c4a8a; }
        .vtag.sel { background: #2c4a8a; color: white; border-color: #2c4a8a; }
        .dt-badge { display: inline-block; font-size: 9px; padding: 0 4px; border-radius: 2px; margin-left: 4px; font-weight: 700; letter-spacing: 0; font-family: 'IBM Plex Mono', monospace; vertical-align: middle; line-height: 14px; }
        .dt-num   { background: rgba(44,74,138,0.12); color: #2c4a8a; }
        .dt-int   { background: rgba(42,122,42,0.12); color: #2a7a2a; }
        .dt-date  { background: rgba(200,100,0,0.15); color: #c86400; }
        .dt-str   { background: rgba(130,130,130,0.12); color: #888; }
        .dt-bool  { background: rgba(138,44,138,0.12); color: #8a2c8a; }
        .dt-other { background: #f0ece3; color: #8a8078; }
        .vtag.sel .dt-badge { opacity: 0.8; background: rgba(255,255,255,0.25); color: white; }
        .panel-tip { margin-top: 6px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; padding: 6px 10px; border-radius: 4px; line-height: 1.6; }
        .panel-tip.warn { background: rgba(200,100,0,0.07); border: 1px solid rgba(200,100,0,0.25); color: #c86400; }
        .run-btn { background: #2c4a8a; color: white; border: none; border-radius: 6px; padding: 10px 24px; font-size: 13px; font-weight: 600; cursor: pointer; font-family: 'IBM Plex Sans', sans-serif; transition: all 0.15s; }
        .run-btn:hover { background: #1e3a6e; }
        .run-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .clean-report { background: rgba(44,74,138,0.04); border: 1px solid rgba(44,74,138,0.2); border-radius: 8px; padding: 16px 20px; margin-bottom: 16px; }
        .cr-title { font-weight: 600; color: #2c4a8a; margin-bottom: 8px; font-size: 13px; }
        .cr-stats { display: flex; gap: 20px; flex-wrap: wrap; font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #3a3530; margin-bottom: 8px; }
        .cr-step { font-size: 12px; color: #5a5a5a; font-family: 'IBM Plex Mono', monospace; line-height: 1.8; }
        .preview-block { margin-bottom: 24px; background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; overflow: hidden; }
        .prev-title { font-family: 'IBM Plex Mono', monospace; font-size: 11px; font-weight: 600; color: #8a8078; padding: 10px 16px; border-bottom: 1px solid #ddd8cc; background: #f0ece3; letter-spacing: 1px; text-transform: uppercase; }
        .prev-scroll { overflow-x: auto; }
        .prev-table { width: 100%; border-collapse: collapse; font-family: 'IBM Plex Mono', monospace; font-size: 11px; }
        .prev-table th { background: #f7f5f0; padding: 6px 12px; text-align: left; font-weight: 600; color: #3a3530; border-bottom: 1px solid #ddd8cc; white-space: nowrap; }
        .prev-table td { padding: 5px 12px; border-bottom: 1px solid #f0ece3; color: #5a5a5a; white-space: nowrap; max-width: 140px; overflow: hidden; text-overflow: ellipsis; }
        .prev-table tr:last-child td { border-bottom: none; }
        .prev-table tr:hover td { background: rgba(44,74,138,0.03); }
        .divider { border: none; border-top: 2px solid #ddd8cc; margin: 36px 0; }
        .acat-block { margin-bottom: 16px; }
        .acat-block:last-child { margin-bottom: 0; }
        .acat-label { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
        .acat-label span { font-size: 11px; font-weight: 700; letter-spacing: 2px; color: #2c4a8a; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; white-space: nowrap; }
        .acat-label::after { content: ''; flex: 1; height: 1px; background: #ddd8cc; }
        .analysis-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
        @media (max-width: 700px) { .analysis-grid { grid-template-columns: 1fr 1fr; } }
        .acard { background: #fffef9; border: 1.5px solid #ddd8cc; border-radius: 8px; padding: 14px 16px; cursor: pointer; transition: all 0.15s; position: relative; user-select: none; }
        .acard:hover { border-color: #2c4a8a; }
        .acard.active { border-color: #2c4a8a; background: rgba(44,74,138,0.04); }
        .acard.active::after { content: '✓'; position: absolute; top: 10px; right: 12px; color: #2c4a8a; font-weight: 700; }
        .acard.locked { background: #f5f3ee; opacity: 0.75; }
        .lock-badge { position: absolute; top: 10px; right: 12px; font-size: 13px; }
        .ci { font-size: 20px; margin-bottom: 6px; }
        .ct { font-size: 13px; font-weight: 600; margin-bottom: 3px; }
        .cd { font-size: 11px; color: #8a8078; font-family: 'IBM Plex Mono', monospace; line-height: 1.5; }
        .var-box { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; padding: 16px 20px; }
        .var-row { margin-bottom: 14px; }
        .vl { font-size: 11px; font-weight: 700; letter-spacing: 1px; color: #8a8078; display: block; margin-bottom: 8px; font-family: 'IBM Plex Mono', monospace; text-transform: uppercase; }
        .vh { font-size: 10px; color: #bbb; font-weight: 400; letter-spacing: 0; text-transform: none; margin-left: 6px; }
        .config-group { border: 1px solid #ece7dc; border-radius: 6px; padding: 14px 16px; margin-bottom: 14px; background: #fffef9; }
        .config-group:last-child { margin-bottom: 0; }
        .config-group-title { font-size: 12px; font-weight: 700; color: #2c4a8a; margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px solid #ece7dc; font-family: 'IBM Plex Mono', monospace; letter-spacing: 1px; }
        .config-group .var-row:last-child { margin-bottom: 0; }
        .interp-row { margin-bottom: 14px; }
        .custom-q { width: 100%; margin-top: 10px; border: 1px solid #ddd8cc; border-radius: 6px; padding: 10px 14px; font-size: 13px; font-family: 'IBM Plex Sans', sans-serif; background: #fffef9; outline: none; resize: none; min-height: 64px; }
        .result-area { margin-top: 8px; }
        .result-paper { background: #fffef9; border: 1px solid #ddd8cc; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 12px rgba(0,0,0,0.06); }
        .result-header { background: #1a1a1a; color: white; padding: 14px 20px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
        .rbadge { font-family: 'IBM Plex Mono', monospace; font-size: 10px; letter-spacing: 2px; background: rgba(255,255,255,0.12); padding: 3px 10px; border-radius: 3px; }
        .rtitle { font-family: 'Playfair Display', serif; font-size: 15px; flex: 1; }
        .export-btns { display: flex; gap: 8px; flex-wrap: wrap; }
        .export-btn { background: rgba(255,255,255,0.1); border: 1px solid rgba(255,255,255,0.2); color: white; border-radius: 5px; padding: 5px 12px; font-size: 11px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; white-space: nowrap; }
        .export-btn:hover { background: rgba(255,255,255,0.2); }

        .trial-modal-mask { position: fixed; inset: 0; background: rgba(26,26,26,0.5); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 16px; }
        .trial-modal { position: relative; background: #fdfcf9; border: 1px solid #1a1a1a; border-radius: 8px; max-width: 420px; width: 100%; padding: 32px 28px; box-shadow: 0 8px 32px rgba(0,0,0,0.2); }
        .trial-modal-close { position: absolute; top: 10px; right: 12px; background: none; border: none; font-size: 16px; cursor: pointer; color: #8a8078; }
        .trial-modal-title { font-family: 'Playfair Display', serif; font-size: 20px; font-weight: 700; margin-bottom: 12px; }
        .trial-modal-desc { font-size: 13px; line-height: 1.7; color: #5a5248; margin-bottom: 20px; }
        .trial-modal-form { display: flex; gap: 8px; margin-bottom: 12px; }
        .trial-modal-input { flex: 1; border: 1px solid #c8c1b4; border-radius: 5px; padding: 8px 10px; font-size: 13px; font-family: 'IBM Plex Sans', sans-serif; }
        .trial-modal-submit { background: #1a1a1a; color: #fff; border: none; border-radius: 5px; padding: 8px 16px; font-size: 13px; cursor: pointer; white-space: nowrap; }
        .trial-modal-submit:disabled { opacity: 0.5; cursor: not-allowed; }
        .trial-modal-skip { text-align: center; font-size: 12px; color: #8a8078; cursor: pointer; text-decoration: underline; }
        .result-body { padding: 32px; }
        .result-footer { padding: 10px 32px; border-top: 1px solid #ddd8cc; background: #f0ece3; font-size: 11px; color: #8a8078; font-style: italic; font-family: 'Playfair Display', serif; }
        .err-box { color: #8a2c2c; font-family: 'IBM Plex Mono', monospace; font-size: 12px; margin-bottom: 8px; }
        .dropped-warn { background: rgba(138,100,0,0.06); border: 1px solid rgba(138,100,0,0.2); border-radius: 4px; padding: 8px 12px; font-size: 11px; font-family: 'IBM Plex Mono', monospace; color: #7a5a00; margin-bottom: 12px; }
        .result-block { margin-bottom: 40px; }
        .result-block + .result-block { padding-top: 32px; border-top: 2px solid #ddd8cc; }
        .tbl-title { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 600; text-align: center; margin-bottom: 12px; }
        .tbl-note { font-family: 'IBM Plex Mono', monospace; font-size: 11px; color: #8a8078; margin-top: 8px; }
        .tbl-scroll { overflow-x: auto; }
        .acad-table { width: 100%; border-collapse: collapse; font-family: 'IBM Plex Mono', monospace; font-size: 12px; }
        .acad-table thead tr { border-top: 2px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; }
        .acad-table tbody tr:last-child { border-bottom: 2px solid #1a1a1a; }
        .acad-table th { padding: 6px 10px; font-weight: 600; text-align: right; font-size: 11px; }
        .acad-table td { padding: 5px 10px; text-align: right; }
        .col-var { text-align: left !important; min-width: 120px; }
        .col-corr { text-align: center; min-width: 64px; }
        .col-reg { text-align: center; min-width: 90px; }
        .corr-tbl { min-width: 500px; }
        .sig { font-style: normal; font-size: 10px; }
        .tval { font-size: 11px; color: #5a5a5a; }
        .depvar { font-size: 10px; font-weight: 400; color: #8a8078; display: block; }
        .fe-row td { font-size: 11px; color: #5a5a5a; border-top: 1px solid #ddd8cc; }
        .fe-row:first-of-type td { border-top: 2px solid #ddd8cc; }
        .stat-row td { font-size: 11px; font-weight: 500; }
        .stat-row:first-of-type td { border-top: 1px solid #ddd8cc; }
        .dummy-coef-row td { font-size: 11px; color: #7a7060; }
        .hausman-box { background: rgba(44,74,138,0.04); border: 1px solid rgba(44,74,138,0.2); border-radius: 6px; padding: 10px 14px; margin-top: 12px; font-size: 12px; font-family: 'IBM Plex Mono', monospace; color: #3a3530; line-height: 1.8; }
        .tbl-title-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 12px; flex-wrap: wrap; gap: 8px; }
        .bracket-toggle { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #5a5a5a; font-family: 'IBM Plex Mono', monospace; }
        .btn-tog { background: none; border: 1px solid #ccc8c0; border-radius: 3px; padding: 2px 10px; font-size: 11px; cursor: pointer; font-family: 'IBM Plex Mono', monospace; color: #5a5a5a; }
        .btn-tog.active { background: #2c4a8a; border-color: #2c4a8a; color: white; }
        .compare-tbl .col-reg { min-width: 100px; }
        .compare-cell { text-align: center; }
        .interp-result { margin-top: 32px; padding-top: 24px; border-top: 2px solid #ddd8cc; }
        .ir-title { font-family: 'Playfair Display', serif; font-size: 15px; font-weight: 600; margin-bottom: 12px; }
        .ir-text { font-size: 14px; line-height: 1.9; color: #3a3530; }
      `}</style>
    </>
  );
}