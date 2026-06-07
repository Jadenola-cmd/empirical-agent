# 开发状态

## 当前状态（main / 生产环境）

平台已上线，核心功能完整可用：
- 数据清洗：多文件上传（CSV/xlsx/dta）、合并、缺失值/异常值处理、批量对数变换、缩尾处理（Winsorize）、列操作、Stata do 生成
- 实证分析：描述统计、相关系数矩阵、OLS/FE/RE 回归、Hausman 检验、面板平衡性检查、调节效应分析、双重差分 DID、AI 解读
- 导出：Excel、Stata do 文件、纯文本
- 用户文档入口 `/docs`：构建期渲染 `docs/用户手册.md`
- Session 缓存架构（2026-06-06 引入，TTL 4 小时），分析阶段不再传输全量数据

> 2026-06-07：`feature/winsorize-did-moderation-panel-balance-docs` 分支已合并到 `main`（缩尾处理、面板平衡性检查、调节效应分析、双重差分 DID、`/docs` 文档入口共 5 项新增功能 + 批量对数变换补勾）。腾讯云需执行 `bash deploy.sh` 上线；Vercel/Railway 会根据各自分支跟踪策略自动构建（详见 `CLAUDE.md` 部署章节）。

## 进行中

暂无。

## 待办

### 计量方法扩展
- [ ] 工具变量（IV / 2SLS）：`linearmodels.iv`
- [ ] Probit / Logit：二元因变量回归
- [ ] 中介效应分析：Baron-Kenny 三步法或 Bootstrap
- [ ] 异质性分析（分组回归 / 子样本检验）：按分组变量（中位数/分位数/类别）拆分样本并排对比，论文中"进一步检验异质性"环节的标配，可复用现有 `run_ols`/`run_panel` + `CompareTable`
- [ ] DID 稳健性检验包：安慰剂检验、剔除特定年份/个体重新估计，补全 DID 结果展示区

### 输出与展示
- [ ] LaTeX 表格导出
- [ ] 图表：散点图、系数图（coefficient plot）

### 工程
- [ ] 分析结果持久化：保存/加载分析配置和结果
- [ ] 大文件流式处理：超过 50MB 分块上传
- [ ] 后端流式响应：长时间计算实时返回进度
