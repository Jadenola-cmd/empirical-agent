# Empirical Research Platform — CLAUDE.md

论文实证分析平台，目标是让不熟悉 Stata 的用户通过网页完成数据清洗、面板回归等实证分析，输出与 Stata 一致的学术规范结果。

---

## 技术栈

### 前端
- **框架**: Next.js 14（Pages Router）
- **UI**: React 18，单页应用，所有逻辑和样式集中在 `pages/index.js`（inline `<style jsx global>`，无独立 CSS 文件）
- **库**: `xlsx`（Excel 导出），`@vercel/analytics`（用量统计）
- **部署**: 腾讯云轻量服务器（PM2 + Nginx）

### 后端
- **框架**: FastAPI + Uvicorn，Python 3.12
- **统计计算**: `statsmodels`（OLS）、`linearmodels`（面板 FE/RE）、`scipy`（Pearson 相关、卡方分布）
- **数据处理**: `pandas 2.2`、`numpy 1.26`
- **文件解析**: `pandas`（CSV/xlsx）、`pyreadstat`（.dta Stata 文件）；`.xls` 不支持（未装 xlrd）
- **AI 解读**: 阿里云 DashScope API，模型 `deepseek-v4-flash`（需环境变量 `DASHSCOPE_API_KEY`）
- **部署**: 腾讯云轻量服务器（PM2），Railway 配置保留备用

### 环境变量
| 变量 | 用途 |
|------|------|
| `NEXT_PUBLIC_API_URL` | 前端指向的后端地址，默认 `http://localhost:8000` |
| `DASHSCOPE_API_KEY` | DashScope AI 解读接口密钥，缺失时 AI 解读返回提示而不报错 |

---

## 文件结构

```
empirical-agent/
├── pages/
│   ├── index.js          # 整个前端：上传、清洗配置、分析配置、结果展示、导出
│   └── _app.js           # Next.js App 入口，注入 Vercel Analytics
├── api/
│   ├── main.py           # FastAPI 应用入口，注册路由
│   ├── index.py          # Serverless 函数入口（备用，Mangum 适配器）
│   ├── railway.toml      # Railway 部署配置（备用）
│   ├── requirements.txt  # Python 依赖
│   ├── routes/
│   │   ├── clean.py      # /api/clean/* 路由（上传/合并类型检查/合并清洗）
│   │   ├── analyze.py    # /api/analyze/run 路由，调度各类分析
│   │   └── health.py     # /health 健康检查
│   └── services/
│       ├── data_loader.py   # 文件加载（CSV/xlsx/DTA 统一接口）
│       ├── cleaner.py       # 数据合并、清洗逻辑
│       ├── stats.py         # 统计计算核心（描述统计/相关/OLS/面板）
│       └── interpreter.py   # AI 解读（调用 DashScope）
├── deploy.sh             # 迭代部署脚本（服务器使用）
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

## 已完成功能

### 第一层：数据清洗
- **多文件上传**：最多 5 个，支持 `.csv` / `.xlsx` / `.dta`
- **上传进度**：XHR 进度条，显示速度（KB/s）和预计剩余时间；上传完成后显示"服务器解析中…"
- **字段映射**：手动重命名列，解决"股票代码 vs 证券代码"等多文件列名不统一问题
- **合并类型预检查**：自动判断 1:1 / 1:N / N:N，N:N 显示警告
- **合并方式**：inner（取交集）/ left（左连接）/ outer（取并集）/ concat（纵向堆叠）
- **缺失值处理**：删除行 / 均值填充 / 中位数填充 / 前向填充 / 填 0
- **异常值处理**：Z-score 法 / IQR 法，自定义阈值
- **列操作**：删除列、强制文本型（防止股票代码被识别为数字）、对数变换（生成 `ln_xxx`）
- **自动生成 Stata do 文件**（清洗部分）

### 第二层：实证分析
- **描述性统计**：Obs / Mean / SD / Min / Median / Max / Skew / Kurt，与 Stata `summarize` 一致
- **相关系数矩阵**：Pearson，含显著性标注，与 Stata `pwcorr` 一致
- **OLS 回归**：常规 SE / 稳健 SE (HC1) / 聚类 SE，与 Stata `reg` 一致
- **固定效应（FE）**：`PanelOLS(entity_effects=True, drop_absorbed=True)`，不添加常数项，自动做 Hausman 检验，与 Stata `xtreg, fe` 一致
- **随机效应（RE）**：`RandomEffects`，含截距，与 Stata `xtreg, re` 一致
- **时间固定效应**：FE 中可选 `time_effects=True`（双向FE），对应 Stata `xtreg, fe absorb(year)`
- **Hausman 检验**：内部强制用 unadjusted 协方差，独立于用户选择的 SE 类型
- **类别变量自动虚拟化**：object dtype 的 x 变量（如行业代码 `ind`）自动 `get_dummies(drop_first=True)`，等价 Stata `xi:` 前缀；数值型变量（含 `year`）保持连续不展开
- **变量类型徽章**：选择变量时旁边显示 float / int / 日期 / 文本，帮助用户识别变量类型
- **日期列自动处理**：时间变量为日期字符串时自动提取年份
- **共线性检测**：自动剔除完全共线变量（含被个体效应吸收的行业哑变量），行为与 Stata `omit` 一致
- **AI 解读**：调用 DeepSeek，用计量经济学视角解读系数含义和显著性
- **自动生成 Stata do 文件**（分析部分）

### 结果展示
- **并列回归对比表**（CompareTable）：同时选 2+ 个回归模型时自动渲染 esttab 风格对比表，括号内 t值/标准误 可切换
- **变量配置共用**：OLS / FE / RE 共用同一套变量配置，时间固定效应仅对 FE 生效

### 导出
- **Excel (.xlsx)**：各分析结果分 Sheet + "回归对比" Sheet，学术规范格式
- **Stata .do 文件**：清洗 + 分析全流程可复现
- **.txt 纯文本**：结果文本导出

---

## 待开发功能

### 计量方法扩展
- [ ] **双重差分（DID）**：`xtreg` 加交互项，支持平行趋势检验
- [ ] **工具变量（IV / 2SLS）**：`statsmodels.sandbox.regression.gmm` 或 `linearmodels.iv`
- [ ] **Probit / Logit**：二元因变量回归
- [ ] **中介效应分析**：Baron-Kenny 三步法或 Bootstrap
- [ ] **调节效应分析**：交互项回归

### 数据处理
- [ ] **缩尾处理（Winsorize）**：1%/99% 等分位数截断
- [ ] **多列同时对数变换**：批量 `ln_` 操作
- [ ] **面板数据平衡性检查**：识别非平衡面板，提示缺失的个体-时间组合

### 输出与展示
- [ ] **LaTeX 表格导出**：直接输出可粘贴的 `\begin{table}` 代码
- [ ] **图表**：散点图、系数图（coefficient plot）

### 工程
- [ ] **分析结果持久化**：保存 / 加载分析配置和结果
- [ ] **大文件流式处理**：超过 50MB 的文件分块上传和处理
- [ ] **后端流式响应**：长时间计算实时返回进度

---

## 已知问题（待修复）

### 🔴 高优先级
- ~~**`inf`/`nan` JSON 序列化崩溃**~~：已修复。`analyze.py` 返回前通过 `_sanitize()` 递归将 `inf`/`nan` 替换为 `None`。

### 🟡 中优先级
- **服务器 Next.js build 文件丢失**：最近一次部署后前端 `_buildManifest.js` / `_ssgManifest.js` 404，页面无法正常交互。需在服务器手动执行 `NEXT_PUBLIC_API_URL=http://服务器IP npm run build && pm2 restart empirical-web`，原因待查（可能是上次 build 内存不足中断）。

---

## 部署信息（腾讯云轻量服务器）

- **项目路径**：`/www/empirical-agent`
- **PM2 进程**：`empirical-api`（后端 :8000）、`empirical-web`（前端 :3000）
- **Nginx**：80 端口反向代理，`/api/*` → :8000，`/*` → :3000
- **迭代更新**：执行 `bash deploy.sh`（首次需 `echo 'export PUBLIC_IP=服务器IP' >> ~/.bashrc && source ~/.bashrc`）
- **手动重建前端**：`NEXT_PUBLIC_API_URL=http://服务器IP npm run build && pm2 restart empirical-web`
- **手动重启后端**：`pm2 restart empirical-api`

---

## 开发注意事项

### 统计口径与 Stata 对齐
- 描述统计用 `ddof=1`（样本标准差）
- 相关系数用 `scipy.stats.pearsonr`
- FE 模型**不**添加常数项（`sm.add_constant` 只用于 RE），否则与 `entity_effects=True` 完全共线
- FE 必须加 `drop_absorbed=True`，否则行业哑变量被个体效应完全吸收时报错而非自动省略
- Hausman 检验内部重新用 `cov_type="unadjusted"` 拟合，与用户选择的 SE 类型解耦

### 类别变量与面板索引
- object dtype 的 x 变量自动 `get_dummies(drop_first=True)`（`_expand_categoricals`），等价 Stata `xi:`
- 数值型变量（含 year）**不**自动虚拟化，以连续变量进入，行为与 Stata 一致
- `entity_var` 和 `time_var` 会从 `all_x_vars` 中自动过滤（它们已作为面板索引），若用户误选会静默移除而非报错
- `cols_needed` 必须去重（`list(dict.fromkeys(...))`），否则重复列名导致 `sub[col]` 返回 DataFrame，`pd.to_numeric(DataFrame)` 报 `arg must be a list…`

### 数据流关键细节
- 后端返回清洗后数据时，数值列 NaN 用 `None`（JSON `null`）而非 `""`；前端预览用 `""` 展示，但 `data` 字段用 `_df_to_json_records()` 保留 `None`，避免分析层 `pd.to_numeric("")` 将整列变成 NaN
- `entity_var` 强制转为字符串（`astype(str).str.strip()`），防止股票代码前导零丢失
- `time_var` 先尝试 `pd.to_numeric`，失败则 `pd.to_datetime().dt.year`，兼容日期字符串格式
- 面板分析时，即使用户在 `variables` 里未选 `entity_var`/`time_var`，后端也自动补入（`analyze.py`）

### linearmodels 版本兼容（v5.4）
- `PanelOLS.fit()` 不支持 `check_rank` 参数（v5.x 已移除），不要传
- `cluster_var` 只能对 `entity_var` 或 `time_var` 聚类（`cluster_entity=True` / `cluster_time=True`），不支持任意列

### 本地启动
```bash
# 后端
cd api
pip install -r requirements.txt
uvicorn main:app --reload --port 8000

# 前端
npm install
npm run dev          # http://localhost:3000
```
