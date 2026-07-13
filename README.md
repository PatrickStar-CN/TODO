# TODO Tools

TODO Tools 是一个使用原生 JavaScript、CSS 和 HTML 构建的轻量待办事项工具。项目通过 Vite 提供 Web 开发环境，并使用 Neutralinojs 打包 Windows 桌面应用，不依赖前端框架。

当前版本：`1.1.0`

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
- 任务右键菜单支持重要、TODO、标签、提醒和归档等操作
- 已完成列表固定在任务区域底部，可悬浮展开或折叠
- 侧边栏可以折叠，并保存折叠状态
- 桌面版支持置顶迷你模式、系统托盘和关闭后隐藏到托盘

### 日历与下拉控件

- 月历视图支持前后翻月、返回今天以及直接选择年份和月份
- 自定义日期与日期时间选择器支持小时、分钟选择
- 年月、时间、任务编辑和快捷添加菜单均使用统一的磨砂玻璃下拉样式
- 下拉控件支持方向键、回车、空格和 `Esc` 操作

### 外观与设置

- 克制的磨砂玻璃办公风界面
- 支持跟随系统、亮色和暗色主题
- 设置面板包含外观、AI 配置和标签管理
- 标签支持创建、重命名、删除以及关联任务数量显示
- 支持配置 AI API URL、API Key、模型和自定义提示词
- 支持生成流式日报或周报

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
| `npm test` | 运行任务筛选、计数和排序的基础回归检查 |
| `npm run neu:run` | 同步配置、构建并启动 Neutralino 桌面窗口 |
| `npm run neu:build` | 构建桌面应用并写入 Windows 可执行文件元数据 |

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
│   ├── check-state.js          # 状态、计数与筛选回归检查
│   ├── sync-config.js          # 同步应用配置和版本号
│   └── patch-exe.js            # 写入 Windows exe 元数据
├── public/
│   ├── neutralino.js
│   └── icon.png
└── src/
    ├── main.js                 # 应用入口、托盘与桌面初始化
    ├── app.js                  # 数据、状态和界面组装
    ├── selectors.js            # 筛选、计数和排序
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
    ├── miniMode.js             # 桌面迷你模式
    ├── overlay.js              # 通用遮罩与弹窗
    ├── ripple.js               # 按钮反馈动效
    ├── theme.js                # 主题切换
    ├── style.css               # 全局样式和玻璃设计变量
    └── utils/
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
  "tags": ["工作", "学习"],
  "aiConfig": {
    "apiUrl": "",
    "apiKey": "",
    "model": "",
    "customPrompt": ""
  },
  "theme": "auto | light | dark",
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

## AI 配置说明

AI 总结由用户配置的接口提供。接口地址、模型名称和鉴权信息由使用者自行维护；浏览器环境还需要目标接口允许当前来源进行跨域请求。不要在不可信设备或共享数据文件中保存敏感 API Key。

## 已知限制

- 桌面提醒和系统托盘能力依赖 Windows 与 Neutralino 环境。
- 迷你模式的窗口置顶、移动和无边框能力只在桌面环境生效。
- Web 构建不是离线 PWA。
- 生产静态预览没有开发服务器的 `/api/data` 写入接口，会使用 `localStorage` 降级存储。
- 文件加密密钥包含当前设备环境信息，跨设备迁移加密数据前应先保留可读取的原始环境或导出明文数据。

## 开发检查

提交改动前建议至少运行：

```bash
npm test
npm run build
```
