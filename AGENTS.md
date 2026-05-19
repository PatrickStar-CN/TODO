# AGENTS.md - 项目概览文档

## 项目简介

TODO Tools 是一个轻量级待办事项管理应用，使用原生 JavaScript 开发，支持以 Web 应用和 Windows 桌面应用两种形式运行。

---

## 技术栈

| 层面 | 技术 |
|------|------|
| 前端构建 | Vite 6.x |
| 桌面框架 | Neutralinojs 6.7.0 |
| 语言 | 原生 JavaScript (ES Module) |
| 样式 | 原生 CSS（暗色主题） |
| 数据存储 | 本地 JSON 文件 + localStorage 降级 |
| 包管理 | npm |

---

## 项目结构

```
todoTools/
├── index.html                  # 主 HTML 入口
├── package.json                # 项目配置
├── neutralino.config.json      # Neutralino 桌面应用配置
├── vite.config.js              # Vite 构建配置（含自定义插件）
├── server-plugin.js            # Vite 开发服务器数据 API 插件
├── data.json                   # 持久化数据文件
├── src/
│   ├── main.js                 # 应用入口（Neutralino 初始化 + 系统托盘）
│   ├── app.js                  # 核心业务逻辑
│   └── style.css               # 全局样式
├── public/
│   ├── neutralino.js           # Neutralino 客户端库
│   └── icon.png                # 应用图标
├── bin/
│   └── neutralino-win_x64.exe  # Neutralino 运行时
└── dist/                       # 构建产物
    └── todo-tools/
        ├── todo-tools-win_x64.exe  # 打包后的桌面应用
        └── resources.neu            # 应用资源包
```

---

## 功能特性

### 任务管理
- 快速添加任务（支持预设截止日期、优先级、标签）
- 任务编辑（标题、备注、优先级、标签、开始/截止时间）
- 标记完成/取消完成
- 标记为重要（星标）
- 删除任务（带确认对话框）
- 批量清空已完成任务

### 视图分类
- TODO（默认视图）
- 重要
- 所有任务
- 日历视图（月历 + 日期详情）

### 标签系统
- 新建/删除标签
- 按标签筛选任务
- 标签管理面板

### 日历视图
- 月历导航
- 日期任务指示
- 点击日期查看当天任务

### 桌面应用特性
- 系统托盘（显示窗口/退出）
- 关闭窗口时隐藏到托盘而非退出
- 本地文件系统数据持久化

---

## 脚本命令

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | Vite 生产构建 |
| `npm run preview` | 预览生产构建 |
| `npm run neu:run` | 构建 + Neutralino 窗口运行 |
| `npm run neu:build` | 构建 + 打包为桌面应用 |

---

## 架构设计

```
┌─────────────────────────────────────────────────────┐
│                   index.html (SPA)                   │
├─────────────────────────────────────────────────────┤
│  main.js                                            │
│  ├── Neutralino 初始化 + 系统托盘设置                │
│  └── 调用 initApp()                                 │
├─────────────────────────────────────────────────────┤
│  app.js (核心逻辑)                                   │
│  ├── 数据层: loadData() / saveData()                │
│  ├── 状态管理: data, currentList, currentTag        │
│  ├── 渲染层: render() → renderSidebar/TodoList/...  │
│  ├── 事件处理: 事件委托 + DOM 操作                    │
│  └── 日历模块: renderCalendar / getTodosForDate     │
├─────────────────────────────────────────────────────┤
│  style.css (全局暗色主题样式)                         │
└─────────────────────────────────────────────────────┘
         │                        │
    [Neutralino 环境]        [浏览器/开发环境]
         │                        │
    filesystem API          server-plugin.js
    (本地 JSON 文件)          (Vite 中间件 → data.json)
```

---

## 数据持久化策略

三层降级机制：

1. **Neutralino 桌面环境**：通过 `Neutralino.filesystem` API 读写本地 `todo_data.json`
2. **开发环境**：通过 Vite 插件提供的 `/api/data` REST API 读写 `data.json`
3. **降级方案**：`localStorage`

环境检测逻辑：检查 `Neutralino` 全局对象和 `NL_PORT` 变量是否同时存在。

---

## 数据模型

```javascript
{
  todos: [
    {
      id: string,
      title: string,
      desc: string,
      priority: 'high' | 'medium' | 'low' | '',
      tag: string,
      startTime: string,
      endTime: string,
      myday: boolean,
      important: boolean,
      done: boolean,
      doneAt: string | null,
      createdAt: string
    }
  ],
  tags: string[]
}
```

---

## 开发约定

- 无前端框架，使用命令式 DOM 操作
- 事件委托模式：通过 `data-action` 和 `data-id` 属性统一处理
- 弹窗系统：`createOverlay()` 创建遮罩弹窗，支持键盘操作（Enter 确认、Escape 取消）
- 所有确认性操作使用应用内弹窗，不使用浏览器原生 `confirm()`
- 构建时通过 Vite 插件自动注入 `neutralino.js`，开发时不加载

---

## 分发方式

将 `dist/todo-tools/` 目录整体复制即可运行：
- `todo-tools-win_x64.exe` — 可执行文件（约 1.7MB）
- `resources.neu` — 应用资源包
- 数据保存在 exe 同目录下的 `todo_data.json`
