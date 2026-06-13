# 开发状态

## 当前状态（main / 生产环境）

平台已上线，核心功能完整可用：
- 数据清洗：多文件上传（CSV/xlsx/dta）、合并、删除重复值、缺失值/异常值处理、批量对数变换、缩尾处理（Winsorize）、滞后变量生成、列操作、Stata do 生成
- 实证分析：描述统计、相关系数矩阵、主成分分析 PCA、OLS/FE/RE 回归、Probit/Logit、Hausman 检验、面板平衡性检查、调节效应分析、中介效应分析（Baron-Kenny 三步法 + Sobel 检验）、异质性分析（分组回归对比）、双重差分 DID（含稳健性检验包）、工具变量法 2SLS、PSM 倾向得分匹配、AI 解读
- 分析方法卡片按类别分组展示（数据探索 / 主回归分析 / 因果识别 / 机制检验 / 稳健性检验），由 `ANALYSIS_REGISTRY` 配置驱动
- 导出：Excel、Stata do 文件、纯文本（需激活码解锁）
- 高级功能激活码门控：Probit/Logit/PSM/DID稳健性检验 + 全部导出功能需激活码解锁，单一共享码，前后端双重校验
- 用户文档入口 `/docs`：构建期渲染 `docs/用户手册.md`
- Session 缓存架构（2026-06-06 引入，TTL 4 小时），分析阶段不再传输全量数据

> 2026-06-08：新增 Sobel 检验（中介效应补充验证）、工具变量法 2SLS（含弱工具变量/过度识别检验）、主成分分析 PCA、数据清洗"删除重复值"四项新功能；PCA 补充适用性检验（KMO + Bartlett 球形检验，并修复变量高度相关时检验返回空值的问题，改用 slogdet/伪逆提升数值稳定性）与综合得分（按方差贡献率加权汇总主成分得分，自动写回新变量供后续分析直接选用）；Excel 导出补充主成分分析、工具变量2SLS 结果 sheet；修正 PCA 结果备注中"保留依据"前后矛盾的描述；前端"使用文档"入口改为更醒目的胶囊按钮，`/docs` 页面新增联系方式二维码占位区块（待用户后续放入真实图片 `public/contact-qr.png`）；修复 `deploy.sh` 缺少 `npm install` 导致前端新依赖未安装、构建报 `Module not found` 的问题，腾讯云部署已恢复正常。

> 2026-06-09：多时点DID事件研究（`did_event`）已合并 `main` 并部署，含整体 ATT 估计与 Excel 导出；事件研究表格样式与回归表格统一（等宽字体、acad-table 样式）；上传接口加 50MB 文件大小限制。

> 2026-06-10：排查并修复生产环境 502 报错——服务器内存仅 1.9GB 且无 swap，处理大体量 .dta 文件合并时后端进程被 OOM Killer 杀死，已加 2GB swap 缓解（详见 `docs/DEBT.md`）；完成服务器安全排查（SSH 配置、FastAPI 文档接口暴露面、nginx default_server、防火墙规则、异常进程排查），均无严重问题，新增 fail2ban 防 SSH 暴力破解；新增导出按钮"申请试用"弹窗用于验证付费意愿，收集邮箱/微信至 `/api/leads/submit`，不阻断导出；新增全流程埋点（`/api/leads/event` + 前端 `track()`），覆盖访问、上传、清洗、分析、AI解读、导出全链路，写入 `api/data/events.jsonl`，可计算 UV/PV、漏斗转化率与功能使用排名。

> 2026-06-12（续）：修复生产环境严重故障——`/api/analyze/run`（`async def` 但内部全是同步阻塞计算）单个慢请求会独占事件循环，导致全站 504 长达数小时，已改为同步路由由线程池执行并重启恢复；根因（具体哪个分析类型/数据特征导致卡死近9小时）未定位，已记入 `docs/DEBT.md` 待排查。

> 2026-06-13：通过服务器日志复盘确认 06-12 09:21 的卡死请求为 `descriptive/correlation/panel_balance/pca/did/moderation/heterogeneity` 七种分析类型同时勾选（数据 `面板数据0611.xlsx`，2611行×50列），原始数据与 session 已因 TTL 清理丢失无法复现；已为 `/api/analyze/run` 增加 90 秒超时熔断（线程池 + `future.result(timeout=...)`），超时返回 504 提示用户精简分析类型/数据量，避免再次出现无限转圈与 CPU 长时间占满。根因（具体哪个分析类型在该数据规模下退化）仍未定位，残留风险见 `docs/DEBT.md`。

> 2026-06-13（续）：完成第一梯队全部三项（滞后自变量、Probit/Logit、DID稳健性检验包）与第二梯队的激活码门控、PSM倾向得分匹配。激活码门控范围与用户讨论确定：仅锁定本次新增的 Probit/Logit/PSM/DID稳健性检验 四项分析类型，已上线的 did/did_event/iv/moderation/mediation/heterogeneity 等免费功能不受影响；另外全部导出功能（xlsx/do/txt）也改为需激活码解锁。单一共享码（`ACTIVATION_CODE` 环境变量，默认 `EMPIRICAL2026`），新增 `/api/activation/verify` 校验接口，`/api/leads/submit` 自动返回激活码；后端 `RESTRICTED_ANALYSIS_TYPES` + 前端 `LOCKED_ANALYSIS_TYPES` 双重限制。

## 进行中

无。

## 待办

### 优先级（2026-06-13 评估，按性价比排序，第一/第二梯队已完成）

**第三梯队（成本高或受众窄）**
1. LaTeX表格导出 — 受众偏论文定稿阶段
2. Heckman两步法 — 标准误修正复杂（statsmodels不直接支持Heckman 1979修正）
3. 空间计量（省级） — 新依赖+新数据资产+性能验证，成本最高
4. 图表：散点图/系数图 — 前端工作量为主，导出场景高频

**工程类（按需，不阻塞业务）**
5. 分析结果持久化
6. 大文件流式处理/后端流式响应 — 90秒超时熔断已兜住最坏情况，紧迫性下降

### 计量方法扩展
- [ ] Heckman 两步选择模型：Probit 选择方程 + IMR 修正回归（注意第二步标准误需按 Heckman 1979 修正，不能直接用 OLS 标准误）
- [ ] 空间计量（先做省级）：新依赖 `pysal`/`spreg`（需验证与 Python 3.12 + numpy 1.26 + pandas 2.2 兼容性），内置31省 Queen 邻接矩阵（行标准化）。输出范围（2026-06-13 已与用户确认，不精简）：
  - 全局 Moran's I 检验（被解释变量空间自相关）
  - LM-lag / LM-error 及 Robust 版本，给出 SAR/SEM 选择建议
  - SAR/SEM 系数表（含空间项 ρ/λ、R²、对数似然），格式与现有 OLS/FE 结果一致
  - SAR 效应分解：直接效应/间接效应/总效应三张表
  - Stata do 片段（`xsmle`，注释说明W矩阵来源与行标准化）
  - 备注：内置W矩阵来源/年份版本说明
  - 性能注意：省级面板（31实体）规模小，预期在90秒超时熔断内，但ML估计比OLS/FE更重，上线前需验证

### 输出与展示
- [ ] LaTeX 表格导出
- [ ] 图表：散点图、系数图（coefficient plot）

### 工程
- [ ] 分析结果持久化：保存/加载分析配置和结果
- [ ] 大文件流式处理：超过 50MB 分块上传
- [ ] 后端流式响应：长时间计算实时返回进度

### 商业化

- [x] 高级功能激活码门控（2026-06-13 完成）：单一共享码（`ACTIVATION_CODE` 环境变量，默认 `EMPIRICAL2026`），`/api/activation/verify` 校验，`/api/leads/submit` 自动返回激活码；后端 `RESTRICTED_ANALYSIS_TYPES` + 前端 `LOCKED_ANALYSIS_TYPES` 双重限制。当前锁定范围：Probit/Logit/PSM/DID稳健性检验 四项分析类型 + 全部导出功能（xlsx/do/txt）；已上线的 did/did_event/iv/moderation/mediation/heterogeneity 等免费功能不受影响
- [ ] 后续观察：①激活码转化数据积累后，评估是否需要扩大锁定范围（如纳入 did/heterogeneity 等高频功能）或拆分付费分层；②老用户触达渠道仍依赖 `/docs` 页微信二维码等被动渠道，尚无主动触达方案；③后续上线 Heckman、LaTeX 导出、空间计量等高级功能时，按需加入 `RESTRICTED_ANALYSIS_TYPES`/`LOCKED_ANALYSIS_TYPES`
