# 开发状态

## 当前状态（main / 生产环境）

平台已上线，核心功能完整可用：
- 数据清洗：多文件上传（CSV/xlsx/dta）、合并、删除重复值、缺失值/异常值处理、批量对数变换、缩尾处理（Winsorize）、滞后变量生成、列操作、Stata do 生成
- 实证分析：描述统计、相关系数矩阵、主成分分析 PCA、OLS/FE/RE 回归、Probit/Logit、Hausman 检验、面板平衡性检查、调节效应分析、中介效应分析（Baron-Kenny 三步法 + Sobel 检验）、异质性分析（分组回归对比）、双重差分 DID（含稳健性检验包）、工具变量法 2SLS、PSM 倾向得分匹配（含 PSM-DID 基期锁定匹配）、AI 解读
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

> 2026-06-13（续2）："02 变量配置"区域按方案B完成结构性重排：拆分为"通用配置"（Y/X或协变量/控制变量/标准误）+ 各分析类型独立的带标题子区块（处理组变量 Treatment / 调节效应分析 配置 / 中介效应分析 配置 / 异质性分析 配置 / 工具变量法 配置 / PSM 配置 / DID(/稳健性检验) 配置 / DID事件研究 配置 / 面板数据设置），新增 `.config-group`/`.config-group-title` CSS。同时修复 `needsReg` 缺 `"psm"`/`"did_robustness"` 的bug（单选PSM或单选DID稳健性检验时配置区此前完全不渲染）；新增 `needsSE`（不含psm）控制标准误区块显示；Treatment 处理组变量在PSM/DID/DID事件研究间合并为单一控件，标题标注"用于：XX"说明共享归属，避免重复字段。`npx next build` 编译通过。

> 2026-06-14：PSM 平衡性检验输出改为对照 Stata `pstest` 格式——`run_psm` 新增匹配权重追踪（记录每个对照组观测被用作匹配对象的次数/n_neighbors），平衡性表按协变量拆成 Unmatched/Matched 两行，分别给出处理组均值、（加权）对照组均值、%Bias、组间t检验，并新增 %Reduct|Bias|（匹配后偏差缩减比例）；新增 `balance_summary`（Pseudo R²、LR χ²及其p值、匹配前后 Mean/Median |Bias|）。前端 `PSMTable` 与 Excel 导出同步改版为两行式表格。已用 `test_data_psm_did.csv` 验证计算无报错。另：记录两项待讨论债务到 `docs/DEBT.md`——① `did_robustness` 仅支持同质处理时点，与 `did_event` 的交错处理时点（`treat_time_var`）不一致，需后续支持；② `run_psm` 对面板数据采用混合(pooled)匹配而非截面分期匹配，存在伪重复风险，需与用户讨论是否改为基准期截面匹配。

> 2026-06-14（续）：修复"政策时点 Policy Time"输入框输入年份变负数的bug（用户截图复现，实际值变为 `-2`）。根因为 `type="number"` 受控组件陷阱：先输入 `-` 时 `e.target.value` 返回 `""`，state 未变化导致 React 跳过DOM更新，残留的 `-` 与后续输入的数字拼接成负数。修复为 `type="text"` + `inputMode="numeric"` + 正则 `/^-?\d*$/` 校验，两处输入框（DID配置、DID事件研究配置）同步修改。`npx next build` 编译通过，已实机验证修复有效。

> 2026-06-15：PSM-DID 基期锁定匹配（`psm_did`）按既定设计一次性实现并合并到本分支：后端抽取 `_psm_match_core`/`_psm_balance_table` 供 `run_psm`/`run_psm_did` 共用（`run_psm` 输出不变），新增 `run_psm_did`（基期截面分block匹配 + 面板还原 + 双向FE-DID + 事件研究，统一支持同质`policy_time`/交错`treat_time_var`）；路由注册并纳入 `RESTRICTED_ANALYSIS_TYPES`，新增do文件片段；前端新增卡片、配置区复用、`PSMDIDResult`结果组件、Excel导出三个sheet。已用 `test_data_psm_did.csv` 分别验证同质/交错两种模式，`npx next build` 编译通过。

> 2026-06-15（续）：实机QA `psm_did` 时发现并修复——TWFE/事件研究回归未把"匹配协变量"纳入控制变量（前端互斥逻辑导致用户选了匹配协变量后控制变量框无法重复选择，TWFE表里只有`_did`一项）；改为 `regression_controls = 匹配协变量∪控制变量`（去重）传入两处回归，匹配协变量自动同时作为回归控制变量。重新生成测试数据 `AI_Output/Claude/test_data_psm_did.csv`（50个体×10年，25个交错处理个体三波2018/2019/2020 + 25个从未处理个体，含动态效应与一处故意基期缺失），原根目录测试文件已移除。另发现清洗流程默认"删除缺失值行"会误删 `treat_time_var` 的"从未受处理"标记行，记入 `docs/DEBT.md`。

> 2026-06-15（续2）：根据用户反馈优化大样本下的展示——页面"匹配映射表"改为只展示前20条并提示总条数（避免处理组个体上千时页面渲染不下）；`run_psm_did` 新增返回 `restored_panel`/`restored_panel_cols`（匹配并面板还原后的完整数据，含 `_treated_flag`/`_post`/`_did`），Excel导出新增"PSM-DID匹配面板数据"sheet供下载查看完整数据。`npx next build` 编译通过。

## 进行中

- [ ] `did_robustness` 支持交错处理时点（`treat_time_var`），与 `did_event` 配置保持一致，详见 `docs/DEBT.md`

## 下次会话优先处理

- [ ] 实机QA：`psm_did` 在浏览器中实际跑一遍（含同质/交错两种配置、激活码门控、Excel导出三个sheet展示是否正常）
- [ ] 实机QA "02 变量配置"重排：覆盖单选每种分析类型 + 常见组合（PSM+DID、PSM+DID稳健性检验、调节+中介+异质性等），确认字段显隐与归属符合预期，再考虑提交PR/合并到main

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

### AI 决策层（Harness 架构升级）

当前 AI 仅在结果输出后生成解读文本（末端被动触发），计划升级为"AI 决策 + Python 执行"双层架构，在关键节点主动介入判断。

- [ ] **节点一：数据上传后自动诊断**（优先级最高）
  - Python 计算数据摘要（列类型、缺失率、偏度、唯一值数量等）
  - AI 基于摘要判断：哪些列需强制文本型、哪些列建议对数变换、推荐缺失值处理策略
  - 输出预填到清洗配置 UI，用户可手动覆盖
  - 实现要点：强制 JSON 输出 + 列名合法性校验 + 失败时静默降级不影响主流程

- [ ] **节点二：清洗完成后推荐分析方法**
  - AI 根据清洗后变量结构（数值列/ID列/时间列分布）推荐适合的分析方法
  - 输出预选到分析方法卡片，用户确认后执行
  - 实现要点：识别面板结构（个体+时间）→ 推荐 FE/RE；因变量 0/1 → 提示 Probit/Logit

- [ ] **节点三：结果异常诊断**（现有解读升级）
  - 在现有 AI 解读基础上，增加异常检测：系数符号、R² 合理性、多重共线性迹象
  - 实现要点：结构化 JSON 返回诊断结论，与解读文本分开展示

> 架构原则：AI 负责判断，Python 负责执行。统计计算全程由 statsmodels/linearmodels 完成，保证输出可复现、可验证、与 Stata 对齐。AI 建议均作为默认值而非强制执行，用户保留最终控制权。

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
