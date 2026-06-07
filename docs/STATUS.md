# 开发状态

## 当前状态（main / 生产环境）

平台已上线，核心功能完整可用：
- 数据清洗：多文件上传（CSV/xlsx/dta）、合并、缺失值/异常值处理、批量对数变换、缩尾处理（Winsorize）、列操作、Stata do 生成
- 实证分析：描述统计、相关系数矩阵、OLS/FE/RE 回归、Hausman 检验、面板平衡性检查、调节效应分析、中介效应分析（Baron-Kenny 三步法）、异质性分析（分组回归对比）、双重差分 DID、AI 解读
- 分析方法卡片按类别分组展示（数据探索 / 主回归分析 / 因果识别 / 机制检验 / 稳健性检验），由 `ANALYSIS_REGISTRY` 配置驱动
- 导出：Excel、Stata do 文件、纯文本
- 用户文档入口 `/docs`：构建期渲染 `docs/用户手册.md`
- Session 缓存架构（2026-06-06 引入，TTL 4 小时），分析阶段不再传输全量数据

> 2026-06-07：完成中介效应分析（Baron-Kenny 三步法）、异质性分析（中位数/三分位/类别分组对比）两项新功能，并将分析方法卡片重构为 `ANALYSIS_REGISTRY` 注册表驱动的分类展示。已推送 `main`，Vercel/Railway 将自动构建；腾讯云暂缓部署，待后续统一执行 `bash deploy.sh`。

## 进行中

- [ ] **腾讯云部署受阻，待 2026-06-08 处理**：在服务器执行 `bash deploy.sh`（内部 `git pull`）时报错——服务器本地 `package.json` 有未提交改动、`package-lock.json` 是未跟踪文件，与远程 `main`（含中介/异质性分析等新功能，commit 至 `1557c38`）冲突，`git pull` 中止（`Your local changes to the following files would be overwritten by merge`）。怀疑是此前在服务器上手动跑过 `npm install` 自动改写/生成所致。处理思路：`git diff package.json` 确认是否为自动生成噪音 → `git checkout -- package.json` 放弃本地改动 → `mv package-lock.json package-lock.json.bak` 备份后腾位置 → 重新 `git pull` / `bash deploy.sh`。

## 待办

### 计量方法扩展
- [ ] 工具变量（IV / 2SLS）：`linearmodels.iv`
- [ ] Probit / Logit：二元因变量回归
- [ ] 中介效应 Bootstrap / Sobel 检验：作为 Baron-Kenny 三步法的补充验证手段
- [ ] DID 稳健性检验包：安慰剂检验、剔除特定年份/个体重新估计，补全 DID 结果展示区

### 输出与展示
- [ ] LaTeX 表格导出
- [ ] 图表：散点图、系数图（coefficient plot）

### 工程
- [ ] 分析结果持久化：保存/加载分析配置和结果
- [ ] 大文件流式处理：超过 50MB 分块上传
- [ ] 后端流式响应：长时间计算实时返回进度
