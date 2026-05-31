# Next.js + Python 架构迁移方案

---

## 1️⃣ 核心架构原则

### 1.1 各层职责定位

```
┌─────────────────────────────────────────────────────┐
│                        用户浏览器                    │
│              (访问方式完全不变)                      │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS
                       ▼
┌─────────────────────────────────────────────────────┐
│              Next.js (Vercel Frontend)               │
│  ┌────────────────────────────────────────────────┐ │
│  │  职责划分：                                      │ │
│  │  ✅ 数据上传UI (支持CSV/DTA)                     │ │
│  │  ✅ JSON渲染组件                                 │ │
│  │  ✅ 用户交互逻辑                                 │ │
│  │  ❌ 统计计算 (移除)                             │ │
│  │  ❌ AI生成结果 (仅解读)                          │ │
│  │  ❌ 手写矩阵运算 (移除)                          │ │
│  └────────────────────────────────────────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ POST multipart/form-data
                       ▼
┌─────────────────────────────────────────────────────┐
│                     Python API                       │
│              (独立Vercel部署)                        │
│  ┌────────────────────────────────────────────────┐ │
│  │  Flask Web框架                                  │ │
│  │  @app.route('/api/stats', methods=['POST'])     │ │
│  └────────────────────────────────────────────────┘ │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ │
│  │  数据读取层   │ │  统计计算层  │ │  AI解读层    │ │
│  │  pandas      │ │  statsmodels │ │  通义千问    │ │
│  │  pyreadstat │ │  linearmodels│ │             │ │
│  └──────────────┘ └──────────────┘ └──────────────┘ │
└──────────────────────┬──────────────────────────────┘
                       │ JSON响应
                       ▼
┌─────────────────────────────────────────────────────┐
│              Next.js 渲染层                          │
│              (纯展示，不做任何计算)                   │
└─────────────────────────────────────────────────────┘
```

### 1.2 技术选型依据

| 组件 | 技术 | 选择理由 |
|------|------|---------|
| 前端框架 | Next.js (保持不变) | 用户访问方式不变 |
| Python框架 | **Flask** | 轻量级、成熟稳定、Vercel官方支持 |
| OLS实现 | **statsmodels** | 学术标准、与Stata结果一致 |
| FE/RE实现 | **linearmodels** | 专为面板数据设计、Stata兼容 |
| 数据读取 | **pandas + pyreadstat** | 统一API、支持DTA |
| AI服务 | 通义千问 (保持不变) | 仅做结果解读，不做计算 |

---

## 2️⃣ 最终目录结构

```
empirical-analysis/
│
├── 📁 frontend/                    # Next.js前端（当前项目）
│   │
│   ├── 📁 pages/
│   │   ├── 📄 index.js            # 主页面（重构后仅渲染+上传）
│   │   ├── 📄 _app.js
│   │   └── 📄 _document.js
│   │
│   ├── 📁 components/              # UI组件（新增）
│   │   ├── 📄 DataUploader.jsx    # 统一文件上传组件
│   │   ├── 📄 RegressionTable.jsx # 回归结果表格
│   │   ├── 📄 DescriptiveTable.jsx # 描述性统计表格
│   │   ├── 📄 CorrelationHeatmap.jsx
│   │   └── 📄 ResultRenderer.jsx  # JSON渲染器
│   │
│   ├── 📁 styles/
│   │   └── 📄 globals.css
│   │
│   ├── 📁 lib/                     # 保留前端辅助代码
│   │   ├── 📄 csv-parser.js       # 仅CSV解析（前端预览用）
│   │   ├── 📄 json-schema.js      # JSON Schema验证
│   │   └── 📄 formatters.js       # 数字格式化
│   │
│   ├── 📄 package.json
│   ├── 📄 next.config.js
│   └── 📄 vercel.json             # Next.js部署配置
│
│
├── 📁 api/                        # Python API（新建）
│   │
│   ├── 📄 app.py                  # Flask应用入口
│   ├── 📄 config.py               # 配置管理
│   │
│   ├── 📁 routes/                 # 路由模块
│   │   ├── 📄 __init__.py
│   │   ├── 📄 stats.py           # 统计计算路由
│   │   ├── 📄 upload.py          # 文件上传路由
│   │   └── 📄 health.py           # 健康检查
│   │
│   ├── 📁 services/               # 业务逻辑层
│   │   ├── 📄 __init__.py
│   │   ├── 📄 data_loader.py     # 数据读取服务
│   │   ├── 📄 regression.py       # 回归分析服务
│   │   ├── 📄 descriptive.py     # 描述性统计服务
│   │   ├── 📄 correlation.py      # 相关性分析服务
│   │   └── 📄 ai_interpreter.py  # AI解读服务
│   │
│   ├── 📁 models/                 # 数据模型层
│   │   ├── 📄 __init__.py
│   │   ├── 📄 schemas.py          # Pydantic数据模型
│   │   └── 📄 responses.py        # 统一响应模型
│   │
│   ├── 📁 utils/                  # 工具函数
│   │   ├── 📄 __init__.py
│   │   ├── 📄 validators.py       # 输入验证
│   │   ├── 📄 formatters.py       # 输出格式化
│   │   └── 📄 exceptions.py       # 自定义异常
│   │
│   ├── 📁 tests/                  # 测试
│   │   ├── 📄 test_regression.py
│   │   ├── 📄 test_stata_compare.py  # Stata对照测试
│   │   └── 📄 fixtures/           # 测试数据
│   │       ├── 📄 auto.dta
│   │       └── 📄 auto_stata.log  # Stata标准输出
│   │
│   ├── 📄 requirements.txt        # Python依赖
│   ├── 📄 vercel.json            # Python API部署配置
│   ├── 📄 .env.example           # 环境变量示例
│   └── 📄 README.md
│
│
├── 📄 package.json                # 根目录workspace配置
└── 📄 README.md
```

### 2.1 关键文件说明

#### 前端 (frontend/)

| 文件 | 职责 | 重要程度 |
|------|------|---------|
| `pages/index.js` | 主页面，接收文件上传，调用Python API | P0 |
| `components/DataUploader.jsx` | 统一上传组件，支持CSV/DTA | P0 |
| `components/RegressionTable.jsx` | 渲染回归结果JSON | P0 |
| `components/ResultRenderer.jsx` | 通用JSON渲染器 | P1 |
| `lib/csv-parser.js` | 仅用于文件预览，不做统计计算 | P2 |

#### Python API (api/)

| 文件 | 职责 | 重要程度 |
|------|------|---------|
| `app.py` | Flask入口，注册路由 | P0 |
| `services/data_loader.py` | 统一数据读取接口 | P0 |
| `services/regression.py` | OLS/FE/RE计算 | P0 |
| `services/ai_interpreter.py` | AI解读 | P1 |
| `models/schemas.py` | 输入输出Schema定义 | P0 |
| `tests/test_stata_compare.py` | Stata一致性验证 | P0 |

---

## 3️⃣ 数据流图（迁移后）

### 3.1 完整数据流

```
┌─────────────────────────────────────────────────────────────────────┐
│                        用户交互层                                    │
│                                                                      │
│   1. 用户打开页面 https://your-app.vercel.app                     │
│      ↓                                                              │
│   2. Next.js 返回上传页面                                            │
│      ↓                                                              │
│   3. 用户选择文件 (支持 .csv / .dta)                                │
│      ↓                                                              │
│   4. 前端进行基础验证 (文件大小、格式)                               │
│      ↓                                                              │
│   5. 用户点击"上传分析"                                              │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼ multipart/form-data
┌─────────────────────────────────────────────────────────────────────┐
│                      Next.js 接收层                                  │
│                                                                      │
│   6. pages/index.js 接收 multipart 请求                             │
│      ↓                                                              │
│   7. 将文件二进制流传给 Python API                                   │
│      ↓                                                              │
│      POST https://api-xxx.vercel.app/api/stats                    │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     Python API 处理层                                │
│                                                                      │
│   ┌────────────────────────────────────────────────────────────────┐ │
│   │  app.py (Flask)                                                │ │
│   │  @app.route('/api/stats', methods=['POST'])                   │ │
│   └────────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│   ┌──────────────────────────┴──────────────────────────────────────┐ │
│   │                    services/data_loader.py                     │ │
│   │                                                                 │ │
│   │   8. 检测文件类型                                               │ │
│   │      ├─ .csv → pandas.read_csv()                               │ │
│   │      └─ .dta → pyreadstat.read_dta()                          │ │
│   │                                                                 │ │
│   │   9. 返回统一 DataFrame                                        │ │
│   └────────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│   ┌──────────────────────────┴──────────────────────────────────────┐ │
│   │                    services/regression.py                       │ │
│   │                                                                 │ │
│   │   10. 根据analysis_type选择计算方法                             │ │
│   │                                                                 │ │
│   │      ┌─────────────────────────────────────────────────────┐   │ │
│   │      │                    OLS 回归                          │   │ │
│   │      │                                                     │   │ │
│   │      │   import statsmodels.api as sm                      │   │ │
│   │      │   model = sm.OLS(y, X)                             │   │ │
│   │      │   results = model.fit()                            │   │ │
│   │      └─────────────────────────────────────────────────────┘   │ │
│   │                                                                 │ │
│   │      ┌─────────────────────────────────────────────────────┐   │ │
│   │      │                 固定效应模型 (FE)                     │   │ │
│   │      │                                                     │   │ │
│   │      │   from linearmodels.panel import PanelOLS           │   │ │
│   │      │   model = PanelOLS.from_formula('y ~ 1 + x1 + x2' │   │ │
│   │      │               + ' + EntityEffects')               │   │ │
│   │      └─────────────────────────────────────────────────────┘   │ │
│   └────────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│   ┌──────────────────────────┴──────────────────────────────────────┐ │
│   │                 services/ai_interpreter.py                      │ │
│   │                                                                 │ │
│   │   11. 如果需要AI解读（用户勾选）                                  │ │
│   │      └─> 调用通义千问API，仅解读结果                              │ │
│   └────────────────────────────────────────────────────────────────┘ │
│                              │                                       │
│   ┌──────────────────────────┴──────────────────────────────────────┐ │
│   │                    models/schemas.py                            │ │
│   │                                                                 │ │
│   │   12. 格式化为统一JSON Schema                                    │ │
│   └────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    统一JSON响应                                      │
│                    (包含: results + interpretation + metadata)      │
└──────────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────────────┐
│                   Next.js 渲染层                                     │
│                                                                      │
│   13. 调用ResultRenderer组件，根据analysis_type渲染                  │
│      ├─> regression → RegressionTable.jsx                         │
│      ├─> descriptive → DescriptiveTable.jsx                       │
│      └─> correlation → CorrelationHeatmap.jsx                     │
│      ↓                                                              │
│   14. 用户查看结果，可导出/复制                                      │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 数据流关键路径

```
文件上传路径:
  浏览器 → Next.js (中转) → Python API → pandas/pyreadstat → DataFrame
                                                        ↓
统计计算路径:
  DataFrame → statsmodels.linearmodels → 计算结果 → 统一JSON
                                                        ↓
结果展示路径:
  JSON → Next.js → ResultRenderer → HTML/DOM
```

---

## 4️⃣ 统一JSON Schema设计

### 4.1 顶层响应结构

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "StatsAPI Response",
  "type": "object",
  "required": ["success", "analysis_type", "results", "metadata"],
  "properties": {
    "success": {
      "type": "boolean",
      "description": "请求是否成功"
    },
    "analysis_type": {
      "type": "string",
      "enum": ["regression", "descriptive", "correlation", "panel"],
      "description": "分析类型"
    },
    "results": {
      "oneOf": [
        { "$ref": "#/definitions/RegressionResults" },
        { "$ref": "#/definitions/DescriptiveResults" },
        { "$ref": "#/definitions/CorrelationResults" },
        { "$ref": "#/definitions/PanelResults" }
      ]
    },
    "interpretation": {
      "$ref": "#/definitions/AIInterpretation",
      "description": "AI解读结果（可选）"
    },
    "metadata": {
      "$ref": "#/definitions/ResponseMetadata"
    },
    "error": {
      "$ref": "#/definitions/ErrorInfo",
      "description": "错误信息（仅success=false时存在）"
    }
  }
}
```

### 4.2 回归结果 Schema

```json
{
  "definitions": {
    "RegressionResults": {
      "type": "object",
      "required": ["models", "summary"],
      "properties": {
        "models": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "dependent_var", "coefficients", "statistics"],
            "properties": {
              "name": {
                "type": "string",
                "example": "模型1"
              },
              "model_type": {
                "type": "string",
                "enum": ["ols", "fe", "re", "re_fe_compare"],
                "description": "模型类型"
              },
              "dependent_var": {
                "type": "string",
                "example": "price"
              },
              "independent_vars": {
                "type": "array",
                "items": { "type": "string" },
                "example": ["mpg", "weight", "length"]
              },
              "coefficients": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["variable", "coef", "std_error", "t_stat", "p_value"],
                  "properties": {
                    "variable": {
                      "type": "string",
                      "description": "变量名，const表示截距项"
                    },
                    "coef": {
                      "type": "number",
                      "description": "回归系数"
                    },
                    "std_error": {
                      "type": "number",
                      "description": "标准误"
                    },
                    "t_stat": {
                      "type": "number",
                      "description": "t统计量"
                    },
                    "p_value": {
                      "type": "number",
                      "description": "p值"
                    },
                    "conf_int_lower": {
                      "type": "number",
                      "description": "95%置信区间下限"
                    },
                    "conf_int_upper": {
                      "type": "number",
                      "description": "95%置信区间上限"
                    },
                    "significance": {
                      "type": "string",
                      "enum": ["***", "**", "*", ""],
                      "description": "显著性标记"
                    }
                  }
                }
              },
              "statistics": {
                "type": "object",
                "required": ["n_obs", "r_squared", "adj_r_squared", "f_statistic"],
                "properties": {
                  "n_obs": {
                    "type": "integer",
                    "description": "观测值数量"
                  },
                  "r_squared": {
                    "type": "number",
                    "description": "R²"
                  },
                  "adj_r_squared": {
                    "type": "number",
                    "description": "调整R²"
                  },
                  "f_statistic": {
                    "type": "number",
                    "description": "F统计量"
                  },
                  "f_pvalue": {
                    "type": "number",
                    "description": "F检验p值"
                  },
                  "df_model": {
                    "type": "integer",
                    "description": "模型自由度"
                  },
                  "df_resid": {
                    "type": "integer",
                    "description": "残差自由度"
                  },
                  "cov_type": {
                    "type": "string",
                    "enum": ["conventional", "robust", "clustered"],
                    "description": "标准误类型"
                  },
                  "cluster_var": {
                    "type": "string",
                    "description": "聚类变量（如果使用聚类标准误）"
                  }
                }
              }
            }
          }
        },
        "summary": {
          "type": "object",
          "properties": {
            "best_model": {
              "type": "string",
              "description": "最优模型名称"
            },
            "hausman_test": {
              "type": "object",
              "properties": {
                "statistic": { "type": "number" },
                "p_value": { "type": "number" },
                "conclusion": { "type": "string" }
              }
            }
          }
        }
      }
    }
  }
}
```

### 4.3 描述性统计 Schema

```json
{
  "definitions": {
    "DescriptiveResults": {
      "type": "object",
      "required": ["variables", "statistics"],
      "properties": {
        "variables": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["name", "type", "n", "mean", "sd", "min", "max"],
            "properties": {
              "name": {
                "type": "string",
                "description": "变量名"
              },
              "type": {
                "type": "string",
                "enum": ["numeric", "categorical", "date"],
                "description": "变量类型"
              },
              "n": {
                "type": "integer",
                "description": "非缺失观测数"
              },
              "n_missing": {
                "type": "integer",
                "description": "缺失值数量"
              },
              "mean": {
                "type": "number",
                "description": "均值"
              },
              "sd": {
                "type": "number",
                "description": "标准差（样本标准差，ddof=1）"
              },
              "min": {
                "type": "number",
                "description": "最小值"
              },
              "p25": {
                "type": "number",
                "description": "25%分位数"
              },
              "median": {
                "type": "number",
                "description": "中位数"
              },
              "p75": {
                "type": "number",
                "description": "75%分位数"
              },
              "max": {
                "type": "number",
                "description": "最大值"
              },
              "skewness": {
                "type": "number",
                "description": "偏度"
              },
              "kurtosis": {
                "type": "number",
                "description": "峰度"
              }
            }
          }
        }
      }
    }
  }
}
```

### 4.4 相关系数矩阵 Schema

```json
{
  "definitions": {
    "CorrelationResults": {
      "type": "object",
      "required": ["variables", "matrix", "method"],
      "properties": {
        "variables": {
          "type": "array",
          "items": { "type": "string" }
        },
        "method": {
          "type": "string",
          "enum": ["pearson", "spearman", "kendall"]
        },
        "matrix": {
          "type": "array",
          "items": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "coef": {
                  "type": "number",
                  "description": "相关系数"
                },
                "p_value": {
                  "type": "number",
                  "description": "显著性检验p值"
                },
                "n": {
                  "type": "integer",
                  "description": "用于计算的有效观测数"
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### 4.5 AI解读结果 Schema

```json
{
  "definitions": {
    "AIInterpretation": {
      "type": "object",
      "required": ["summary", "findings"],
      "properties": {
        "summary": {
          "type": "string",
          "description": "结果摘要（1-2句话）"
        },
        "findings": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "topic": {
                "type": "string",
                "description": "发现主题"
              },
              "content": {
                "type": "string",
                "description": "详细解读"
              },
              "significance_level": {
                "type": "string",
                "enum": ["high", "medium", "low"]
              }
            }
          }
        },
        "recommendations": {
          "type": "array",
          "items": { "type": "string" },
          "description": "建议（可选）"
        },
        "limitations": {
          "type": "array",
          "items": { "type": "string" },
          "description": "研究局限性（可选）"
        }
      }
    }
  }
}
```

### 4.6 元信息 Schema

```json
{
  "definitions": {
    "ResponseMetadata": {
      "type": "object",
      "required": ["request_id", "processing_time_ms", "data_info"],
      "properties": {
        "request_id": {
          "type": "string",
          "format": "uuid",
          "description": "请求唯一标识"
        },
        "processing_time_ms": {
          "type": "integer",
          "description": "服务端处理时间（毫秒）"
        },
        "data_info": {
          "type": "object",
          "properties": {
            "file_name": { "type": "string" },
            "file_type": { "type": "string" },
            "total_rows": { "type": "integer" },
            "total_columns": { "type": "integer" },
            "used_rows": { "type": "integer" },
            "used_columns": { "type": "integer" }
          }
        },
        "model_info": {
          "type": "object",
          "properties": {
            "python_version": { "type": "string" },
            "statsmodels_version": { "type": "string" },
            "linearmodels_version": { "type": "string" }
          }
        },
        "timestamp": {
          "type": "string",
          "format": "date-time"
        }
      }
    }
  }
}
```

---

## 5️⃣ API端点设计

### 5.1 路由总览

```
POST /api/stats              # 主分析入口（统一路由）
POST /api/stats/regression   # 专门回归接口
POST /api/stats/descriptive  # 专门描述性统计接口
POST /api/stats/correlation  # 专门相关性分析接口
GET  /api/health             # 健康检查
```

### 5.2 主分析接口

```
POST /api/stats

Content-Type: multipart/form-data

请求参数:
- file: binary (必需) - CSV或DTA文件
- analysis_type: string (必需) - regression|descriptive|correlation|panel
- options: JSON string (可选) - 分析选项

analysis_type=regression时额外参数:
- dep_var: string (必需) - 因变量
- indep_vars: JSON array (必需) - 自变量列表
- model_type: string (可选, 默认=ols) - ols|fe|re|re_fe_compare
- robust_se: boolean (可选, 默认=false) - 是否使用稳健标准误
- cluster_var: string (可选) - 聚类变量名

analysis_type=descriptive时额外参数:
- variables: JSON array (可选, 默认=全部数值变量) - 要分析的变量
- detail: boolean (可选, 默认=false) - 是否包含详细统计量

analysis_type=correlation时额外参数:
- variables: JSON array (可选) - 要分析的变量
- method: string (可选, 默认=pearson) - pearson|spearman|kendall

通用参数:
- interpret: boolean (可选, 默认=false) - 是否需要AI解读
- custom_question: string (可选) - 用户自定义问题

响应: 统一JSON Schema
```

### 5.3 Flask路由设计（结构示意）

```python
# api/app.py (结构示意)

from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route('/api/stats', methods=['POST'])
def stats_handler():
    """统一分析入口"""
    # 实现...
```

---

## 6️⃣ 与Stata结果一致性验证方案

### 6.1 验证目标

确保Python实现与Stata的输出**数值完全一致**（浮点误差 < 1e-6）

### 6.2 测试数据准备

#### 数据集1: Stata内置auto数据集

```stata
* Stata命令：导出标准输出
sysuse auto, clear
regress price mpg weight length
estimates store ols1

* 导出回归结果
esttab ols1 using auto_ols_results.txt, se r2 replace
```

预期产出：
- `auto.dta` - 测试数据文件
- `auto_stata_ols.log` - Stata标准输出
- `auto_stata_ols_coefficients.json` - 系数对比文件

### 6.3 验证矩阵

| 测试用例 | Stata命令 | Python函数 | 验收标准 |
|---------|-----------|-----------|---------|
| OLS基础 | `regress y x1 x2` | `sm.OLS().fit()` | 系数差异 < 1e-6 |
| OLS+稳健SE | `regress y x1 x2, robust` | `sm.OLS().fit(cov_type='HC1')` | SE差异 < 1e-6 |
| OLS+聚类SE | `regress y x1 x2, cluster(id)` | `sm.OLS().fit(cov_type='clustered')` | 聚类SE差异 < 1e-6 |
| FE固定效应 | `xtreg y x1 x2, fe` | `PanelOLS(effects='entity')` | 系数差异 < 1e-6 |
| RE随机效应 | `xtreg y x1 x2, re` | `RandomEffects()` | 系数差异 < 1e-6 |
| Hausman检验 | `hausman fe1 re1` | 内置`spec_hashman()` | 统计量差异 < 1e-6 |
| 描述性统计 | `summarize, detail` | `describe()` | 所有统计量差异 < 1e-6 |
| 相关系数 | `pwcorr, sig` | `corr()` | 相关系数差异 < 1e-6 |

### 6.4 自动化验证流程

```
┌──────────────────────────────────────────────────────────────────┐
│                        自动化验证流程                              │
│                                                                  │
│  1. 读取测试fixtures → auto.dta + auto_stata_results.json      │
│  2. Python执行分析: result = regression.ols(...)              │
│  3. 逐项对比: assert_allclose(python_coef, stata_coef, 1e-6)  │
│  4. 输出对比报告: PASSED / FAILED + 差异详情                    │
└──────────────────────────────────────────────────────────────────┘
```

### 6.5 pytest测试框架（结构示意）

```python
# api/tests/test_stata_compare.py (结构示意)

class TestStataConsistency:
    """与Stata结果一致性测试"""

    @pytest.fixture
    def auto_data(self):
        """加载auto测试数据"""
        return data_loader.load('fixtures/auto.dta')

    @pytest.fixture
    def stata_results(self):
        """加载Stata标准结果"""
        return json.load(open('fixtures/auto_stata_ols.json'))

    def test_ols_coefficients(self, auto_data, stata_results):
        """测试OLS系数与Stata一致"""
        result = regression.ols(auto_data, 'price', ['mpg', 'weight'])
        # 逐变量对比...
```

### 6.6 关键配置对照表

| 参数 | Stata | Python (statsmodels/linearmodels) | 注意事项 |
|------|-------|-----------------------------------|---------|
| 常数项 | 自动添加 | `sm.add_constant(X)` | 必须显式添加 |
| 标准误类型 | 默认conventional | 默认conventional | 一致 |
| 样本标准差 | `sd` (ddof=1) | `std(ddof=1)` | **ddof必须为1** |
| 聚类SE | `cluster(var)` | `cov_type='clustered'` | 分组数>1 |
| FE模型 | `xtreg, fe` | `PanelOLS(effects='entity')` | 需要设置entity effect |
| RE模型 | `xtreg, re` | `RandomEffects()` | 随机效应假设 |

---

## 7️⃣ 部署架构

### 7.1 Vercel多服务部署

```
┌────────────────────────────────────────────────────────────────┐
│                         Vercel                                  │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              frontend.vercel.app                          │  │
│  │               (Next.js)                                  │  │
│  │                                                          │  │
│  │  域名: https://your-app.vercel.app                     │  │
│  │  职责: 静态页面 + 用户交互 + JSON渲染                    │  │
│  └──────────────────────────────────────────────────────────┘  │
│                            │                                   │
│                            │ API调用                           │
│                            ▼                                   │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │              api-xxx.vercel.app                          │  │
│  │               (Flask/Python)                             │  │
│  │                                                          │  │
│  │  域名: https://api-xxx.vercel.app                       │  │
│  │  职责: 数据处理 + 统计计算 + AI解读                      │  │
│  │                                                          │  │
│  │  配置:                                                   │  │
│  │  - Memory: 1024 MB                                      │  │
│  │  - Max Duration: 60s                                    │  │
│  │  - Python: 3.11                                         │  │
│  └──────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────┘
```

### 7.2 环境变量配置

```bash
# frontend/.env.local
NEXT_PUBLIC_API_URL=https://api-xxx.vercel.app/api

# api/.env (不提交)
DASHSCOPE_API_KEY=sk-xxxx
API_SECRET_KEY=xxx
```

---

## 8️⃣ 迁移检查清单

### Phase 1: 架构搭建 (Day 1-2)

- [ ] 创建项目目录结构
- [ ] 配置Python虚拟环境
- [ ] 安装依赖 (statsmodels, linearmodels, pyreadstat, flask)
- [ ] 搭建Flask基础框架
- [ ] 配置Vercel Python部署

### Phase 2: 核心功能 (Day 3-5)

- [ ] 实现数据加载服务 (pandas + pyreadstat)
- [ ] 实现OLS回归 (statsmodels)
- [ ] 实现固定效应模型 (linearmodels)
- [ ] 实现随机效应模型 (linearmodels)
- [ ] 实现Hausman检验
- [ ] 定义统一JSON Schema

### Phase 3: 扩展功能 (Day 6-7)

- [ ] 实现描述性统计
- [ ] 实现相关性分析
- [ ] 集成AI解读服务
- [ ] 添加错误处理和日志

### Phase 4: 测试验证 (Day 8-9)

- [ ] 准备Stata测试数据
- [ ] 运行一致性验证测试
- [ ] 修复发现的差异
- [ ] 性能测试

### Phase 5: 前端集成 (Day 10-12)

- [ ] 重构Next.js上传组件
- [ ] 开发JSON渲染组件
- [ ] 对接Python API
- [ ] 端到端测试

### Phase 6: 部署上线 (Day 13-14)

- [ ] 部署Python API到Vercel
- [ ] 部署Next.js前端
- [ ] 配置环境变量
- [ ] 生产环境测试
- [ ] 监控和日志配置

---

## 9️⃣ 架构优势总结

| 优势 | 说明 |
|------|------|
| **职责清晰** | 前端只做展示，Python只做计算 |
| **技术成熟** | statsmodels/linearmodels是学术标准 |
| **结果可靠** | 与Stata完全一致（可验证） |
| **扩展性强** | 易于添加新的统计方法 |
| **部署灵活** | 可以独立扩展API服务 |
| **DTA支持** | 原生支持Stata文件格式 |
| **用户无感知** | 访问方式完全不变 |

---

## 🔟 待确认事项

1. **API域名**: 是否需要自定义域名？
2. **文件大小限制**: 当前Vercel限制25MB，Python函数限制100MB，是否满足需求？
3. **并发限制**: 是否需要限流？
4. **数据持久化**: 是否需要存储上传的文件？
