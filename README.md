# Leo 的小站

一个纯静态、无构建、无第三方运行时依赖的个人主页，托管在 GitHub Pages。

- 首页：`/`
- 网盘：`/pan/`
- 网盘编辑器：`/pan/edit/`
- 本地离线编辑器：`/tools/local-editor.html`
- 目录扫描脚本：`/tools/scan_folder.py`、`/tools/scan_folder.bat`

## 设计约定

- 页面是纯 HTML / CSS / JavaScript，不需要 npm、打包器或后端。
- 站点页面使用根相对路径（`/assets/...`、`/pan/...`），方便任意子页面引用同一套壳。
- 本地离线工具使用相对路径（`../assets/...`），因此可以直接双击 HTML 以 `file://` 打开。
- 配色以薄荷绿和水色为主：`#f3faf7`、`#2e9d86`、`#1f7f6d`、`#e0f5ee`、`#17332e`。
- 不加载外部字体和图片；图标全部是内联 SVG。

## 目录结构

```text
.
├─ index.html                  首页
├─ 404.html                    404 页面
├─ favicon.ico
├─ robots.txt
├─ .nojekyll                   关闭 GitHub Pages 的 Jekyll 处理
├─ assets/
│  ├─ css/
│  │  ├─ site.css              设计令牌、站点壳、通用组件
│  │  ├─ pan.css               网盘查看页
│  │  └─ editor.css            在线 / 本地编辑器
│  ├─ js/
│  │  ├─ site.js               移动导航、toast、复制等通用交互
│  │  ├─ pan-data.js           schema、校验、URL 规则、ID、搜索、合并
│  │  ├─ pan-scan.js           浏览器目录扫描（picker / input / 拖拽）
│  │  ├─ pan-app.js            网盘查看页
│  │  └─ pan-editor.js         在线 / 本地共用的编辑器
│  └─ templates/
│     └─ page.html             新页面模板
├─ pan/
│  ├─ index.html               网盘查看页
│  ├─ data.json                网盘数据（唯一需要手动上传的数据文件）
│  └─ edit/
│     └─ index.html            在线可视化编辑器
├─ tools/
│  ├─ local-editor.html        本地离线编辑器（双击打开）
│  ├─ scan_folder.py           纯标准库目录扫描脚本
│  └─ scan_folder.bat          Windows 拖拽式扫描入口
└─ tests/
   ├─ pan-data.test.mjs
   ├─ pan-scan.test.mjs
   └─ test_scan_folder.py
```

## 网盘数据

`pan/data.json` 是查看页唯一的数据源。格式：

```json
{
  "schemaVersion": 1,
  "type": "leoljs-pan",
  "title": "Leo 的网盘",
  "notice": "所有文件都通过外部网盘下载。",
  "updatedAt": "2026-11-13",
  "tree": [
    {
      "id": "n_xxxxxxxx",
      "type": "folder",
      "name": "学习资料",
      "description": "按主题整理。",
      "children": []
    },
    {
      "id": "n_yyyyyyyy",
      "type": "file",
      "name": "示例文件.zip",
      "url": "https://wwa.lanzouj.com/iSample01",
      "code": "1234",
      "size": 10485760,
      "updatedAt": "2026-11-13",
      "description": "替换成自己的蓝奏云链接。"
    }
  ]
}
```

规则：

- `schemaVersion` 必须为 `1`，`type` 必须为 `leoljs-pan`。
- 文件夹：`id`、`type: "folder"`、`name`、`children`，可选 `description`。
- 文件：`id`、`type: "file"`、`name`、`url`，可选 `code`、`size`、`updatedAt`、`description`。
- 下载地址必须是 `http(s)` 外部链接，且不能指向本站（不能是 GitHub Pages 自己的地址）。查看页绝不会把本站地址当下载源。
- 单个数据文件最多 30,000 个节点、10 MB、目录深度 20 层。
- 建议文件名保持唯一；编辑器的“合并”按 `type + name` 匹配。
- `updatedAt` 使用本地日期 `YYYY-MM-DD`。

## 日常编辑流程（在线）

1. 打开 `/pan/edit/`。
2. 页面会优先恢复浏览器里的草稿；没有草稿时读取线上的 `pan/data.json`。
3. 在左侧目录树中选择文件夹；在右侧修改文件夹信息、文件外链、提取码、大小、日期和描述。
4. 也可以切换到“JSON 源码”批量修改，点“应用 JSON”。
5. 点“导出 data.json”。导出前会做完整校验：
   - 标题不能为空；
   - 文件名不能为空；
   - 文件外链必须是合法外部链接；
   - 不能出现重复 `id`；
   - 不能超过节点数、大小、深度限制。
6. 用导出的 `data.json` 覆盖仓库里的 `pan/data.json`，提交并推送。
7. 刷新 `/pan/` 检查结果。

> 在线编辑器不会自动发布，也不会自动提交 Git。所有修改都只留在当前浏览器，直到你手动导出并上传。
> 草稿保存在 `localStorage`，键名为 `leoljs.pan.draft.v1`。

## 本地离线编辑 + 一键扫描目录

适合文件夹层级很深、文件很多的情况，整个工具可以离线运行。

### 方式 A：双击网页

直接双击 `tools/local-editor.html`。浏览器以 `file://` 打开，不需要服务器。

1. 点“扫描文件夹”，选择或拖入一个目录。
2. 工具只读取文件名、大小和修改时间，不读取文件内容，也不上传。
3. 确认扫描预览，选择应用方式：
   - **作为新文件夹**：在当前目录下新建扫描得到的根文件夹。
   - **合并到当前目录**：按 `type + name` 合并，保留已经填好的外链、提取码和描述。
   - **替换当前目录内容**：用扫描结果替换当前文件夹的子项。
4. 在表格里逐个填写外部网盘链接、提取码、大小和描述。
5. 点“导出 data.json”，再上传覆盖 `pan/data.json`。

> 用“选择文件”方式（而不是“选择文件夹”）时，浏览器不会返回空文件夹，工具会提示。需要保留空文件夹时，优先使用“选择文件夹”或拖拽。

### 方式 B：Python 脚本

要求 Python 3.9+，只使用标准库。

```bash
python tools/scan_folder.py "D:\要扫描的文件夹"
```

默认输出到被扫描文件夹旁边的 `<文件夹名>.pan.json`。常用参数：

```bash
python tools/scan_folder.py "D:\资料" -o "D:\资料.pan.json"
python tools/scan_folder.py "D:\资料" --title "我的资料" --root-name "资料"
python tools/scan_folder.py "D:\资料" --force
```

- 会保留空文件夹。
- 默认跳过符号链接和特殊文件，并给出警告。
- ID 算法与浏览器扫描器一致（UTF-8 FNV-1a 32 位）。
- 扫描结果中的文件 `url` 为空；用编辑器填写，或手动编辑 JSON。
- 输出超过 10 MB、节点超过 30,000、深度超过 20 层会拒绝写出。

Windows 上也可以把文件夹直接拖到 `tools/scan_folder.bat` 上。

## 新增一个页面

1. 复制 `assets/templates/page.html` 为新的 `xxx/index.html`（或根目录下的 `xxx.html`）。
2. 替换 `{{TITLE}}`、`{{DESCRIPTION}}`、`{{PAGE_TITLE}}`、`{{PAGE_INTRO}}`、`{{CONTENT}}` 等占位符。
3. 需要额外样式时，在 `assets/css/` 新建文件，并替换 `{{EXTRA_CSS}}` 为对应的 `<link>`。
4. 站内链接使用根相对路径，例如 `/assets/css/site.css`、`/pan/`。
5. 在首页和 `assets/js/site.js` 的导航中按需加入入口。

## 安全与行为说明

- 所有来自 JSON 的文本都通过 `textContent` 渲染，不拼接 HTML。
- 外部链接只允许 `http` / `https`，拒绝账号密码形式，拒绝本站域名。
- 查看页不会 `fetch` 或 `download` 文件本身，只打开外部网盘链接。
- 解析 JSON 时会丢弃 `__proto__`、`prototype`、`constructor` 等危险键。
- 编辑器草稿只存在本机浏览器；本地工具不会上传任何文件。
- `robots.txt` 已禁止抓取 `/pan/edit/` 和 `/tools/`，但这不是访问控制，页面本身仍是公开静态文件。

## 测试

无需安装依赖。

```bash
# 语法检查
node --check assets/js/site.js
node --check assets/js/pan-data.js
node --check assets/js/pan-scan.js
node --check assets/js/pan-app.js
node --check assets/js/pan-editor.js

# 数据层 / 浏览器扫描器
node tests/pan-data.test.mjs
node tests/pan-scan.test.mjs

# Python 扫描器
python -m unittest discover -s tests -p "test_*.py" -v
python -m py_compile tools/scan_folder.py
```

> 在部分受限环境里 `node --test` 会因 `spawn EPERM` 失败；上面的测试文件可以直接用 `node` 运行，不依赖 test runner。

## 部署

```bash
git add .
git commit -m "Update site"
git push origin main
```

GitHub Pages 会自动发布 `main` 分支。数据更新只需要替换 `pan/data.json`，不需要改 HTML。

## 已知占位内容

`pan/data.json` 里的蓝奏云链接是示例占位（`iSample01`…`iSample08`），发布前请替换为真实外链。
