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

---

## 前端

**部署后须强制刷新才能用新版本**
Next.js 动态加载 chunk，新版本部署后旧 chunk hash 失效，浏览器直接 F5 会 404。用户必须 Ctrl+Shift+R 强制刷新。根本解决方案是配置 `Cache-Control` 或在 Nginx 层处理，暂未实施。

**所有逻辑和样式集中在 `pages/index.js`**
单文件超长，可维护性差。当前未拆分是因为项目阶段早期，重构收益低于成本。新增功能尽量按现有模式追加，不要引入新的文件组织方式（避免一半拆分一半不拆分）。

