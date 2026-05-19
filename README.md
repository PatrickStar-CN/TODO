# 待办事项管理工具（Todo Tools）

一个基于原生前端技术构建的轻量级 Todo 任务管理小工具，使用 Vite 作为开发与构建工具，无框架依赖。

## 项目结构

```
todoTools/
├── src/
│   ├── main.js          # 应用入口，加载样式并初始化应用
│   ├── app.js           # 核心业务逻辑（数据加载、渲染、交互）
│   └── style.css        # 全部界面样式
├── data.json            # 本地持久化数据文件（todos + tags）
├── index.html           # 页面骨架（侧边栏、任务列表、日历、详情面板）
├── server-plugin.js     # Vite 开发服务器数据接口插件（/api/data）
├── vite.config.js       # Vite 配置与插件挂载
├── package.json         # 项目元信息与脚本
└── package-lock.json    # 依赖锁定文件
```

## 核心功能

- **任务管理**：新增、编辑、删除任务，标记完成 / 取消完成
- **重要标记**：将任务标记为重要，支持按重要程度筛选
- **视图筛选**：支持「我的一天」「重要」「所有」三种内置视图
- **标签分类**：支持自定义标签，按标签筛选任务
- **日历视图**：按月展示任务分布，点击日期查看当天任务
- **详情面板**：编辑任务标题、备注、截止日期等详细信息
- **已完成折叠**：已完成任务区域可折叠 / 展开
- **清空已完成**：一键清除所有已完成任务

## 数据持久化

采用"服务端文件 + 前端兜底"双重机制：

1. **优先**：通过 `/api/data` 接口读写 `data.json`（开发模式下由 Vite 插件提供）
2. **兜底**：接口不可用时自动回退到浏览器 `localStorage`

## 技术栈

- 原生 HTML / CSS / JavaScript（无框架依赖）
- Vite 6.x（开发服务器 + 构建工具）
- Vite 自定义插件（开发时数据接口）

## 快速开始

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev

# 构建生产版本
npm run build

# 预览构建产物
npm run preview
```

## 数据模型

`data.json` 结构示例：

```json
{
  "todos": [
    {
      "id": "唯一标识",
      "title": "任务标题",
      "done": false,
      "important": false,
      "myday": true,
      "tag": "标签名",
      "date": "截止日期",
      "note": "备注",
      "createdAt": "创建时间"
    }
  ],
  "tags": ["计划内"]
}
```

## 工作流程

1. 页面加载 → `main.js` 初始化 → 调用 `app.js` 中的 `initApp()`
2. `loadData()` 从接口或本地存储加载数据
3. `render()` 根据当前视图和筛选条件渲染界面
4. 用户操作 → 更新内存数据 → `saveData()` 持久化 → 重新渲染
