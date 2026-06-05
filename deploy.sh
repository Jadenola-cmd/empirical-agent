#!/bin/bash

# ═══════════════════════════════════════════════
# 迭代部署脚本 — empirical-agent
# 用法：bash deploy.sh
# ═══════════════════════════════════════════════

# ── 按服务器情况修改这一行 ─────────────────────
APP_DIR="/www/empirical-agent"
# PUBLIC_IP 从环境变量读取，首次使用请在服务器执行：
#   echo 'export PUBLIC_IP=你的公网IP' >> ~/.bashrc && source ~/.bashrc
PUBLIC_IP="${PUBLIC_IP:?'请先设置环境变量 PUBLIC_IP，执行：echo export PUBLIC_IP=你的公网IP >> ~/.bashrc && source ~/.bashrc'}"
# ──────────────────────────────────────────────

PYTHON_VENV="$APP_DIR/api/venv/bin"

set -e

echo ""
echo "══════════════════════════════════════"
echo "  部署开始  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════"

cd "$APP_DIR"

# ── 1. 拉取代码 ────────────────────────────────
echo ""
echo "▶ [1/4] 拉取最新代码..."
git pull

# ── 2. 判断变更范围 ────────────────────────────
CHANGED=$(git diff HEAD@{1} HEAD --name-only 2>/dev/null || echo "unknown")

has_change() { echo "$CHANGED" | grep -qE "$1" 2>/dev/null; }

BACKEND_CHANGED=false
FRONTEND_CHANGED=false
DEPS_CHANGED=false

has_change "^api/"            && BACKEND_CHANGED=true
has_change "api/requirements" && DEPS_CHANGED=true
has_change "^pages/|^components/|^public/|next\.config|^package\.json" && FRONTEND_CHANGED=true

# 第一次拉取或无法获取变更时，全量部署
if [ "$CHANGED" = "unknown" ]; then
    BACKEND_CHANGED=true
    FRONTEND_CHANGED=true
fi

echo "   后端变更：$BACKEND_CHANGED  |  前端变更：$FRONTEND_CHANGED"

# ── 3. Python 依赖（仅 requirements.txt 有变动）──
echo ""
echo "▶ [2/4] 检查 Python 依赖..."
if $DEPS_CHANGED; then
    echo "   requirements.txt 有更新，安装新依赖..."
    source "$PYTHON_VENV/activate"
    pip install -r "$APP_DIR/api/requirements.txt" -q
    deactivate
else
    echo "   依赖无变化，跳过"
fi

# ── 4. 前端构建 ────────────────────────────────
echo ""
echo "▶ [3/4] 构建前端..."
if $FRONTEND_CHANGED; then
    echo "   检测到前端变更，开始构建..."
    NEXT_PUBLIC_API_URL="http://$PUBLIC_IP" npm run build
else
    echo "   前端无变化，跳过构建"
fi

# ── 5. 重启服务 ────────────────────────────────
echo ""
echo "▶ [4/4] 重启服务..."

if ! $BACKEND_CHANGED && ! $FRONTEND_CHANGED; then
    echo "   无变更，无需重启"
else
    $BACKEND_CHANGED  && { echo "   重启后端...";  pm2 restart empirical-api;      }
    $FRONTEND_CHANGED && { echo "   重启前端...";  pm2 restart empirical-frontend;  }
fi

echo ""
echo "══════════════════════════════════════"
echo "  部署完成 ✓  $(date '+%Y-%m-%d %H:%M:%S')"
echo "══════════════════════════════════════"
echo ""
pm2 list
