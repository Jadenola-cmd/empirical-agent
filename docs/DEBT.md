# 技术债务

记录已知的临时方案、妥协决策和潜在风险。修改相关模块前先看这里。

---

## 后端

**~~`did_robustness` 仅支持同质处理时点~~（已解决，2026-06-15）**
2026-06-14 用户反馈的不一致问题已修复：`run_did_robustness` 新增 `treat_time_var` 参数，与 `_compute_post_treat`（新抽取的公共函数，`did_event_study` 同时复用）统一构造处理时点；安慰剂检验交错模式下保留真实处理时点分布做permutation，剔除政策当期交错模式下剔除各处理组个体自身 `_rel_time==0` 观测。前端配置区已统一支持 `treatTimeVar`/`policyTime` 共享传参。详见 `docs/CHANGELOG.md` 2026-06-15（续3）。

**PSM 对面板数据采用"混合/池化"匹配，未按截面分期匹配（设计已确认，待实现）**
2026-06-14 用户提问引出：`run_psm`（`api/services/stats.py:1417`）完全不使用 `entity_var`/`time_var`，把传入的数据当作一个普通横截面，将所有"个体×年份"观测一起做 Logit 估计倾向得分 + 近邻匹配（pooled/mixed matching）。
若输入数据是面板（多期），这种做法存在已知问题：①同一个体在不同年份的观测被当作独立样本，违反匹配方法的独立性假设，可能造成伪重复（pseudo-replication）和标准误低估；②处理组个体的"处理前"和"处理后"观测可能互相匹配，污染ATT估计。

2026-06-15：已实现新分析类型 `psm_did`（基期截面匹配 + 面板还原 + TWFE + 事件研究，支持同质/交错处理时点），作为面板场景的补充选项；`run_psm` 当前的混合匹配模式保留不变（供纯横截面用户使用），未删除/未标注废弃。`psm_did` 已纳入激活码门控，尚待实机QA（见 `docs/STATUS.md` "下次会话优先处理"）。

**`.xls` 文件不支持**
未安装 `xlrd`，用户上传 `.xls` 会报错。解析层（`data_loader.py`）只处理 `.xlsx`/`.csv`/`.dta`。如需支持，`pip install xlrd` 并在 `data_loader.py` 添加分支。

**Session TTL 硬编码 4 小时**
`session_store.py` 中 TTL 为 4 小时（2026-06-07 由 2 小时延长），仍是写死的临时值而非配置项。用户放置超 4 小时再分析会提示"会话已过期"，需重新上传/清洗。后续可改为环境变量配置。

**Railway 不会自动跟着 feature 分支部署**
平台同时跑在腾讯云（国内）和 Vercel+Railway（国外）两套环境，详见 `CLAUDE.md` 部署章节。Vercel 默认对每个分支/PR 都生成预览部署，但 Railway 默认只监听项目里配置的那一个分支（通常是 `main`），推送 feature 分支不会触发 Railway 自动部署。如需在 Railway 上预览 feature 分支效果，须去 Railway 控制台手动为该分支配置独立 environment。

> 2026-06-15：`feature/did-robustness-staggered` 分支已在 Railway 手动配置好独立 environment（用户确认"已为当前分支单独配置好了"），可直接用 Vercel 该分支的预览部署进行实机QA。此为按分支手动配置，并非全局自动跟踪——后续新建的 feature 分支如需 Railway 预览，仍需重复此手动配置步骤。

**缩尾处理生成的 Stata 片段依赖 `winsor2`（非内置命令）**
清洗步骤生成的 `winsor2 ..., cuts(...) replace` 不是 Stata 自带命令，用户需先在 Stata 里执行 `ssc install winsor2` 才能运行。平台无法控制用户的 Stata 环境，已在生成的 do 片段中加注释提示，但仍可能有用户忽略导致报错。

**中介效应分析仅实现 Baron-Kenny 三步法，显著性阈值 p<0.1**
`run_mediation` 按 Baron & Kenny (1986) 经典三步法判定中介类型（无/部分/完全），未实现 Bootstrap 或 Sobel 检验。该方法对样本量和效应量较敏感，结果中已提示用户结合其他方法进一步验证。后续如有需要可加 Bootstrap 选项。

**SSH 保持密码登录 + root 可登录（用户主动选择）**
2026-06-10 安全排查发现服务器 SSH 端口22、`PasswordAuthentication yes`、`PermitRootLogin yes`，理论上有暴力破解风险。用户明确表示需要保留宝塔面板的免密登录方式，因此未禁用密码/root登录。已安装 fail2ban（`/etc/fail2ban/jail.d/sshd.local`，5分钟内失败5次封禁1小时）作为折中防护。FastAPI `/docs`、`/redoc`、内部端口 8000/3000 均未对公网暴露，nginx/防火墙配置无异常。如后续不再需要宝塔登录，可重新评估禁用密码登录。

**`/api/analyze/run` 超时熔断后，超时的线程仍会残留占满 CPU 直至进程重启**
2026-06-12 发现：一次包含 `descriptive/correlation/panel_balance/pca/did/moderation/heterogeneity` 的分析请求（`面板数据0611.xlsx`，2611行×50列）卡死，CPU 占满 2 核近 9 小时（根因未定位，怀疑某个 x 变量是高基数字符串列，`_expand_categoricals` 生成大量哑变量后，PanelOLS `drop_absorbed=True` 的共线性检测在该规模下退化）。原始数据与 session 已因 TTL 自动清理丢失，无法复现定位。

2026-06-13 已为 `/api/analyze/run` 增加 90 秒超时熔断（`routes/analyze.py`，`concurrent.futures.ThreadPoolExecutor` + `future.result(timeout=...)`），超时后立即向用户返回 504 提示精简分析类型/数据量，不再无限转圈。但这只是**响应层面**的缓解：`ThreadPoolExecutor` 的线程无法被强制中断，超时后台计算仍会继续占用 CPU 直至自然结束或进程重启；执行器 `max_workers=2`，若短时间内多次触发该场景，2 个 worker 都被占满后新请求会排队等待。根治仍需：① `_expand_categoricals` 前对高基数 object 列加基数阈值保护（超过阈值报错提示用户排除该变量，而非静默 `get_dummies`）；② 真正可中断的执行方式（如 `ProcessPoolExecutor` + `terminate()`）。

**PSM 的 ATT 标准误为简单标准误，非 Abadie-Imbens 修正方差**
`run_psm`（`stats.py`）的 ATT 标准误按匹配后差值的简单标准误计算（`diffs.std(ddof=1) / sqrt(n)`），未实现 Abadie & Imbens (2006) 针对近邻匹配的修正方差估计，存在一定的有效自由度低估问题。已在结果 `notes` 中向用户说明对应 Stata `psmatch2` 的近似估计。后续如有需要可补充 AI 修正方差。

**DID 稳健性检验的安慰剂检验固定 `n_placebo=100`，未根据数据规模动态调整**
`run_did_robustness`（`stats.py`）每次安慰剂检验循环 100 次 `run_panel`，在 90 秒超时熔断内对中小型面板数据（千行级）通常无压力，但若叠加大数据集（万行级以上）或与其他重型分析类型同时勾选，可能逼近超时阈值。暂未做动态调整或单独的子超时控制，上线后需观察该分析类型在大数据场景下的实际耗时。

**腾讯云服务器内存仅 1.9GB，处理大文件易触发 OOM 导致 502**
2026-06-10 发现：上传/合并多个大体量 .dta 文件（5-6 万行 × 上百列）时，后端 `empirical-api` 内存占用冲到 ~1.5GB 被系统 OOM Killer 杀掉，PM2 自动重启期间前端请求收到 502。已临时加 2GB swap（`/swapfile`，已写入 `/etc/fstab` 持久化）缓解，但只是延迟而非根治——swap 期间响应会变慢。根治需优化 `cleaner.py`/`stats.py` 的内存使用（分块读取、及时释放中间 DataFrame）或升级服务器内存。

---

## 前端

**部署后须强制刷新才能用新版本**
Next.js 动态加载 chunk，新版本部署后旧 chunk hash 失效，浏览器直接 F5 会 404。用户必须 Ctrl+Shift+R 强制刷新。根本解决方案是配置 `Cache-Control` 或在 Nginx 层处理，暂未实施。

**所有逻辑和样式集中在 `pages/index.js`**
单文件超长，可维护性差。当前未拆分是因为项目阶段早期，重构收益低于成本。新增功能尽量按现有模式追加，不要引入新的文件组织方式（避免一半拆分一半不拆分）。

**"02 变量配置"区域：单选PSM无配置 + 多选时字段归属不清（已按方案B修复，待QA）**
2026-06-13 用户测试发现两个问题：① `needsReg` 数组缺 `"psm"`，导致整个变量配置区块在仅选PSM时完全不渲染；② PSM与DID各自渲染一份"处理组变量 Treatment"控件且共用同一个 `treatmentVar` 状态，同时选中时页面出现两个同名重复控件，用户分不清字段归属。

2026-06-13（续2）已按方案B完成重排：拆出"通用配置"（Y/解释变量X或协变量/控制变量/标准误，标准误用新增 `needsSE` 控制，PSM不显示），其余按分析类型各自一个带标题的 `.config-group` 子区块；Treatment 合并为单一控件放在独立的"处理组变量 Treatment"分组，标题标注"用于：XX"。同时修复了 `needsReg` 缺 `"psm"`/`"did_robustness"` 的bug。`npx next build` 编译通过，**尚未实机QA**：需覆盖单选每种分析类型 + 常见组合（PSM+DID、PSM+DID稳健性检验、调节+中介+异质性等）。

**清洗步骤默认"删除缺失值行"会误删 `did_event`/`psm_did` 的"从未受处理"对照组（交错处理时点列含义性空值被当作缺失数据）**
2026-06-15 实机QA `psm_did` 时发现：`cleaner.py` 缺失值处理默认 `missing_strategy="drop"` 且 `missing_cols` 为空时执行 `df.dropna()`（对全部列生效）。`treat_time_var`（如 `treat_time`）列中"从未受处理"个体的空值是有意义的标记（被 `run_did_event_study`/`run_psm_did` 用来识别对照组），但默认清洗会把这些行当作缺失数据整行删除，导致 `psm_did` 报错"未识别到从未受处理的个体，无法构建对照组"。当前"02 变量配置"中关于该列的警示提示（`pages/index.js` 约2470行）出现在清洗完成之后，为时已晚，无法在清洗阶段提醒用户。
**待办**：①调整提示时机/位置，在清洗步骤的"缺失值处理"区域提前告知用户哪些列含"有意义的空值"不应纳入 `dropna`/填充范围；②或考虑：分析阶段选定 `treat_time_var` 后，若该列在 `cleanedData` 中已无任意缺失值（说明被清洗误删），给出诊断提示而非笼统报错。


