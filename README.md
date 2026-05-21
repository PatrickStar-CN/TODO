# 待办事项管理工具（TODO Tools）

一个基于原生前端技术构建的轻量级待办事项管理应用，支持 Web 浏览器和 Windows 桌面应用两种运行模式。使用 Vite 构建，Neutralinojs 打包桌面应用，无前端框架依赖。

## 功能特性

- **任务管理**：快速添加、编辑、删除任务，标记完成/取消完成，按优先级排序
- **重要标记**：将任务标记为重要（星标），支持重要视图筛选
- **视图分类**：TODO（默认）、重要、所有任务、日历视图
- **标签系统**：自定义标签，按标签筛选，标签管理面板
- **日历视图**：紧凑月历网格，日期任务指示点，点击查看当天任务
- **详情面板**：编辑标题、备注、优先级、标签、开始/截止时间
- **侧边栏折叠**：可折叠为迷你侧边栏（仅图标），状态持久化，带过渡动画
- **迷你模式**：窗口缩小为置顶小卡片，显示待办列表，支持快速添加和完成任务
- **快速添加预设**：日期、优先级、标签预设弹窗
- **动画系统**：完整的入场/退场/微交互动画
- **已完成区域**：可折叠/展开，展开后内部滚动，不超出窗口
- **主题切换**：支持自动/亮色/暗色主题
- **桌面特性**：系统托盘、关闭隐藏到托盘、本地文件持久化

## 技术栈

| 层面 | 技术 |
|------|------|
| 前端构建 | Vite 6.x |
| 桌面框架 | Neutralinojs 6.7.0 |
| 语言 | 原生 JavaScript (ES Module) |
| 样式 | 原生 CSS（暗色主题） |
| 数据存储 | JSON 文件 + localStorage 降级 |

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器（浏览器模式）
npm run dev

# 构建生产版本
npm run build

# 以桌面窗口运行
npm run neu:run

# 打包为桌面应用
npm run neu:build
```

## 项目结构

```
todoTools/
├── index.html                  # 主 HTML 入口
├── package.json                # 项目配置
├── neutralino.config.json      # 桌面应用配置
├── vite.config.js              # Vite 构建配置
├── server-plugin.js            # 开发服务器数据 API 插件
├── .gitignore                  # Git 忽略规则
├── src/
│   ├── main.js                 # 应用入口（Neutralino 初始化 + 托盘）
│   ├── app.js                  # 核心业务逻辑
│   └── style.css               # 全局样式 + 动画系统
├── public/
│   ├── neutralino.js           # Neutralino 客户端库
│   └── icon.png                # 应用图标
└── dist/                       # 构建产物
    └── todo-tools/
        ├── todo-tools-win_x64.exe
        └── resources.neu
```

## 数据持久化

三层降级机制：

1. **桌面环境**：通过 Neutralino filesystem API 读写本地 `todo_data.json`
2. **开发环境**：通过 Vite 插件 `/api/data` 接口读写 `data.json`
3. **降级方案**：浏览器 `localStorage`

## 数据模型

```json
{
  "todos": [
    {
      "id": "唯一标识",
      "title": "任务标题",
      "desc": "任务描述",
      "priority": "high | medium | low | none",
      "tag": "标签名",
      "startTime": "开始时间",
      "endTime": "截止时间",
      "todo": true,
      "important": false,
      "done": false,
      "doneAt": null,
      "createdAt": 1700000000000
    }
  ],
  "tags": ["工作", "学习"],
  "aiConfig": { "apiUrl": "", "apiKey": "", "model": "", "customPrompt": "" },
  "theme": "auto",
  "sidebarMini": false
}
```

## 分发

打包后将 `dist/todo-tools/` 目录整体复制即可运行：
- `todo-tools-win_x64.exe` — 可执行文件（约 1.7MB）
- `resources.neu` — 应用资源包
- 数据保存在 exe 同目录下的 `todo_data.json`

## 已知限制

- Neutralinojs 不支持托盘图标单击事件，需通过菜单项恢复窗口
- 迷你模式窗口拖动仅在桌面环境生效
- 无离线 PWA 支持（Web 模式下）
