# CHANGELOG

只追加，不删旧内容。回溯历史时手动提供给 Claude。

---

## 2026-06-15

**新增**
- PSM-DID 基期锁定匹配（新分析类型 `psm_did`）：按设计方案一次性实现，支持同质（`policy_time`）/交错（`treat_time_var`）处理时点统一处理。
  - 后端 `api/services/stats.py`：抽取 `_psm_match_core`（Logit倾向得分 + 近邻匹配 + caliper筛选，供 `run_psm`/`run_psm_did` 共用）与 `_psm_balance_table`（pstest两行式平衡性表，供两者共用）；`run_psm` 重构为调用这两个共享函数，输出结构不变。新增 `run_psm_did`：按各处理组个体 `baseline_year = treat_time - 1` 分block截面，分别PSM匹配，汇总平衡性表，还原面板并调用 `run_panel`（双向FE）得到 `_did` 系数（ATT），再调用 `run_did_event_study` 输出事件研究（窗口默认前3后5，独立于 `did_event` 的3/3默认值）。
  - 路由 `api/routes/analyze.py`：注册 `psm_did`，纳入 `RESTRICTED_ANALYSIS_TYPES`；新增do文件片段生成（`psmatch2`+`pstest`+`xtreg fe`示例）。
  - 前端 `pages/index.js`：`ANALYSIS_REGISTRY`/`LOCKED_ANALYSIS_TYPES` 新增 `psm_did`（因果识别分类）；"02 变量配置"复用PSM配置块（合并为"PSM / PSM-DID 配置"）+ Treatment块 + DID事件研究配置块（合并为"DID事件研究 / PSM-DID 配置"）；勾选 `psm_did` 且未勾选 `did_event` 时自动将事件窗口"后"默认值改为5；抽出 `PSMBalanceTable` 组件供 `PSMTable` 与新增 `PSMDIDResult`（诊断摘要+分block表+平衡性表+匹配映射表）复用；结果区新增 `PSMDIDResult` + TWFE系数表 + 事件研究图表；Excel导出新增"PSM-DID诊断"/"PSM-DID TWFE"/"PSM-DID事件研究"三个sheet。
  - 已用 `test_data_psm_did.csv` 验证：同质模式（policy_time=2021）与构造的交错模式（treat_time分两波2021/2022）均匹配成功并输出 `_did` 系数，`npx next build` 编译通过。

**变更（实机QA中发现并修复）**
- `run_psm_did` 的 TWFE/事件研究回归此前只把"控制变量"传入 `run_panel`/`run_did_event_study`，"匹配协变量"（`indep_vars`）不会出现在回归表里，与前端"匹配协变量已选中的列不能再选作控制变量"的互斥逻辑冲突，导致用户选了匹配协变量后TWFE表里只有 `_did` 一项。改为 `regression_controls = covariates + control_vars`（去重并集）传入TWFE与事件研究，即匹配协变量自动同时作为回归控制变量（PSM+回归调整的常见做法），`notes` 中补充说明。
- 重新生成测试数据 `AI_Output/Claude/test_data_psm_did.csv`（50个体×10年=499行）：25个交错处理个体（2018/2019/2020三波）+ 25个从未处理个体，含动态处理效应与一处故意的基期缺失（firm=1缺2017年观测，用于验证剔除诊断）；原根目录下的 `test_data_psm_did.csv` 已移除（应放入 `.gitignore` 标记的 `AI_Output/` 而非项目根目录）。
- 记录新发现的清洗流程坑到 `docs/DEBT.md`：默认"缺失值处理=删除行"会把 `treat_time_var` 中"从未受处理"的有意义空值整行删除，导致 `psm_did` 报错"未识别到从未受处理的个体"；当前的警示提示出现在清洗之后，为时已晚。

**变更（续3，按用户反馈优化大样本展示）**
- `run_psm_did` 新增返回 `restored_panel`/`restored_panel_cols`：匹配并面板还原后的完整数据（含 `_treated_flag`/`_post`/`_did`），NaN转`None`。
- 前端"匹配映射表"改为只展示前20条并提示总条数，避免处理组个体数较多时页面表格无法完整渲染；Excel导出新增"PSM-DID匹配面板数据"sheet，包含完整匹配还原面板数据供下载查看。

---

## 2026-06-14

**变更**
- PSM 平衡性检验输出对照 Stata `pstest` 格式重做：`run_psm`（`api/services/stats.py`）匹配时追踪每个对照组观测的匹配权重，平衡性表按协变量拆为 Unmatched/Matched 两行，给出处理组均值、（按权重加权的）对照组均值、%Bias、组间t检验(t/p>|t|)，Matched 行新增 %Reduct|Bias|（偏差缩减比例）；新增 `balance_summary` 字段（Pseudo R²、LR χ²及p值、匹配前后 Mean/Median |Bias|）。前端 `PSMTable` 组件与 Excel 导出同步改为两行式表格展示。
- 修复"政策时点 Policy Time"输入框输入年份会变成负数的bug（已实机验证）：`pages/index.js` 中两处 policyTime 输入框由 `type="number"` 改为 `type="text"` + `inputMode="numeric"`，onChange 用正则 `/^-?\d*$/` 校验。`type="number"` 在 Chrome 中聚焦时滚动鼠标滚轮会按 step 递增/递减数值（用户输入年份后滚动页面查看其他配置项，数值被滚轮悄悄改变），改为 text 输入后不再响应滚轮。

---

## 2026-06-13（续2）

**修复/重构**
- "02 变量配置"区域按方案B结构性重排：拆分为"通用配置"（被解释变量Y / 解释变量X或PSM协变量 / 控制变量 / 标准误）+ 各分析类型独立的带标题子区块（处理组变量 Treatment / 调节效应分析 配置 / 中介效应分析 配置 / 异质性分析 配置 / 工具变量法 配置 / PSM 配置 / DID(及稳健性检验) 配置 / DID事件研究 配置 / 面板数据设置），新增 `.config-group`/`.config-group-title` CSS
- 修复 `needsReg` 缺 `"psm"`/`"did_robustness"` 的bug：此前单选PSM或单选DID稳健性检验时整个变量配置区块不渲染
- 新增 `needsSE`（不含 `psm`）单独控制"标准误"区块显示，避免PSM场景下出现无意义的SE选择项
- PSM/DID/DID事件研究共用的"处理组变量 Treatment"控件合并为单一控件，置于独立分组，标题标注"用于：XX"说明共享归属，消除多选时的重复字段

---

## 2026-06-13（续）

**新增**
- 数据清洗新增"滞后变量"批量生成操作：按 `entity_var` 分组对指定变量做 `shift(n)`，对齐 Stata `xtset` + `gen x_lag = L.x`，面板回归常用
- 新增 Probit/Logit 二元被解释变量回归：基于 `statsmodels` MLE 估计，结果区展示系数表（含 Pseudo R²、对数似然、LR χ²）与边际效应表（AME），Excel 导出补充对应 sheet，Stata do 片段同步生成
- 新增 DID 稳健性检验包（`did_robustness`）：安慰剂检验（随机重新分配处理组身份，重复100次，给出伪p值）+ 剔除政策当期重新估计，结果区与 Excel 导出均补充展示
- 新增 PSM 倾向得分匹配（`psm`）：Logit 估计倾向得分 + 近邻匹配（有放回，支持自定义近邻数与 caliper）+ 平衡性检验（标准化均值差）+ 共同支撑域统计，ATT 标准误为匹配后差值的简单标准误（非 Abadie-Imbens 修正方差），结果区与 Excel 导出均补充展示
- 新增激活码门控系统：单一共享激活码（`ACTIVATION_CODE` 环境变量，默认 `EMPIRICAL2026`），新增 `/api/activation/verify` 校验接口；`/api/leads/submit` 提交联系方式后自动返回激活码（无需建发信服务）；前端用 `localStorage` 记录解锁状态
- 锁定范围（2026-06-13 与用户讨论确定）：本次新增的 Probit/Logit/PSM/DID稳健性检验 四项分析类型需激活码解锁（后端 `RESTRICTED_ANALYSIS_TYPES` + 前端 `LOCKED_ANALYSIS_TYPES` 双重限制，避免仅前端限制被绕过）；已上线的 did/did_event/iv/moderation/mediation/heterogeneity 等免费功能不受影响。同时，全部导出功能（xlsx/do/txt）改为需解锁后才可使用，未解锁时点击导出按钮弹出解锁提示

---

## 2026-06-13

**修复**
- `/api/analyze/run` 增加超时熔断（90秒）：计算逻辑提交到独立线程池执行，超时则返回 504 并提示用户减少分析类型或缩减数据量，避免单个重型分析组合无限期占满 CPU、前端无限转圈无响应。复盘发现 06-12 09:21 那次卡死正是 `descriptive/correlation/panel_balance/pca/did/moderation/heterogeneity` 七种类型同时勾选（`面板数据0611.xlsx`，2611行×50列）触发，根因仍未定位（见 `docs/DEBT.md`），此次为兜底缓解，非根治

---

## 2026-06-12

**修复**
- 修复生产环境严重故障：`/api/analyze/run` 标注为 `async def` 但内部全是同步阻塞计算（pandas/statsmodels/linearmodels），未使用任何 `await`，单个耗时分析请求会独占事件循环线程，导致全站所有接口（健康检查、上传、埋点等）一并 504。当日 09:21 一次包含 `pca/did/moderation/heterogeneity` 的分析请求卡死，CPU 占满双核近 9 小时，期间全站不可用，重启 `empirical-api` 恢复。改为 `def run_analysis`，由 FastAPI 线程池执行，单个慢请求不再拖垒整个服务

**新增**
- 新增每日数据日报脚本 `api/scripts/daily_report.py`：统计前一天 UV/PV、核心转化漏斗（访问→上传→清洗→分析→成功→导出，含逐级转化率，表格右对齐）、功能使用排名、"申请试用"弹窗转化率、analysis_error 异常详情、试用线索列表、亮点摘要，以飞书卡片（schema 2.0，含 table 组件）推送到群自定义机器人；服务器 crontab 每天 8:30 自动执行（`api/.env` 新增 `FEISHU_WEBHOOK_URL`，已通过 `dotenv` 加载，本地 `.env.example` 同步更新示例）。飞书为个人版账号，多维表格方案因权限管理/版本发布流程不可用，改用群自定义机器人 Webhook（关键词校验需关闭或不设置）

---

## 2026-06-10（续·三）

**修复**
- 修复埋点上线后首页 "Application error" 崩溃：`crypto.randomUUID()` 仅在 HTTPS/localhost 等安全上下文可用，生产环境通过 `http://IP` 访问时为 `undefined`，`page_view` 埋点的 `useEffect` 中调用即抛错，触发 React 错误边界导致整页白屏。改为不可用时降级为手写 UUID v4 生成，并对 `localStorage`/`fetch` 包裹 `try/catch`，埋点失败不再影响页面正常使用

---

## 2026-06-10（续）

**新功能**
- 新增"申请试用"弹窗：用户点击导出按钮（xlsx/do文件/txt）时弹出，宣传即将上线的高级功能（Probit/Logit、PSM、Heckman、LaTeX 导出等），引导留下邮箱/微信领取试用激活码；首次导出后弹出（`localStorage` 标记，不重复打扰），不阻断导出本身
- 后端新增 `/api/leads/submit`（`api/routes/leads.py`），将联系方式追加写入 `api/data/leads.jsonl`（已加入 `.gitignore`，不提交用户隐私数据）
- 新增项目 `.gitignore`（此前不存在），同时补充 `node_modules/`、`.next/`、`__pycache__/` 等常规忽略项

**埋点**
- `/api/leads/event` 扩展为通用埋点接口（`api/routes/leads.py`），新增 `visitor_id`（前端 `localStorage` 生成的匿名 UUID，用于 UV 去重）、`props`（事件附加信息），统一写入 `api/data/events.jsonl`
- 前端新增通用 `track(event, props)` 函数，覆盖完整使用漏斗：`page_view`（UV/PV）、`file_uploaded`、`clean_completed`、`analysis_run`/`analysis_success`/`analysis_error`（含 `analysis_types`）、`interpret_used`、`export_clicked`（含格式 xlsx/do/txt），以及此前的 `trial_modal_shown`/`skipped`/`submitted`，可据此计算各步骤转化率与功能使用排名

---

## 2026-06-10

**修复**
- 修复 `/api/analyze/run` 偶发 500：`_sanitize`（`api/routes/analyze.py`）原先只处理 Python 原生 `float`，遇到 `np.float32` NaN/Inf 或未转换的 `np.ndarray`（含 NaN）会被 Starlette `JSONResponse`（`allow_nan=False`）拒绝并抛 `ValueError: Out of range float values are not JSON compliant`，导致整次分析请求 500（线上日志统计约影响 7% 的分析请求）。现在 `_sanitize` 同时识别 `np.floating` 子类型并对 `np.ndarray`/`tuple` 递归处理，统一转 `None`/`list`

**运维 / 修复**
- 修复生产环境 502：服务器内存仅 1.9GB 且无 swap，处理多个大体量 .dta 文件合并时后端 `empirical-api` 被系统 OOM Killer 杀死，PM2 重启期间请求 502；已添加 2GB swap（`/swapfile`，写入 `/etc/fstab` 持久化）作为缓解，根治需优化清洗/分析的内存使用或升级服务器内存

**安全**
- 完成服务器安全排查：SSH（端口22、密码登录、root登录均开启，用户为保留宝塔面板登录主动选择保留）、FastAPI `/docs`/`/redoc`/`openapi.json` 及内部端口 8000/3000 均未对公网暴露、nginx default_server 配置正常、防火墙策略、进程排查（无挖矿/异常进程）
- 新增 fail2ban 防护 SSH 暴力破解（5分钟内失败5次封禁1小时）

---

## 2026-06-09

**新功能**
- 新增多时点DID事件研究（`did_event`）：支持同质处理（统一政策时点）和交错处理（各个体处理时间不同，通过 `treat_time_var` 列指定）两种模式；以 t=-1 为基期，在指定窗口内构造事件时间虚拟变量，跑个体+时间双向固定效应，展示各期系数与 95% CI；附平行趋势检验（政策前各期系数个别显著性），注册在"因果识别"类别
- 后端新增 `run_did_event_study`（`stats.py`），`analyze.py` 同步新增 `AnalysisRequest` 字段（`treat_time_var`、`window_pre`、`window_post`）、keep 逻辑、分析分支和 Stata do 生成
- 前端新增 `EventStudyTable` 组件（分色展示政策前/后各期系数、基期标注、平行趋势检验框），`ANALYSIS_REGISTRY` 注册，参数 UI（处理时间列、事件窗口设置）；前端构建通过

---

## 2026-06-08（续·二）

**修复**
- 修复 PCA 适用性检验在变量高度相关（PCA 典型场景）时 KMO/Bartlett 返回空值的问题：原实现用 `np.linalg.det`/`np.linalg.inv`，相关系数矩阵接近奇异时行列式下溢为 0、逆矩阵报错或数值不稳定，导致检验"有名无值"；改为 `np.linalg.slogdet`（对数行列式，避免下溢）与 `np.linalg.pinv`（伪逆，容忍病态矩阵），现可稳定输出 KMO 数值、等级标签、Bartlett χ²/df/p 及显著性判断

**功能增强**
- PCA 综合得分现会按行写回完整清洗数据，自动生成新变量（`pca_score`，重名时自动加后缀）并返回新的 `cleaned_session_id`；前端同步更新清洗数据缓存与会话，使综合得分可直接在后续回归等分析中作为变量选用，无需重新清洗或手动合并（`run_pca` 的 `composite_score` 新增逐行 `values` 字段，`/api/analyze/run` 中 PCA 分支负责合并写回与生成新会话）
- Excel 导出补充"主成分分析"（适用性检验、成分表、载荷表、综合得分明细）与"工具变量2SLS"（系数表、第一阶段诊断、过度识别检验）两个结果 sheet：此前导出仅含清洗数据与描述统计/相关矩阵/回归结果，新增的 PCA、IV 分析结果未被导出

---

## 2026-06-08（续）

**功能增强**
- 主成分分析 PCA 新增"适用性检验"（KMO 抽样适当性度量 + Bartlett 球形检验，基于相关系数矩阵手工实现，含 KMO 等级标签与显著性判断）与"综合得分"（按已保留主成分的方差贡献率加权汇总各主成分得分，输出权重、均值/标准差/极值及得分最高/最低样本排名），`run_pca` 返回新增 `suitability`/`composite_score` 字段；前端 `PCATable` 同步展示，`_gen_analyze_do` 补充 `factortest`/`predict`/综合得分计算的 Stata 代码片段

---

## 2026-06-08

**新功能**
- 实证分析新增三种类型，均接入 `/api/analyze/run`：
  - Sobel (1982) 检验：作为 Baron-Kenny 三步法的补充验证，基于已估计的路径 a、b 系数与标准误计算间接效应 a×b 的 z 统计量与 p 值，并入 `run_mediation` 返回结果（`sobel` 字段），前端中介效应结果区同步展示判定结论
  - 工具变量法 2SLS（`run_iv`）：基于 `linearmodels.iv.IV2SLS` 估计，自动报告第一阶段 F 统计量（弱工具变量诊断，经验法则 F<10）及过度识别检验（Sargan，仅工具变量数 > 内生变量数时报告），归类为"因果识别"
  - 主成分分析 PCA（`run_pca`）：基于 `numpy` 对相关系数矩阵（默认）或协方差矩阵做特征值分解，输出各主成分特征值/方差贡献率/累计贡献率及载荷矩阵，按 Kaiser 准则（特征值>1）自动判定保留主成分数，归类为"数据探索"
- `_gen_analyze_do()` 同步追加三类分析对应的 Stata 代码片段生成（`ivregress 2sls` + `estat firststage`/`estat overid`；`pca`）
- 前端新增 `IVTable`（含第一阶段 F 检验与过度识别检验展示）、`PCATable`（方差贡献率表 + 载荷表）结果展示组件，及内生变量/工具变量、PCA 标准化方式选择器
- 数据清洗新增"删除重复值"步骤（`dedup_vars`/`dedup_keep`，支持保留首次/末次/全部删除三种策略），常用于处理 1:N / N:N 合并产生的重复行；同步生成对应 Stata `duplicates drop` / `bysort ... keep if _n==1` 代码片段

**修复**
- PCA 结果备注文案修正：原文案同时出现"按 Kaiser 准则保留"与"累计贡献率超过 80% 的成分被保留"两种相互矛盾的判定依据描述，现明确 Kaiser 准则（特征值>1）为实际采用的默认标准，累计方差贡献率 80% 仅作为用户手动调整保留数量时的参考经验值

**前端体验**
- 头部"使用文档"入口由纯文字链接改为带图标的胶囊按钮样式（📖 查看使用文档），提升可见度
- `/docs` 页面底部新增"扫码联系作者"占位区块：预留 `public/contact-qr.png` 图片位置，图片缺失时自动显示占位框，放入真实二维码图片即可生效

**部署修复**
- `deploy.sh` 补充 `package.json` 变更时自动 `npm install`：此前脚本仅在 `requirements.txt` 变化时安装 Python 依赖，前端新依赖（如 `react-markdown`/`remark-gfm`）始终未被安装，导致服务器构建报 `Module not found`

---

## 2026-06-07（晚间·二）

**优化**
- 中介效应分析结果展示由「三张独立完整回归表堆叠」改为「单张三步合并对比表」（新增 `MediationTable` 组件，复用 `CompareTable` 的 `compare-tbl` 视觉样式与 t值/标准误切换交互），对齐学术论文中 Baron-Kenny 中介效应检验的标准排版：三步模型并列为列，可直接对比 c → c' 的变化幅度，表头标注路径标签（总效应 c / 路径 a / 路径 b·c'），表注说明各模型含义

---

## 2026-06-07（晚间）

**Bug 修复**
- 中介效应分析报错 `cannot convert the series to <class 'float'>`：`run_mediation` 的 step2（M ~ X）把中介变量当作被解释变量传给 `run_ols`，但后者只对解释变量做数值转换/虚拟化、不处理 dep_var；中介变量为 object dtype 时 `sm.OLS` 直接拿字符串 Series 拟合即报错。现已在调用前显式 `pd.to_numeric` 转换，转换后有效值不足则抛出明确提示「中介变量须为数值型连续变量」

**新功能**
- 实证分析新增两种类型，均接入 `/api/analyze/run`：
  - 中介效应分析（`run_mediation`）：Baron & Kenny (1986) 三步法，依次估计 `Y~X`（总效应 c）、`M~X`（路径 a）、`Y~X+M`（路径 b、直接效应 c'），按 p<0.1 自动判定"无中介/部分中介/完全中介"并给出结论文案
  - 异质性分析（`run_heterogeneity`）：按分组变量以中位数二分 / 三分位三分 / 类别取值（≤6组）拆分样本，对每组分别估计同一回归模型（OLS 或面板 FE）并列对比，复用 `run_ols`/`run_panel`
- `_gen_analyze_do()` 同步追加两类分析对应的 Stata 代码片段生成（中介三步 `reg`；异质性按分组方式生成 `levelsof`/`xtile`/`summarize` + 分组 `reg`）

**前端重构**
- 引入 `ANALYSIS_REGISTRY` 声明式配置数组，分析方法卡片按 `category` 字段（数据探索/主回归分析/因果识别/机制检验/稳健性检验）自动分组渲染，新增分析方法只需在注册表追加一条配置
- 新增通用 `HeterogeneityTable` 组件，根据 `data.groups` 动态渲染 N 组对比列（不写死分组数量）
- 新增中介效应、异质性分析对应的变量选择器（中介变量 M / 分组变量 + 分组方式单选）及结果展示区块

---

## 2026-06-07（下午）

**合并上线**
- 将 `feature/winsorize-did-moderation-panel-balance-docs` 分支 fast-forward 合并到 `main`：缩尾处理、面板平衡性检查、调节效应分析、双重差分 DID、`/docs` 文档入口共 5 项新增功能，及批量对数变换的待办补勾，正式上线
- `session_store.py` 的 session TTL 从 7200 秒（2 小时）延长为 14400 秒（4 小时），同步更正 `CLAUDE.md`/`DEBT.md` 中过时的"硬编码 1 小时"描述（实际此前已是 2 小时，文档未同步）

---

## 2026-06-07

**新功能**
- 数据清洗新增缩尾处理（Winsorize）：可选列 + 上下分位数（默认 1%/99%），`cleaner.py` 按全局百分位 `clip`，并生成对应 `winsor2` Stata 片段
- 实证分析新增三种类型，均以新 `analysis_type` 接入 `/api/analyze/run`，复用 session 加载 / `_sanitize` / `RegressionTable`：
  - 面板平衡性检查（`run_panel_balance`）：对照 Stata `xtdescribe`，识别非平衡面板及缺失的个体-时间组合数
  - 调节效应分析（`run_moderation`）：解释变量与调节变量中心化后构造交互项，复用 `run_ols`（Aiken & West 1991 标准做法）
  - 双重差分 DID（`run_did`）：基于个体+时间双向固定效应（复用 `run_panel`），自动构造 `_post`/`_did`，并在政策前样本上做平行趋势检验
- 新增平台用户文档入口 `/docs`（`pages/docs.js`），构建期通过 `getStaticProps` + `fs.readFileSync` 渲染 `docs/用户手册.md`（`react-markdown` + `remark-gfm`），首页头部新增"使用文档"跳转链接

**其他**
- `docs/STATUS.md`：勾掉/移除"批量对数变换"（核查后发现已实现，仅清单未同步）、"缩尾处理"、"DID"、"调节效应分析"、"面板平衡性检查"、"平台内用户文档入口" 6 项待办

---

## 2026-06-06

**Bug 修复**
- `inf`/`nan` 导致 `/api/analyze/run` 返回 500 → `analyze.py` 的 `_sanitize()` 递归替换为 None
- `_df_to_json_records` 漏判 `inf` → `clean.py` 补充 `math.isinf(v)` 检查
- IQR 异常值过滤失效 → `cleaner.py` 过滤条件 `OR` 改为 `AND`
- 前端 `null.toFixed()` 崩溃（描述统计、相关系数矩阵、Excel 导出）→ `index.js` 全部改用可选链 `?.toFixed() ?? "—"`

**架构变更**
- 引入 server-side session 缓存（`session_store.py`）：上传返回 `session_id`，清洗返回 `cleaned_session_id`，分析阶段从 pickle 恢复 DataFrame，不再传输全量数据

**其他**
- 创建 `docs/用户手册.md`（面向用户的产品文档）
- 部署流程切换为 SSH（git@github.com），解决 GnuTLS TLS 错误
- 标准部署流程确立：`git commit` → `git push` → 服务器 `bash deploy.sh`
