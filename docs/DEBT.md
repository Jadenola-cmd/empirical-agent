# 技术债务

记录已知的临时方案、妥协决策和潜在风险。修改相关模块前先看这里。

---

## 后端

**`.xls` 文件不支持**
未安装 `xlrd`，用户上传 `.xls` 会报错。解析层（`data_loader.py`）只处理 `.xlsx`/`.csv`/`.dta`。如需支持，`pip install xlrd` 并在 `data_loader.py` 添加分支。

**Session TTL 硬编码 4 小时**
`session_store.py` 中 TTL 为 4 小时（2026-06-07 由 2 小时延长），仍是写死的临时值而非配置项。用户放置超 4 小时再分析会提示"会话已过期"，需重新上传/清洗。后续可改为环境变量配置。

**Railway 不会自动跟着 feature 分支部署**
平台同时跑在腾讯云（国内）和 Vercel+Railway（国外）两套环境，详见 `CLAUDE.md` 部署章节。Vercel 默认对每个分支/PR 都生成预览部署，但 Railway 默认只监听项目里配置的那一个分支（通常是 `main`），推送 feature 分支不会触发 Railway 自动部署。如需在 Railway 上预览 feature 分支效果，须去 Railway 控制台手动为该分支配置独立 environment。

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

**"02 变量配置"区域：单选PSM无配置 + 多选时字段归属不清（待修复，方案已定）**
2026-06-13 用户测试发现两个问题：① `needsReg`（`pages/index.js:1784` 附近）数组缺 `"psm"`，导致整个变量配置区块（含被解释变量Y、协变量、PSM专属的Treatment/近邻数/Caliper）在仅选PSM时完全不渲染；② PSM（2185-2210行）与DID（2211-2224行）各自渲染了一份"处理组变量 Treatment"控件且共用同一个 `treatmentVar` 状态，同时选中PSM+DID稳健性检验时页面出现两个同名重复控件，用户分不清字段归属，其他分析类型组合可能有类似潜在问题。

已与用户讨论两个方案：方案A（最小修复，~35-40行，修needsReg+合并去重Treatment+给各区块加"用于：XX"标签提示，约45分钟-1小时）vs 方案B（结构性重排，~200-250行，按分析类型拆成带标题的子区块"PSM配置"/"DID稳健性检验配置"等+通用配置分离+新增CSS，约2.5-3.5小时，更适合后续持续新增分析类型）。**用户选择方案B，下次会话实施**：
- 拆出"通用配置"小节（Y/X/控制变量）
- 每个选中分析类型各自一个带标题的子区块（如"PSM 配置"、"DID稳健性检验 配置"），需新增 `.config-group`/`.config-group-title` 等CSS
- 共享字段（如Treatment）的归属位置需在实施时定（放"通用配置"还是单独"共享配置"分组）
- 实施时顺带修复 `needsReg` 缺 `"psm"` 的bug
- QA需覆盖单选每种分析类型 + 常见组合（PSM+DID、调节+中介+异质性等）

