# 待办事项管理工具（TODO Tools）

一个基于原生前端技术构建的轻量级待办事项管理应用，支持 Web 浏览器和 Windows 桌面应用两种运行模式。使用 Vite 构建，Neutralinojs 打包桌面应用，无前端框架依赖。采用液态磨砂玻璃（Liquid Glassmorphism）UI 设计风格。

## 功能特性

### 核心功能
- **任务管理**：快速添加、编辑、删除任务，标记完成/取消完成，按优先级排序
- **重要标记**：将任务标记为重要（星标），支持重要视图筛选
- **视图分类**：TODO（默认）、重要、所有任务、归档、日历视图
- **标签系统**：自定义标签，按标签筛选，标签管理面板（在设置中），双击重命名标签
- **日历视图**：紧凑月历网格，日期任务指示点，"今天"快捷按钮 + 月份标题点击选月，智能任务匹配（时间范围/单日期/创建日期）
- **详情编辑面板**：悬浮覆盖式编辑（标题、备注、优先级、标签、开始/截止时间、提醒、TODO/重要），自定义下拉选择器（优先级/标签/重复提醒），可编辑完成时间
- **归档系统**：右键菜单归档已完成任务，归档视图筛选，取消归档恢复主视图
- **模糊搜索**：实时模糊搜索标题/备注/标签，200ms 防抖，按视图过滤

### UI 设计
- **液态磨砂玻璃主题**：暗色模式（烟熏低透明玻璃质感）+ 亮色模式（柔和半透明磨砂卡片），低饱和冷色调办公风配色
- **三套主题切换**：自动跟随系统 / 亮色 / 暗色
- **玻璃按钮系统**：全局按钮统一玻璃样式，带涟漪波纹点按动效（`glassRipple` / `glassRippleAccent` 关键帧动画）
- **自定义下拉组件**：详情面板优先级/标签/重复提醒使用自建 `.detail-dropdown` 弹窗替代原生 `<select>` / `<datalist>`
- **原生 select 玻璃化**：日期选择器、月份选择器等处原生 `<select>` 统一适配玻璃样式（appearance: none + 自定义 SVG 箭头）
- **圆角分层体系**：侧边栏 16px、导航项/标签项 12px、任务卡片 16px、弹窗 12-18px、复选框 7px
- **内部高光模拟**：`--glass-highlight` 渐变层模拟光线折射效果
- **性能友好**：backdrop-filter blur 值控制在 6-14px 范围内
- **完整动画系统**：入场/退场/微交互全覆盖（`@keyframes` + `animationend` 事件清理）

### 设置系统
- **弹出式设置面板**：居中模态弹窗，三 Tab 切换（外观/AI 配置/标签管理）
- **外观设置**：主题切换（自动/亮色/暗色）
- **AI 配置**：API URL / Key / Model / 自定义 Prompt
- **标签管理**：新建/重命名/删除标签，显示关联任务数量

### 其他特性
- **迷你模式**：置顶小窗卡片，待办计数 + 前 8 条任务，快速添加/完成任务，悬停 tooltip 显示详情
- **快速添加预设弹窗**：日期/优先级/标签快捷预设（玻璃化选项卡片样式）
- **自定义日期选择器**：替换原生控件的美化日历组件，支持 date 和 datetime 模式，匹配玻璃主题
- **右键菜单**：配置与渲染分离架构，玻璃化菜单项样式
- **AI 总结**：SSE 流式日报/周报，含备注内容，半透明遮罩防误操作
- **提醒系统**：定时检测 + 桌面通知/Toast，支持重复提醒（每天/每周/每月）
- **侧边栏折叠**：可折叠为迷你侧边栏（56px，仅图标），状态持久化，0.2s 过渡动画
- **桌面特性**：系统托盘、关闭隐藏到托盘、本地 JSON 文件持久化

## 技术栈

| 层面 | 技术 |
|------|------|
| 前端构建 | Vite 6.3.5 |
| 桌面框架 | Neutralinojs 6.7.0 |
| 语言 | 原生 JavaScript (ES Module) |
| 样式 | 原生 CSS（液态磨砂玻璃设计，亮/暗双主题） |
| 数据存储 | 本地 JSON 文件 + localStorage 降级 |
| 包管理 | npm |

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
├── index.html                  # 主 HTML 入口（含迷你面板结构）
├── package.json                # 项目配置
├── app.config.json             # 应用配置文件（窗口尺寸/迷你模式参数）
├── neutralino.config.json      # Neutralino 桌面应用配置
├── vite.config.js              # Vite 构建配置（含自定义插件）
├── server-plugin.js            # Vite 开发服务器数据 API 插件
├── .gitignore                  # Git 忽略规则
├── data.json                   # 持久化数据文件（开发环境）
├── scripts/
│   ├── sync-config.js          # 构建时同步配置到 neutralino.config.json
│   └── patch-exe.js            # 构建后修改 exe 文件元数据
├── src/
│   ├── main.js                 # 应用入口（Neutralino 初始化 + 托盘 + 涟漪初始化）
│   ├── app.js                  # 组装骨架（~660 行），串联各模块
│   ├── settings.js             # 设置弹窗面板（Tab 切换 / 外观 / AI / 标签管理）
│   ├── ripple.js               # 按钮涟漪波纹动效模块
│   ├── eventBus.js             # 发布/订阅事件总线
│   ├── selectors.js            # 数据筛选与排序逻辑
│   ├── renderTodoItem.js       # 单条任务 DOM 构建
│   ├── calendar.js             # 日历视图渲染与日期任务匹配
│   ├── detail.js               # 任务详情面板 + 自定义下拉选择器
│   ├── overlay.js              # 通用弹窗/遮罩层系统
│   ├── contextMenu.js          # 右键菜单 DOM 渲染与交互
│   ├── contextMenuConfig.js    # 右键菜单配置（各场景菜单项）
│   ├── quickAddPopup.js        # 快速添加预设弹窗（日期/优先级/标签）
│   ├── datePicker.js           # 自定义日期/时间选择器组件
│   ├── aiSummary.js            # AI 总结面板
│   ├── reminder.js             # 提醒系统（定时检测 + 通知）
│   ├── miniMode.js             # 迷你模式（小窗置顶卡片）
│   ├── theme.js                # 主题切换（亮/暗/跟随系统）
│   ├── style.css               # 全局样式 + 玻璃主题变量 + 动画系统（~1600+ 行）
│   └── utils/
│       ├── date.js             # 日期格式化与比较工具函数
│       ├── html.js             # HTML 转义工具
│       └── id.js               # 唯一 ID 生成器
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

## 数据持久化

三层降级机制：

1. **Neutralino 桌面环境**：通过 `Neutralino.filesystem` API 读写本地 `todo_data.json`
2. **开发环境**：通过 Vite 插件 `/api/data` 接口读写 `data.json`
3. **降级方案**：浏览器 `localStorage`

环境检测逻辑：检查 `Neutralino` 全局对象和 `NL_PORT` 变量是否同时存在。

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
      "reminderRepeat": "none | daily | weekly | monthly",
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
  "theme": "auto | light | dark",
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
- 列表渲染使用 `innerHTML` 整体替换，大量任务时可能有性能瓶颈
