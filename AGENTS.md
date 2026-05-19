# AGENTS.md - 项目概览文档

## 项目简介

TODO Tools 是一个轻量级待办事项管理应用，使用原生 JavaScript 开发，支持以 Web 应用和 Windows 桌面应用两种形式运行。

---

## 技术栈

| 层面 | 技术 |
|------|------|
| 前端构建 | Vite 6.3.5 |
| 桌面框架 | Neutralinojs 6.7.0 |
| 语言 | 原生 JavaScript (ES Module) |
| 样式 | 原生 CSS（暗色主题） |
| 数据存储 | 本地 JSON 文件 + localStorage 降级 |
| 包管理 | npm |

---

## 项目结构

```
todoTools/
├── index.html                  # 主 HTML 入口（含迷你面板结构）
├── package.json                # 项目配置
├── neutralino.config.json      # Neutralino 桌面应用配置
├── vite.config.js              # Vite 构建配置（含自定义插件）
├── server-plugin.js            # Vite 开发服务器数据 API 插件
├── .gitignore                  # Git 忽略规则
├── data.json                   # 持久化数据文件（开发环境）
├── src/
│   ├── main.js                 # 应用入口（Neutralino 初始化 + 系统托盘）
│   ├── app.js                  # 核心业务逻辑（~1150 行）
│   └── style.css               # 全局样式 + 动画 + 迷你面板（~1430 行）
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
- 快速添加任务（Enter 键提交，支持预设截止日期、优先级、标签）
- 任务详情编辑面板（标题、备注、优先级、标签、开始/截止时间、TODO/重要标记）
- 标记完成/取消完成（带动画反馈）
- 标记为重要（星标）
- 删除任务（带自定义确认对话框 + 退出动画）
- 批量清空已完成任务
- 待办列表按优先级排序（高 > 中 > 低 > 无）

### 视图分类
- TODO（默认视图）
- 重要
- 所有任务
- 日历视图（紧凑月历 + 日期任务详情）

### 标签系统
- 新建标签（弹窗输入，重复检测）
- 删除标签（带关联任务数量提示）
- 标签管理面板（查看所有标签及任务数）
- 按标签筛选任务
- 数据规范化处理（去重、修剪空白、自动收集任务中的标签）

### 日历视图
- 紧凑月历网格（缩小格子尺寸，为任务详情留出更多空间）
- 月历导航（上/下月切换）
- 日期任务指示点（每天最多 3 个点）
- 今天高亮 + 选中日期高亮
- 点击日期查看当天任务详情（flex 布局自动占满剩余空间）
- 智能任务匹配（支持时间范围、单日期、创建日期）

### 快速添加预设弹窗
- 日期选择（今天/明天/下周/自定义日期/清除）
- 优先级选择（高/中/低/无）
- 标签选择（已有标签列表/清除）
- 弹窗自动调整位置（防止溢出视口）

### 迷你模式
- 侧边栏标题旁 `⊟` 按钮进入迷你模式
- 窗口缩小为 280×320 小卡片，置顶显示、无边框
- 显示待办/已完成计数统计
- 展示前 8 条待办任务（按优先级排序）
- 优先级彩色圆点标识
- 点击圆形 checkbox 直接完成任务
- 点击 `+` 按钮展开输入框快速添加任务（Enter 提交）
- 鼠标悬停任务 400ms 后弹出 tooltip 显示详情（标题、描述、优先级、标签、时间）
- 点击 `⊞` 按钮退出迷你模式，恢复正常窗口
- 标题文字区域可拖动窗口位置（通过 `setDraggableRegion`）

### 桌面应用特性
- 系统托盘菜单（显示窗口/退出）
- 关闭窗口时隐藏到托盘而非退出
- 本地文件系统数据持久化

---

## 动画系统

项目实现了一套完整的 CSS 动画系统，覆盖所有交互场景：

| 动画名称 | 时长 | 用途 |
|----------|------|------|
| `todoSlideIn` | 0.25s | 新增任务入场（从上方淡入滑入） |
| `todoSlideOut` | 0.3s | 删除任务退场（向右淡出 + 高度收缩） |
| `todoCheck` | 0.3s | 勾选/取消完成反馈（缩放脉冲） |
| `overlayFadeIn/Out` | 0.2s/0.15s | 弹窗遮罩层出入 |
| `dialogScaleIn/Out` | 0.25s/0.15s | 弹窗内容框缩放出入 |
| `detailSlideIn/Out` | 0.25s/0.2s | 详情面板从右侧滑入/滑出 |
| `popupFadeIn` | 0.15s | 快速添加预设弹窗淡入 |
| `viewFadeIn` | 0.2s | 视图切换淡入 |
| `doneListExpand/Collapse` | 0.3s/0.25s | 已完成列表折叠/展开 |

动画实现模式：
- 入场动画：通过添加 CSS 类触发 `@keyframes` 动画
- 退场动画：添加退场类 → 监听 `animationend` 事件 → 移除 DOM 或隐藏元素
- 微交互：按钮 `:active` 缩放、导航项/标签项 color 过渡、任务项 border-color 过渡

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
│  ├── 弹窗系统: createOverlay / closeOverlay         │
│  ├── 动画控制: entering/removing/checking 类切换     │
│  ├── 日历模块: renderCalendar / getTodosForDate     │
│  └── 迷你模式: enterMiniMode / exitMiniMode         │
├─────────────────────────────────────────────────────┤
│  style.css                                          │
│  ├── 暗色主题样式                                    │
│  ├── 响应式布局（flex）                              │
│  ├── 动画系统（@keyframes + transition）             │
│  └── 迷你面板样式 + tooltip                          │
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
      id: string,           // 唯一标识（时间戳 + 随机字符串）
      title: string,        // 任务标题
      desc: string,         // 任务描述
      priority: 'high' | 'medium' | 'low' | 'none',  // 优先级
      tag: string,          // 标签名称
      startTime: string | null,   // 开始时间（ISO 格式）
      endTime: string | null,     // 截止时间（ISO 格式）
      myday: boolean,       // 是否加入 TODO 视图
      important: boolean,   // 是否标记为重要
      done: boolean,        // 是否已完成
      doneAt: string | null,      // 完成时间
      createdAt: number     // 创建时间戳
    }
  ],
  tags: string[]            // 标签列表
}
```

---

## 开发约定

- 无前端框架，使用命令式 DOM 操作
- 事件委托模式：通过 `data-action` 和 `data-id` 属性统一处理
- 弹窗系统：`createOverlay()` 创建遮罩弹窗，支持键盘操作（Enter 确认、Escape 取消、点击遮罩关闭）
- 所有确认性操作使用应用内弹窗（`showConfirmDialog`），不使用浏览器原生 `confirm()`
- 构建时通过 Vite 插件自动注入 `neutralino.js`，开发时不加载
- Toast 通知用于操作反馈（`showToast` 函数）
- 动画遵循 `requestAnimationFrame` + `animationend` 事件模式
- 迷你模式通过 Neutralino `window.*` API 控制窗口状态（setBorderless、setAlwaysOnTop、setSize、setDraggableRegion）

---

## .gitignore 规则

```
node_modules/     # npm 依赖
dist/             # 构建产物
.tmp/             # Neutralino 临时文件
bin/              # Neutralino 运行时二进制
*.log             # 日志文件
data.json         # 开发环境用户数据
todo_data.json    # 桌面环境用户数据
```

---

## 已知限制

- Neutralinojs 6.7.0 不支持托盘图标单击/双击事件（`trayIconClicked` 未实现），单击托盘图标会弹出菜单，只能通过菜单项"显示窗口"恢复界面
- 列表渲染使用 `innerHTML` 整体替换，大量任务时可能有性能瓶颈
- 无离线 PWA 支持（Web 模式下）
- 迷你模式的窗口拖动依赖 `setDraggableRegion` API，仅在桌面环境生效

---

## 分发方式

将 `dist/todo-tools/` 目录整体复制即可运行：
- `todo-tools-win_x64.exe` — 可执行文件（约 1.7MB）
- `resources.neu` — 应用资源包
- 数据保存在 exe 同目录下的 `todo_data.json`
