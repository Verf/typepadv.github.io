# AGENTS.md

该项目用于实现一个可通过github page部署的跟打器，支持自定义跟打文本、提示码表和键盘布局。

## 工作要求

- 所有对项目的新增、修改、删除后，应自动进行git add、commit、pull --rebase、push，commit内容遵守语义化提交规范
- 用户提出的所有需求，先调查、思考，探索文档库中是否有可以利用的知识，再与用户逐一确认所有可能的决策点，完成需求对齐形成规划，经用户确认后再实施
- 注意决策点之间的依赖问题，与用户一次只确认一个决策点，每个决策先给出你的推荐方案
- 针对比较复杂的工作，充分利用subagents能力：在理解代码前用 scout ，在相信外部事实前用 researcher ，在进行较大改动前用 planner ，在实施时用 worker ，在检查时用 reviewer ，在决策本身有风险时用 oracle
- 如果在工作过程中，发现需要用户进一步补充信息，或需要用户进行手工操作，直接告诉用户，并给出可靠的操作指引
- 查看.env可以获取Github Token

## 发布约定（重要）

- **发布必须用 `node deploy.mjs "提交信息"`**：自动注入资源版本号 → git add/commit → pull --rebase → push
- 不要绕过 deploy.mjs 直接 git push：会漏掉版本号更新
- 资源版本号机制：`build-version.mjs` 基于 git 提交数+短hash 生成 `?v=` 参数注入 index.html；GitHub Pages 所有静态资源返回 `cache-control: max-age=600`（10分钟），HTML 与 JS 可能新旧不匹配，版本号变化强制浏览器拉新资源
- 若用户报「初始化失败 / Cannot read properties of null」：首查是否缓存旧版 JS，让用户 Ctrl+Shift+R 强制刷新；根因修复靠版本号而不是让用户刷缓存

## 历史踩坑记录（避免重犯）

### 缓存与部署
1. **HTML/JS 新旧不匹配崩溃**：静态资源被 GitHub Pages 缓存 10 分钟；删 DOM 后旧 JS 引用已删元素 → `null.addEventListener` 白屏。修复：资源版本号 + 防御性 `$()`（找不到元素打清晰提示）+ init 校验关键元素。
2. **Pages URL 认知**：仓库 `Verf/typepadv.github.io` 的站点是 `https://verf.github.io/typepadv.github.io/`（用户名 Verf + 仓库名），不是 `typepadv.github.io` 根域；部署验证用 `node test/live.test.cjs`。

### 统计与判定
3. **KPM 天文数字**：会话 `startTime` 必须由 typing.js 在首次有效输入时设置，不能依赖 stats.js 的死代码 `applyInput`；否则 elapsed 取 Date.now 全量 → KPM 十亿级。回归测试已覆盖。
4. **统计口径**：键准 = (总字符 - 未回改错误)/总字符；错字率 = (回改次数 + 未回改错误)/总字符；KPM=击键/分钟；净速=字数/分钟。回改过的错字不算错。
5. **完成判定**：`isDone = pos >= text.length`（方案B 错字也推进）；完成后再回改应回到未完成态（finished 需复位），否则回改被忽略。

### 输入法上屏
6. **IME composition 重复计数**：`compositionstart/end` 期间的 `input` 事件必须忽略（`e.isComposing` 判断），组合结束只统计最终上屏增量；否则击键数虚增、KPM 失真。
7. **隐藏输入框**：不能用 `pointer-events:none`（无法聚焦）；用 `position:fixed;1px;opacity:0` 可聚焦透明 textarea；用户通过点击跟打区聚焦。

### UI 与数据
8. **示例文本污染**：内置示例内容必须用常量（SAMPLE_TEXT），不能引用 `state.currentText`（会跟随切换被覆盖）；文本列表重新渲染要基于全量数据。
9. **冗余入口**:同一功能避免多个 UI 入口（曾出现「导入文本」按钮 + details summary 重复）；删按钮需同步删 JS 引用否则崩溃。
10. **码表词条污染**：解析器只索引单字（`Array.from(ch).length===1` 且为汉字），词条/fcitx权重列要跳过；大码表(12.8万行)解析结果缓存到 IndexedDB，避免每次刷新重解析。
11. **布局翻译 null 边界**：`translateCode(code, null)`（QWERTY 布局）应原样返回码表编码，不能访问 null 映射；KEY_MAP 只覆盖 19 个字母，未列出的原样。
12. **updateTargetKey 缺码表保护**：gallman 布局下 layoutMap 非空会进入 updateTargetKey，若 `state.currentCodeTable` 为 null（码表尚未加载完）→ `lookupCode(null)` → `null.charToCodes` 崩溃。所有查码表函数调用前必须校验 currentCodeTable 非空（updateCodeHint/updateTargetKey/flashForLastKey 三处）。
13. **测试断言随功能更新**：默认文本、统计口径变化后，live.test/integration.test 的断言（如「码表提示 ifk」）必须同步更新，否则线上测试误报失败。
14. **测试环境**：ESM 项目 `.js` 按 type=module 处理，Node 侧工具/测试用 `.cjs`；puppeteer-core 无 `page.waitForTimeout`，用原生 setTimeout；测试走 http://localhost:4173（serve.cjs），file:// 会 CORS 失败。
15. **puppeteer 多页面导航限制**：本环境 puppeteer-core 对同页 reload/多 page 二次 goto 会报 `Target closed`（大文件加载+IndexedDB 场景），回归测试别依赖导航重进；用 `page.evaluateOnNewDocument` 注入 localStorage 模拟「重新进入」。

### 多方案（星陈 + 灵铭）
16. **方案注册表**：内置方案集中在 `assets/js/schemes.js`（`BUILTIN_SCHEMES`），每方案声明码表/拆分/字根 URL + `codeBaseLayout`（编码基准布局：星陈=qwerty、灵铭=gallman）+ `defaultTranslate`。新增方案只需改注册表+加数据文件。
17. **灵铭方案**：用户自研「灵明字根 × Gallman 布局重排」，码表编码原生是 Gallman 键帽（`宇→frmo`），显示**不需要翻译**（默认关翻译开关）。数据源：`git.nas.verf.uk/verf/mycode` 仓库 gallming 交付物（内网，SSRF 工具抓不到但 shell git clone 可以）。数据文件：`mabiao-ling.txt`（21,653 行）、`chaifen-ling.json`（20,993 字）、`zigen-ling.json`（20 Gallman 键、238 字根）。
18. **翻译开关语义**：设置「码表翻译到布局」控制编码是否从基准布局翻译到当前布局。内置 qwerty↔gallman 用 KEY_MAP 语义（`buildCodeTranslateMap` 直接复用 gallmanMap 及其反向，保证星陈行为不变）；自定义布局基准为 qwerty 时直接复用 layoutMap；灵铭+自定义布局退化为按 qwerty 物理对齐。切内置方案时开关自动设为该方案默认值。
19. **字根渲染双模式**：星陈 `zigenMode='qwerty-base'`（数据键=QWERTY 大码，按当前布局反查键帽）；灵铭 `'keycap'`（数据键=Gallman 键帽直配）。灵铭字根条目字段 `s` 是声韵编码（如 da/e/ge），不是单字母小码。
20. **自定义码表**：无内置拆分/字根，基准布局视为 qwerty、翻译默认开，导入后 `clearZigen` 清字根。
21. **字根数据必须单字符条目**：字根 JSON 的 `f` 字段每个异体单独一条（星陈 397 条全单字符）。灵铭原始 roots_map.html 把异体合并（`艮`、`高`）导致格子内多字重叠；需从 yuling.roots.dict.yaml 的 `+ 声韵 = 根串` 拆分成单字符条目（灵铭 366 条）。
22. **字根网格列数自适应**：`.zigen-grid` 固定 6 列在键宽不足时字根文字（13px）溢出格子互相重叠（星陈/灵铭都中招）。`roots.js` 渲染时按键实际宽度算列数 `Math.max(3, Math.min(6, Math.floor((keyWidth-8)/15)))` 内联到 gridTemplateColumns（星陈 QWERTY 63px→4 列、灵铭 Gallman 83px→5 列，溢出 0）。窄屏（<900px）键高仅 32px 放不下字根，是既有限制。
23. **字根表须含族根串全部字根**：yuling.roots.dict.yaml 的 `+ 声韵 = 根串` 条目**不完整**（漏 `亻𬺰饣夂扌` 等基础字根），族根串（如 J 族 `凵寸亻生風卩亠𬺰入三饣夂向`）才是完整列表。生成 zigen-ling.json 必须**合并族根串 + 声韵条目并集**；声韵条目缺的字根从拆分表 per_roots 反查（`亻→Je→e`、`饣→Jsi→si`、`扌→To→o`），查不到默认给大码小写。星陈 zigen-star.json 同样有该问题（官方数据本身缺 `亻`），但星陈方案无此报障暂不处理。
24. **多键高亮 + 字根高亮**：`updateTargetKey` 用 `setTargetKeys(container, primary, extras)` 高亮当前字全部编码涉及的键（首个编码首字母=`target` 实心，其余=`target-extra` 虚线浅色）；`highlightZigenForChar` 从拆分编码提取大写（大码）→ 翻译到当前布局键帽 → 在该键字根条目中匹配拆分字根（`f===root || f.includes(root)`）加 `.active-root`。时序坑：码表/拆分/字根三者异步加载，初始与切方案后都需在各自加载完成时补调 `updateTargetKey()`，否则字根高亮不出现（拆分未就绪时 `getChaifen` 返回 null）。
