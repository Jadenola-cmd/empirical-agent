# CHANGELOG

只追加，不删旧内容。回溯历史时手动提供给 Claude。

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
