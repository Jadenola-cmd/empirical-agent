# Empirical Research Platform — CLAUDE.md

论文实证分析平台，让不熟悉 Stata 的用户通过网页完成数据清洗、面板回归等实证分析，输出与 Stata 一致的学术规范结果。

@docs/STATUS.md
@docs/DEBT.md

---

## 技术栈

### 前端
- **框架**: Next.js 14（Pages Router）
- **UI**: React 18，单页应用，所有逻辑和样式集中在 `pages/index.js`（inline `<style jsx global>`，无独立 CSS 文件）
- **库**: `xlsx`（Excel 导出），`@vercel/analytics`（用量统计）

### 后端
- **框架**: FastAPI + Uvicorn，Python 3.12
- **统计计算**: `statsmodels`（OLS）、`linearmodels`（面板 FE/RE）、`scipy`（Pearson 相关、卡方分布）
- **数据处理**: `pandas 2.2`、`numpy 1.26`
- **文件解析**: `pandas`（CSV/xlsx）、`pyreadstat`（.dta）；`.xls` 不支持
- **AI 解读**: 阿里云 DashScope API，模型 `deepseek-v4-flash`（需 `DASHSCOPE_API_KEY`）

### 环境变量
| 变量 | 用途 |
|------|------|
| `NEXT_PUBLIC_API_URL` | 前端指向的后端地址，默认 `http://localhost:8000` |
| `DASHSCOPE_API_KEY` | DashScope AI 解读密钥，缺失时返回提示而不报错 |

---

## 文件结构

```
empirical-agent/
├── pages/
│   ├── index.js          # 整个前端：上传、清洗、分析、结果展示、导出
│   └── _app.js           # Next.js App 入口，注入 Vercel Analytics
├── api/
│   ├── main.py           # FastAPI 应用入口，注册路由
│   ├── index.py          # Serverless 函数入口（Mangum 适配器，Vercel+Railway 环境用）
│   ├── railway.toml      # Railway 部署配置（Vercel+Railway 环境用）
│   ├── requirements.txt  # Python 依赖
│   ├── routes/
│   │   ├── clean.py      # /api/clean/* 路由
│   │   ├── analyze.py    # /api/analyze/run 路由
│   │   └── health.py     # /health 健康检查
│   └── services/
│       ├── data_loader.py   # 文件加载（CSV/xlsx/DTA）
│       ├── cleaner.py       # 数据合并、清洗逻辑
│       ├── session_store.py # 会话缓存（pickle + TTL）
│       ├── stats.py         # 统计计算核心
│       └── interpreter.py   # AI 解读（DashScope）
├── docs/
│   ├── STATUS.md         # 当前开发状态（频繁更新）
│   ├── CHANGELOG.md      # 迭代记录（只追加）
│   ├── DEBT.md           # 技术债务（中等频率更新）
│   └── 用户手册.md        # 面向用户的产品文档
├── deploy.sh             # 迭代部署脚本
├── next.config.js
└── package.json
```

---

## API 路由

| 方法 | 路径 | 功能 |
|------|------|------|
| POST | `/api/clean/upload` | 上传文件，返回预览、列名、dtype |
| POST | `/api/clean/check-merge` | 检查合并类型（1:1 / 1:N / N:N） |
| POST | `/api/clean/merge-and-clean` | 合并 + 清洗，返回清洗后数据及 Stata do 片段 |
| POST | `/api/analyze/run` | 运行分析，支持多类型同时执行 |
| GET  | `/health` | 健康检查 |

---

## 部署（双环境并行）

平台同时运行在两套独立环境，`git push` 后需分别触发：

### 1. 腾讯云轻量服务器（国内，PM2 + Nginx）
- **项目路径**：`/www/empirical-agent`
- **PM2 进程**：`empirical-api`（后端 :8000）、`empirical-web`（前端 :3000）
- **Nginx**：`/api/*` → :8000，`/*` → :3000
- **迭代更新**：`bash deploy.sh`
- **手动重建前端**：`NEXT_PUBLIC_API_URL=http://服务器IP npm run build && pm2 restart empirical-web`
- **手动重启后端**：`pm2 restart empirical-api`

### 2. Vercel + Railway（国外）
- **前端**：Vercel，托管 Next.js（`vercel.com` 项目设置中配置 `NEXT_PUBLIC_API_URL` 指向 Railway 后端地址）
- **后端**：Railway，托管 FastAPI（`api/` 目录，`api/index.py` 的 Mangum 适配器 + `api/railway.toml` 用于此环境，并非"备用"）
- **自动部署差异（推送分支时需注意）**：
  - Vercel 默认对**每个分支/PR**都自动生成独立预览部署
  - Railway 默认只监听**项目设置中指定的那一个分支**（通常是 `main`），推送其他分支不会触发部署，除非手动在 Railway 控制台为该分支配置独立 environment

---

## 开发约束

### 统计口径与 Stata 对齐（不得破坏）
- 描述统计用 `ddof=1`（样本标准差）
- 相关系数用 `scipy.stats.pearsonr`
- FE 模型**不**添加常数项，否则与 `entity_effects=True` 完全共线
- FE 必须加 `drop_absorbed=True`，否则行业哑变量被吸收时报错而非自动省略
- Hausman 检验内部强制用 `cov_type="unadjusted"`，与用户选择的 SE 类型解耦

### 类别变量与面板索引
- object dtype 的 x 变量自动 `get_dummies(drop_first=True)`（`_expand_categoricals`），等价 Stata `xi:`
- 数值型变量（含 year）**不**自动虚拟化，以连续变量进入
- `entity_var`/`time_var` 从 `all_x_vars` 中自动过滤（已作为面板索引），误选会静默移除
- `cols_needed` 必须去重（`list(dict.fromkeys(...))`），否则重复列名导致 `pd.to_numeric(DataFrame)` 报错

### 数据流关键细节
- 后端返回清洗后数据时，NaN 用 `None`（JSON `null`）而非 `""`，防止分析层 `pd.to_numeric("")` 将整列变 NaN
- `entity_var` 强制 `astype(str).str.strip()`，防止股票代码前导零丢失
- `time_var` 先 `pd.to_numeric`，失败则 `pd.to_datetime().dt.year`，兼容日期字符串
- 面板分析时后端自动补入 `entity_var`/`time_var`，即使用户未在 `variables` 里选

### Session 缓存架构
- 上传 → `session_id`（`u_` 前缀），清洗 → `cleaned_session_id`（`c_` 前缀），分析用后者恢复 DataFrame
- 向后兼容：无 session_id 时仍可传 `data` 字段
- TTL 默认 1 小时，过期需重新上传/清洗

### linearmodels v5.4 兼容
- `PanelOLS.fit()` 不支持 `check_rank` 参数，不要传
- 聚类只能用 `cluster_entity=True` / `cluster_time=True`，不支持任意列

### 本地启动
```bash
# 后端
cd api && uvicorn main:app --reload --port 8000

# 前端
npm run dev   # http://localhost:3000
```

---

## 文档维护规则

每次会话结束前，若本次有代码改动，必须执行：
1. **`docs/CHANGELOG.md`**：追加一条，格式 `## YYYY-MM-DD` + 改动要点
2. **`docs/STATUS.md`**：更新"进行中"和"待办"，已完成的打勾或删除

`docs/DEBT.md` 按需更新：引入新技术债时追加，偿还旧债时标注或删除。
