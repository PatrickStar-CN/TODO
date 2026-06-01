# 待办事项管理工具（TODO Tools）

一个基于原生前端技术构建的轻量级待办事项管理应用，支持 Web 浏览器和 Windows 桌面应用两种运行模式。使用 Vite 构建，Neutralinojs 打包桌面应用，无前端框架依赖。

## 功能特性

- **任务管理**：快速添加、编辑、删除任务，标记完成/取消完成，按优先级排序
- **重要标记**：将任务标记为重要（星标），支持重要视图筛选
- **视图分类**：TODO（默认）、重要、所有任务、日历视图
- **标签系统**：自定义标签，按标签筛选，标签管理面板，双击重命名标签
- **日历视图**：紧凑月历网格，日期任务指示点，点击查看当天任务
- **详情面板**：编辑标题、备注、优先级、标签、开始/截止时间
- **侧边栏折叠**：可折叠为迷你侧边栏（仅图标），状态持久化，带过渡动画
- **归档系统**：将已完成任务归档，归档后不在主视图显示但日历中正常显示，标签下全部归档后自动隐藏
- **模糊搜索**：实时搜索任务标题和备注，200ms 防抖，不区分大小写
- **编辑面板悬浮模式**：详情编辑面板使用 position: fixed 悬浮覆盖，带半透明遮罩层，不挤压主内容
- **已完成列表排序**：已完成任务按完成时间倒序排列
- **迷你模式**：窗口缩小为置顶小卡片，显示待办列表，支持快速添加和完成任务，窗口尺寸可通过 app.config.json 配置
- **快速添加预设**：日期、优先级、标签预设弹窗
- **AI 摘要**：基于 SSE 流式输出的每日/每周任务报告，报告中包含任务备注内容，支持自定义 API 配置
- **提醒系统**：基于 Windows Toast 通知的任务提醒，支持重复提醒
- **主题切换**：支持自动/亮色/暗色主题切换
- **动画系统**：完整的入场/退场/微交互动画
- **已完成区域**：可折叠/展开，展开后内部滚动，不超出窗口
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
├── app.config.json             # 应用配置文件（窗口尺寸/迷你模式参数）
├── .gitignore                  # Git 忽略规则
├── src/
│   ├── main.js                 # 应用入口（Neutralino 初始化 + 托盘）
│   ├── app.js                  # 核心业务逻辑（组装骨架，~660 行）
│   ├── aiSummary.js            # AI 摘要模块（SSE 流式日报/周报）
│   ├── calendar.js             # 日历视图
│   ├── contextMenu.js          # 右键菜单核心逻辑
│   ├── contextMenuConfig.js    # 右键菜单配置
│   ├── detail.js               # 任务详情面板
│   ├── eventBus.js             # 事件总线（模块间通信）
│   ├── miniMode.js             # 迷你模式
│   ├── overlay.js              # 遮罩层
│   ├── quickAddPopup.js        # 快速添加弹窗
│   ├── reminder.js             # 提醒系统（Windows Toast 通知）
│   ├── renderTodoItem.js       # 任务项渲染
│   ├── selectors.js            # DOM 选择器集中管理
│   ├── theme.js                # 主题切换（自动/亮色/暗色）
│   ├── style.css               # 全局样式 + 动画系统
│   └── utils/
│       ├── date.js             # 日期工具函数
│       ├── html.js             # HTML 工具函数
│       └── id.js               # ID 生成工具
├── public/
│   ├── neutralino.js           # Neutralino 客户端库
│   └── icon.png                # 应用图标
├── scripts/
│   ├── sync-config.js          # 配置同步脚本
│   └── patch-exe.js            # 可执行文件补丁脚本
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
      "reminder": "提醒时间",
      "reminderRepeat": "none | daily | weekly",
      "todo": true,
      "important": false,
      "done": false,
      "doneAt": null,
      "archived": false,
      "archivedAt": null,
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
- 提醒通知仅在 Windows 桌面环境下生效
- 无离线 PWA 支持（Web 模式下）
