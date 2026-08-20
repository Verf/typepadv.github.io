# 跟打器（typepadv.github.io）项目规划

一个可通过 GitHub Pages 部署的中文跟打练习器，支持多种内置输入方案（宇浩星陈、灵铭）、自定义跟打文本、提示码表、自定义键盘布局（Gallman）。

## 已确认的技术决策

### 1. 技术栈
- 零构建原生 HTML/JS 单页应用（仓库即网站，双击 index.html 也可运行）
- 引入轻量级 CSS 库（候选 Pico.css ~10KB），纯声明式无 JS 依赖
- 不引入重 UI 框架、无构建链

### 2. 功能范围（MVP）
核心功能：
1. 跟打区：显示待打字文本，实时渲染已打/当前字/未打区，当前字高亮，支持回改（退格）、重新开始
2. 实时统计：击键 KPM、键准（无回改口径）、回改次数、错字率、用时、正确率，实时刷新
3. 提示码表：当前字的编码实时提示，内置宇浩星陈 + 灵铭两套方案 + 支持上传自定义码表
4. 键盘布局：QWERTY（默认）+ Gallman 两套内置，目标键高亮 + 按键三态反馈 + 指法分区着色（可开关）
5. 跟打文本管理：内置示例文本 + 自定义文本导入（粘贴/上传 txt），按段/按行拆分
6. 历史记录：每次练习成绩（KPM/键准/正确率/用时/文本）存 localStorage，可查看列表

可选增强（后续迭代）：速度曲线图表、双拼键位图、主题切换、声音反馈

### 3. 统计指标口径（中文社群标准）
- 击键 KPM：每分钟击键数（含无效击键与回改键）
- 键准：无回改率（未回改字符 / 总字符）
- 回改次数：用户退格回改的次数
- 错字率：打错的字符数 / 总字符
- 用时：首次击键到完成
- 正确率：最终正确字符 / 总字符

### 4. 打字判定模式（重要）
- 用户开着中文输入法，以输入法**上屏的实际文字** vs 原文逐字比对
- **不捕获物理键**
- 错字 = 标记该位错误并继续前进推进（方案 B），用户可自行退格回改（计入回改次数）
- 布局不影响判定（判定始终按上屏文字，与键盘布局无关）

### 5. 提示码表
- 内置**宇浩星陈**全量码表（shurufa.app/mabiao-star.txt）+ **灵铭（gallming）**方案（兼容性遗留文件名 mabiao-ling.txt，灵明×Gallman 重排），格式「编码\t汉字」，编码在左；灵铭资产可用 `npm run sync:gallming` 从 gallming 上游重建
- 解析器**通用兼容设计**：方向自动检测（编码在左/在右均支持）、兼容 fcitx/Rime 双方向格式
- 单字匹配优先（首版只做单字编码提示，词编码提示留后续）
- 支持用户上传自定义码表（存 IndexedDB）
- 码表文件 fetch 按需加载 + 解析缓存（IndexedDB），避免每次刷新重解析

### 6. 键盘布局（Gallman 自定义）
- 内置 2 套：QWERTY（默认，含数字行）+ Gallman（30 键无数字行）
- Gallman 键位：顶行 `PLDWKJ FOU;`，中行 `NRTSGYHAEI`，底行 `ZXCVBQ M,./`
- **翻译映射 KEY_MAP**（qwerty → Gallman 键帽，仅字母键，未列出 = 原样）：
  ```
  q→p  w→l  e→d  r→w  t→k  y→j  u→f  i→o  o→u
  p→i  a→n  s→r  d→t  f→s  h→y  j→h  k→a  l→e
  n→q
  ```
- 翻译逻辑：码表编码字符 → QWERTY 键位 → 同物理位置的目标布局键位字母（逐字符查 KEY_MAP）
- 符号（;）不参与编码
- **翻译只作用于码表提示显示**（告诉用户按哪个键），不影响打字判定
- 提供**布局编辑器 UI**：基于 QWERTY 基准键位图，用户为每键位指定目标键帽，存 localStorage 可选择使用
- 虚拟键盘：按布局渲染键帽、目标键高亮（当前字编码首符）、三态反馈（正确绿/错误红/按下）、指法分区着色（可开关）

### 7. 数据存储
- localStorage：设置、键盘布局、历史成绩
- IndexedDB：用户上传码表、自定义跟打文本（可大）、码表解析缓存
- 内置码表走 fetch 静态文件（assets/code-tables/mabiao-star.txt）

### 8. 部署
- 零构建 + 根目录即站点：index.html 放仓库根，push 到 main 即部署到 https://typepadv.github.io/
- 所有资源用相对路径，无 base 路径问题
- 无需 GitHub Actions

## 项目结构（规划）
```
index.html            入口
assets/
  css/style.css       样式（含轻量 CSS 库本地化）
  js/                 原生 JS 模块（ES Modules）
    main.js           入口/状态管理
    parser.js         码表解析器（通用兼容）
    layout.js         键盘布局定义 + 翻译
    keyboard.js       虚拟键盘渲染
    typing.js         跟打逻辑/判定/统计
    stats.js          统计计算
    storage.js        localStorage + IndexedDB 封装
    ui.js             设置面板/历史/布局编辑器
  code-tables/        内置码表（mabiao-star.txt）
  vendor/             本地化的轻量库（如 pico.min.css）
```

## 开发约定
- 所有变更后自动 git add / commit（语义化提交）/ pull --rebase / push
- 提交信息遵循 Conventional Commits（feat:/fix:/refactor:/chore:/docs: 等）
