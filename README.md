# 论文实证分析 Agent

基于 Next.js + Google Gemini 的学术实证分析工具。

## 部署步骤

### 1. 上传到 GitHub
1. 登录 github.com
2. 点右上角 "+" → "New repository"
3. 填写名称（如 empirical-agent），点 Create
4. 把这个文件夹里所有文件上传上去

### 2. 部署到 Vercel
1. 登录 vercel.com（用 GitHub 账号）
2. 点 "Add New Project" → 选择你的 GitHub 仓库
3. 在 "Environment Variables" 里添加：
   - Key: GEMINI_API_KEY
   - Value: 你的 Gemini API Key
4. 点 Deploy

部署完成后你会得到一个网址，可以直接分享给别人使用。

## 本地运行（测试用）
```bash
npm install
# 新建 .env.local 文件，写入：GEMINI_API_KEY=你的key
npm run dev
```
