# TODO Tools

TODO Tools 是一个使用原生 JavaScript、CSS 和 HTML 构建的轻量待办事项工具。项目通过 Vite 提供 Web 开发环境，并使用 Neutralinojs 打包 Windows 桌面应用，不依赖前端框架。

当前版本：`1.2.0`

## 功能概览

### 任务管理

- 快速添加、编辑、删除、完成和取消完成任务
- 支持 TODO、重要、全部、归档和日历视图
- 支持优先级、标签、备注、开始时间、截止时间和提醒时间
- 支持每天、每周、每月重复提醒
- 支持任务归档、取消归档以及批量清理已完成任务
- 支持按标题、备注和标签实时搜索
- 任务与标签计数通过内部索引同步，状态变更后立即刷新

### 快捷操作

- 添加任务时可预设日期、优先级和标签
- 添加任务时可在标签菜单中直接创建并选中新标签
- 任务右键菜单支持重要、TODO、标签、提醒和归档等操作
- 右键子菜单具有安全的指针移动区域，优先级和标签使用与任务列表一致的状态色
- 已完成列表固定在任务区域底部，可悬浮展开或折叠
- 侧栏可以折叠并保存折叠状态；展开和折叠状态使用统一的控件高度、边界间距与全局动画速度
- 折叠侧栏使用 `64px` 紧凑布局，迷你模式和展开侧栏操作采用统一的玻璃图标按钮
- 侧栏导航与标签作为应用内控件使用，禁用浏览器原生链接拖拽，避免拖动后打开新页面
- 桌面版支持置顶迷你模式、系统托盘和关闭后隐藏到托盘
- 迷你模式使用紧凑任务卡、待办统计和快速添加入口，默认窗口尺寸为 `240 × 288`

### 日历与下拉控件

- 日历视图支持月历、全年任务量热力图和全年完成量热力图三种模式
- 月历模式支持前后翻月、返回今天以及直接选择年份和月份
- 任务量和完成量模式使用居中的 GitHub 风格年度热力图，前后导航用于切换年份
- 点击任意日期会更新下方任务列表，不会自动切换当前图表模式
- 任务量模式按任务覆盖日期显示事项，完成量模式按 `doneAt` 显示当天完成事项，列表数量与热力图统计保持一致
- 图表区域可折叠；折叠后保留模式切换、标题和展开操作，并为任务列表释放空间
- 热力强度图例显示在年度图表右下角，月历模式不显示热力图例
- 图表区域保持稳定高度，下方日期任务列表独立滚动
- 自定义日期与日期时间选择器支持小时、分钟选择
- 月历和日期选择弹窗的“回到今天”操作使用统一的项目图标按钮样式
- 年月、时间、任务编辑和快捷添加菜单均使用统一的磨砂玻璃下拉样式和 SVG 图标
- 下拉控件支持方向键、回车、空格和 `Esc` 操作

### 外观与设置

- 克制的磨砂玻璃办公风界面，页面背景不使用渐变
- 支持跟随系统、亮色和暗色主题
- 设置面板包含外观、AI 配置、提醒、标签管理和系统
- 外观设置支持实时调整圆角、玻璃透明度、字体大小、模糊强度和全局动画速度
- 边框强度由项目视觉系统固定为 `0%`，不提供用户调节入口
- 外观参数会同步应用到日期格、任务卡片、按钮、输入框、菜单、弹层、标签和次级卡片
- 任务时间线设置位于外观面板：可开启在任务列表右侧显示创建与完成时间，并按创建或完成时间排序
- 设置页签、主题选择、主要操作、次要操作和标签管理按钮使用统一的项目按钮体系
- 标签支持创建、重命名、删除以及关联任务数量显示
- 支持配置 AI API URL、API Key、模型和自定义提示词
- 支持生成流式日报或周报
- 桌面版系统页支持自动更新：从 GitHub Releases 检查新版本，下载 zip 并校验 SHA-256 后替换应用文件，失败时自动回滚
- 页面和动态组件图标统一由 SVG 图标库渲染，不使用 Emoji 作为界面图标
- 自定义滚动条按滚动容器独立创建，属于对应列表或弹窗内部，不挂载全局 `body` 浮层

## 技术栈

| 项目 | 技术 |
| --- | --- |
| 构建工具 | Vite `^6.3.5` |
| 桌面运行时 | Neutralinojs `6.7.0` |
| Neutralino CLI | `@neutralinojs/neu ^11.7.1` |
| 开发语言 | 原生 JavaScript（ES Module） |
| 样式 | 原生 CSS |
| 桌面打包 | Neutralinojs + `rcedit` |
| 数据存储 | JSON 文件 + `localStorage` 降级快照 |

## 环境要求

- Node.js 18 或更高版本
- npm
- Windows 桌面打包需要可用的 Neutralino Windows 运行时

## 快速开始

```bash
npm install
npm run dev
```

Vite 会在终端中输出本地访问地址。开发模式通过 `/api/data` 读写项目根目录下的 `data.json`。

## 常用命令

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | 构建 Web 生产资源到 `dist/` |
| `npm run preview` | 预览生产构建 |
| `npm test` | 运行任务状态、日历热力图与日期事项匹配、AI URL、外观配置、提醒和加密兼容回归检查 |
| `npm run neu:run` | 同步配置、构建并启动 Neutralino 桌面窗口 |
| `npm run neu:build` | 构建桌面应用并写入 Windows 可执行文件元数据 |
| `npm run release -- <版本号>` | 将桌面构建产物打包为 zip 并生成 SHA-256 校验文件，输出 `gh release create` 发布命令 |

Windows PowerShell 或命令提示符中也可以使用 `npm.cmd`，例如：

```powershell
npm.cmd run build
npm.cmd test
```

## 项目结构

```text
TODO/
├── index.html
├── package.json
├── app.config.json             # 应用名称、窗口和迷你模式配置
├── neutralino.config.json      # Neutralino 运行配置
├── vite.config.js              # Vite 构建和资源复制配置
├── server-plugin.js            # 开发环境数据读写接口
├── scripts/
│   ├── check-state.js          # 状态、日历、AI URL、提醒和加密回归检查
│   ├── check-build-output.js   # 桌面构建前检查输出目录，避免覆盖异常目标
│   ├── ensure-neutralino.js    # 检查并准备 Neutralino 运行时
│   ├── sync-config.js          # 同步应用配置和版本号
│   ├── patch-exe.js            # 写入 Windows exe 元数据
│   └── release.js              # 打包发布 zip、生成 SHA-256 并输出发布命令
├── public/
│   ├── neutralino.js
│   ├── icon.svg                # Web 图标的 SVG 源
│   └── icon.png                # Neutralino/Windows 原生能力兼容资源
└── src/
    ├── main.js                 # 应用入口、托盘与桌面初始化
    ├── app.js                  # 数据、状态和界面组装
    ├── eventBus.js             # 应用内事件订阅与分发
    ├── selectors.js            # 筛选、计数和排序
    ├── runtimeIndex.js         # 任务运行时索引与搜索匹配
    ├── renderTodoItem.js       # 任务列表项渲染
    ├── calendar.js             # 日历视图
    ├── detail.js               # 任务编辑面板
    ├── datePicker.js           # 日期与日期时间选择器
    ├── glassSelect.js          # 通用玻璃下拉组件
    ├── quickAddPopup.js        # 快捷日期、优先级和标签菜单
    ├── contextMenu.js          # 右键菜单渲染
    ├── contextMenuConfig.js    # 右键菜单配置
    ├── settings.js             # 设置与标签管理
    ├── aiSummary.js            # AI 总结
    ├── reminder.js             # 提醒检查与通知
    ├── windowsToast.js         # Windows 原生通知注册与发送
    ├── miniMode.js             # 桌面迷你模式
    ├── miniSnap.js             # 迷你模式顶部贴边吸附与自动收起
    ├── timeline.js             # 时间线设置归一化与任务排序
    ├── updater.js              # 桌面端自动更新（检查、下载、校验、替换与回滚）
    ├── overlay.js              # 通用遮罩与弹窗
    ├── overlayScrollbars.js    # 按滚动元素创建的内部覆盖滚动条
    ├── glassTooltip.js         # 通用玻璃 Tooltip
    ├── ripple.js               # 按钮反馈动效
    ├── icons.js                # 统一 SVG 图标库与渲染方法
    ├── theme.js                # 主题切换
    ├── uiPreferences.js        # 外观配置归一化与 CSS 变量应用
    ├── style.css               # 全局样式和玻璃设计变量
    └── utils/
        ├── aiApi.js            # AI URL 规范化与端点补全
        ├── crypto.js           # 文件数据加密与兼容读取
        ├── date.js
        ├── html.js
        └── id.js
```

## 数据持久化

项目按运行环境选择存储方式：

1. Neutralino 桌面环境读写程序目录下的 `todo_data.json`。
2. Vite 开发环境通过 `/api/data` 读写项目根目录下的 `data.json`。
3. 文件接口不可用时，使用浏览器 `localStorage` 中的 `todo_app_data` 快照。

文件存储在 Web Crypto 可用时采用 AES-GCM 加密；旧版明文 JSON 和旧加密格式仍可兼容读取。加密不可用或失败时会降级为明文文件，因此该机制用于降低直接暴露风险，不应视为密码保险库。

### 数据保护

- 文件不存在时会使用本地降级快照或空数据启动。
- 文件存在但无法解析或解密时，会暂停后续文件覆盖，避免把损坏文件静默替换为空数据。
- 桌面环境会尽量将异常文件备份为带时间戳的 `.bak` 文件。
- `localStorage` 快照不会保存 `aiConfig.apiKey`；桌面或开发文件快照仍保存完整 AI 配置。
- 内部 `_index` 只用于运行时计数，不写入持久化文件。

## 数据模型

```json
{
  "todos": [
    {
      "id": "唯一标识",
      "title": "任务标题",
      "desc": "任务备注",
      "priority": "high | medium | low | none",
      "tag": "标签名",
      "startTime": null,
      "endTime": null,
      "reminder": null,
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
  "timeline": {
    "enabled": false,
    "sortBy": "created | completed"
  },
  "tags": ["工作", "学习"],
  "aiConfig": {
    "apiUrl": "",
    "apiKey": "",
    "model": "",
    "customPrompt": ""
  },
  "theme": "auto | light | dark",
  "uiStyle": {
    "radius": 12,
    "glassOpacity": 72,
    "borderStrength": 0,
    "fontScale": 100,
    "blur": 18,
    "motionSpeed": 100
  },
  "sidebarMini": false
}
```

## 桌面构建与分发

```bash
npm run neu:build
```

构建流程会执行以下操作：

1. 从 `package.json` 同步版本号到 `neutralino.config.json`。
2. 从 `app.config.json` 同步窗口尺寸、标题和二进制名称。
3. 构建 Vite 资源并生成 Neutralino 应用。
4. 使用 `rcedit` 更新 Windows 可执行文件的产品名称、版本和版权信息。

桌面产物位于 `dist/todo-tools/`。分发时应保留可执行文件和 `resources.neu` 在同一目录。

### 发布与自动更新

```bash
npm run neu:build
npm run release -- 1.2.0
```

`npm run release -- <版本号>`（版本号不带 `v` 前缀，且必须与 `package.json` 一致）会生成：

- `release/todo-tools-win_x64.zip`：包含 exe 与 `resources.neu` 的发布包
- `release/todo-tools-win_x64.zip.sha256`：发布包的 SHA-256 校验文件

随后执行脚本输出的 `gh release create v1.2.0 ...` 命令创建 GitHub Release，tag 为 `v<版本号>`。桌面端「系统 → 软件更新」通过 `releases/latest` 检查新版本，下载 zip 后按 `.sha256` 校验，通过后只替换 exe 与 `resources.neu` 两个白名单文件，失败时用 `.bak` 备份自动回滚。仓库无已发布版本（404）、接口限流（403/429）和网络异常会分别给出明确提示。

### 窗口配置

桌面窗口尺寸集中维护在 `app.config.json`，构建时由脚本同步到 Neutralino 配置：

| 模式 | 默认尺寸 | 最小尺寸 |
| --- | --- | --- |
| 主窗口 | `1100 × 700` | `800 × 500` |
| 迷你模式 | `240 × 288` | `220 × 220` |

迷你模式下会启用置顶、无边框和拖拽区域；退出后恢复主窗口尺寸、边框和居中位置。

## AI 配置说明

AI 总结由用户配置的接口提供。接口地址、模型名称和鉴权信息由使用者自行维护；浏览器环境还需要目标接口允许当前来源进行跨域请求。不要在不可信设备或共享数据文件中保存敏感 API Key。

API URL 会在实际请求时按以下规则处理：

- 用户填写的地址以 `/v1` 结束时，自动补全 `/chat/completions`。
- 已经包含 `/chat/completions` 时保持原值，不重复补全。
- 不以 `/v1` 结束的自定义地址保持原值，不替换用户配置。
- 查询参数和 URL 片段会保留在补全后的地址中。

例如：

```text
https://api.example.com/v1
→ https://api.example.com/v1/chat/completions
```

## 日历统计规则

- 月历显示当前月完整日期网格，并保留相邻月份日期跳转。
- 任务量热力图按照任务所属日期统计：跨天任务覆盖范围内每天（包含开始日和结束日）；只有开始时间时归属开始日；只有截止时间时沿用创建日至截止日范围；无计划时间时使用完成日或创建日。
- 任务量模式的日期详情与热力图共用同一套覆盖范围规则，所选日期的热力数量与底部任务列表保持一致。
- 完成量热力图按照任务的 `doneAt` 完成日期统计；日期详情也按 `doneAt` 筛选当天完成事项。
- 在月历、任务量和完成量之间切换时，已选日期会按当前模式立即刷新详情标题、事项和空状态。
- 热力颜色深浅表示数量强度，选中日期和今天状态始终优先保持清晰。
- 月历和年度热力图均保留 `data-date`、键盘选择、Tooltip 和 ARIA 描述。
- `calendarMode` 与图表折叠状态只属于当前运行状态，不写入持久化数据。

## UI 设计与开发规范

新增或修改界面时应遵循以下约定。

### 材质与主题

- 使用 `src/style.css` 中的主题变量和玻璃材质变量，不为常规控件硬编码纯白或纯黑背景。
- 所有按钮、输入框、菜单和状态元素必须同时检查亮色、暗色和跟随系统主题。
- 图表、列表和主视图背景应自然融合；除必要分隔线外，避免嵌套不透明大色块。
- 悬停、激活、按下和禁用状态应通过背景、边框、颜色、阴影和轻微缩放表达。

### 外观设置联动

- 结构性容器使用 `--ui-radius` 或 `--ui-radius-lg`。
- 按钮、输入框和常规控件使用 `--ui-radius-sm`。
- 标签、徽章、菜单选项和紧凑日期格使用 `--ui-radius-xs`。
- 状态圆点、优先级圆点、圆形复选状态等具有明确圆形语义的元素保持圆形。
- 透明度、字体和模糊效果分别使用 `--ui-glass-opacity`、`--ui-font-scale`、`--ui-glass-blur` 和 `--ui-glass-blur-light`。
- `--ui-border-strength` 固定为 `0%`，新增组件不得重新提供边框强度控制入口。
- 动画持续时间使用 `--motion-fast`、`--motion-normal` 和 `--motion-panel`，并由全局动画速度设置统一计算。
- 不应在新增组件中重新引入固定 `6px`、`8px`、`10px` 等结构圆角。

### 图标与按钮

- 界面图标统一使用 `src/icons.js` 中的 SVG 图标。
- 静态元素使用 `data-icon`，动态模板使用 `iconSvg()`，DOM 动态更新使用 `createIcon()` 或 `setIcon()`。
- 不使用 Emoji、字符箭头或字符叉号代替界面图标。
- 图标按钮必须使用 flex 居中并提供 `title` 或 `aria-label`。
- 主要、次要、图标、页签和危险操作按钮应复用现有按钮层级和反馈动效。
- 设置界面的页签、主题按钮、保存操作、恢复默认、测试通知及标签增删按钮是按钮样式参考实现。

### 布局与动效

- 视图右上角操作按钮应与标题和内容边缘对齐，并使用统一高度。
- 任务列表应复用主任务列表的完成、删除、移动和缩放动效。
- 固定标题下的滚动区域需要保留顶部间距；自定义滚动条必须创建在对应滚动元素内部，不得使用挂载到 `body` 的全局浮层。
- 动效应简短克制，并遵循 `prefers-reduced-motion`。
- 桌面最小窗口按 `800 × 500` 检查；窄屏布局应保持可触控尺寸并允许必要的横向滚动。

### 焦点与可访问性

- 不使用紫色亮边框或外发光作为常规焦点反馈。
- 键盘状态应通过主题适配的边框、背景或文字颜色表达，避免破坏选中状态。
- 可交互日期、菜单和页签应保留语义角色、键盘操作及准确的 ARIA 状态。

## 已知限制

- 桌面提醒、系统托盘和自动更新能力依赖 Windows、Neutralino 环境及 GitHub Releases 网络可达性。
- 迷你模式的窗口置顶、移动和无边框能力只在桌面环境生效。
- Web 构建不是离线 PWA。
- 生产静态预览没有开发服务器的 `/api/data` 写入接口，会使用 `localStorage` 降级存储。
- 文件加密密钥包含当前设备环境信息，跨设备迁移加密数据前应先保留可读取的原始环境或导出明文数据。

## 开发检查

提交改动前建议至少运行：

```bash
npm test
npm run build
git diff --check
```
