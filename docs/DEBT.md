# 技术债务

记录已知的临时方案、妥协决策和潜在风险。修改相关模块前先看这里。

---

## 后端

**`.xls` 文件不支持**
未安装 `xlrd`，用户上传 `.xls` 会报错。解析层（`data_loader.py`）只处理 `.xlsx`/`.csv`/`.dta`。如需支持，`pip install xlrd` 并在 `data_loader.py` 添加分支。

**Session TTL 硬编码 1 小时**
`session_store.py` 中 TTL 为 1 小时，是上线时的临时值。用户放置超 1 小时再分析会提示"会话已过期"。后续可改为配置项或延长。

**Railway 配置未维护**
`api/index.py`（Mangum 适配器）和 `api/railway.toml` 保留备用，但当前部署在腾讯云，Railway 配置未同步最新改动，不可直接用于生产部署。

**缩尾处理生成的 Stata 片段依赖 `winsor2`（非内置命令）**
清洗步骤生成的 `winsor2 ..., cuts(...) replace` 不是 Stata 自带命令，用户需先在 Stata 里执行 `ssc install winsor2` 才能运行。平台无法控制用户的 Stata 环境，已在生成的 do 片段中加注释提示，但仍可能有用户忽略导致报错。

---

## 前端

**部署后须强制刷新才能用新版本**
Next.js 动态加载 chunk，新版本部署后旧 chunk hash 失效，浏览器直接 F5 会 404。用户必须 Ctrl+Shift+R 强制刷新。根本解决方案是配置 `Cache-Control` 或在 Nginx 层处理，暂未实施。

**所有逻辑和样式集中在 `pages/index.js`**
单文件超长，可维护性差。当前未拆分是因为项目阶段早期，重构收益低于成本。新增功能尽量按现有模式追加，不要引入新的文件组织方式（避免一半拆分一半不拆分）。

