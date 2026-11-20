# @baotherye/dsh-matt-flow-preset

**主页**：https://github.com/baotherye/dsh-matt-flow-preset

把 [Matt Pocock Agent Skills](https://github.com/mattpocock/skills) 套件编成一条**带前置条件的开发工作流**，作为 DSH 的一个 agent 预设。**39 个技能随插件包一起分发**（在包的 `skills/` 目录里），装好插件就有，不需要下载、不需要 `npx`、不发任何网络请求。

**关键隔离**：只有 `preset-matt`（工作流的 agent 预设）把包内的 `skills/` 声明成自己的 skill 发现根（`customSkillDirs`）；其他 agent 预设没有这项配置，不会扫描它，因此看不到这些技能。全程不碰所有预设都会读取的共享 `~/.agents/skills`。

技能文本是打包时的快照，并针对 DSH 做了少量改写（来源与改动清单见 [`skills/ATTRIBUTION.md`](skills/ATTRIBUTION.md)，遵循上游 MIT 许可）。

---

这是 [yuwang/dsh-matt-flow](https://github.com/yuwang/dsh-matt-flow) 的一个 fork：把 Matt 技能套件从「运行时下载到共享目录」改成「随包分发且仅本预设可见」，并按 DSH 的实际机制改写了若干技能（见 `skills/ATTRIBUTION.md`）。感谢原作者。如果它对你的工作有帮助，欢迎到 [GitHub 仓库](https://github.com/baotherye/dsh-matt-flow-preset) 点一颗 **Star**。遇到问题或想要新功能，也欢迎在 [Issues](https://github.com/baotherye/dsh-matt-flow-preset/issues) 里提。

---

## 它提供什么

一个 bundle，三层内容：

| 组成 | 作用 |
|---|---|
| `preset-matt` | 新增一个 agent 预设 `matt-flow`，插件集即官方 `standard` 预设 + 本包的 `matt-flow` 插件。在新建会话的预设选择器里出现。 |
| 系统提示词段落 `matt-flow` | 告诉模型：哪些技能它能自己 `skill` 加载（`grilling`/`tdd`/`code-review`/`diagnosing-bugs`…），哪些只能由你 `/命令` 触发（`/to-spec`、`/to-tickets`…），以及 拷问 → 规范 → 任务 → 实现 → 收尾 的顺序、每阶段该做什么。评审不是独立阶段，它在实现里完成。 |
| 工具 `flow_stage` | 记录并推进某个 feature 的阶段，落盘到 `.scratch/<feature>/flow.json`。前进必须逐级、且要满足前置条件；回退（返工）允许。 |
| 工具 `flow_ask` + 决策卡（`client.js`） | 拷问阶段把决策做成对话里的卡片：每题一组选项加一个补充输入框，一次最多三题。点「提交选择」后，答案作为你的下一条消息发出，模型接着往下走。卡片由本包自己的浏览器模块渲染，**不依赖 dsh-genui**。 |
| 阶段胶囊（`client.js`） | 输入框工具行左侧的小胶囊：当前阶段、第几步、**正在运行哪些子代理**。点开浮层看每个阶段的说明和前置条件。只在 Matt 预设的会话里出现。 |

### 一个包，两行挂载

浏览器侧代码只能从**顶层** Loader 条目聚合，而宿主行为必须留在**预设子树**里（否则会污染所有会话）。同一个包因此挂两次：

- 顶层 `matt-flow-ui` 行：只为让浏览器扫描到 `dsh.client`，它的 config 是 `uiOnly: true`，`apply()` 立刻返回，不注册任何东西
- 预设里 `matt-flow` 行：真正的工作（提示词、三个工具、投影）

这就是插件页只显示一个条目的原因。


## 模式说明

**它是什么**

一条带前置条件的开发工作流。每个 feature 走同一条路：拷问 → 规范 → 任务 → 实现 → 收尾。每一步做完，才能进下一步；跳级会被 `flow_stage` 拒绝。

评审不单独占一格：每张任务单实现完就评审、提交。

子代理不限于评审——探查、搜索、跑测试、独立实现都可以。胶囊会把**当前正在运行的子代理**按各自的名字列出来，不管它们在做什么。

它不是新的 AI 能力，而是把 Matt Pocock 那套技能串成有顺序、有产出的流程——技能随插件分发、只有本预设能看见，插件只负责编排。

**什么时候用它**

- 有一个要落地的需求，且希望能留下可复查的决策与规范
- 做多人协作，需要别人接手时能看懂「为什么这么做」
- 想强制自己先想清楚再写代码（拷问阶段不允许写代码）

不适合：一次性小脚本、纯问答、紧急线上排障（那种直接修，事后补记录）。

**怎么用**

1. 新建会话，预设选「Matt 工程流」
2. 直接说需求。它会先拷问：把决策做成卡片（选项 + 补充输入框），一次最多三题
3. 谈定后写规范、拆任务单、按单实现（每张单实现完就评审、提交）、收尾
4. 全程可以用输入框左侧的胶囊看进度；点开浮层能看到每一步要做什么

三条命令按需使用：

| 命令 | 用途 |
|---|---|
| `/grill-with-docs` | 用户手动触发拷问（模型在预设里会自己加载同样两个技能） |
| `/to-spec` | 只想要规范、不想走完整流程时 |
| `/code-review` | 只想评审某个分支或 PR |

**它会留下什么**

- `.scratch/<feature>/decisions.md` — 这次变更的决策
- `.scratch/<feature>/spec.md` — 规范
- `.scratch/<feature>/issues/*.md` — 任务单，含阻塞关系
- `CONTEXT.md` / `docs/adr/` — 术语与难以撤销的决定，**按需创建**（没有就不写）

**第一次用之前**

如果仓库还没定过 issue 放在哪，第一次进规范阶段前会要求写 `docs/agents/issue-tracker.md`。默认本地 markdown（`.scratch/`）即可；想要完整布局（triage 标签、域文档、`## Agent skills` 块）就自己跑一次 `/setup-matt-pocock-skills`。

## 阶段与前置条件

`拷问 → 规范 → 任务 → 实现 → 收尾`

进入下一阶段前要满足什么：

| 进入 | 前置条件 |
|---|---|
| `grill` | 无，直接开始拷问 |
| `spec` | `evidence` 写明拷问收口了什么决策；且 `docs/agents/issue-tracker.md` 存在 |
| `tickets` | `.scratch/<feature>/spec.md` 存在且 ≥ 200 字符 |
| `implement` | `.scratch/<feature>/issues/` 下至少 1 个 `.md` |
| `done` | 说明实现完成、评审通过、改动已提交 |

前置条件只校验**能校验的部分**（文件是否存在、内容是否够量、evidence 是否非空）。它不假装验证"测试真跑过了"——那句证据由模型自己写，你能在 `flow.json` 的 history 里看到它。

### 接手别人做了一半的活

如果规范、任务单是在别处写好的（另一个会话、另一台机器、或者先跑 `/to-tickets` 再 `/handoff`），不需要在这个会话里把前几个阶段重演一遍。让模型调用：

```
flow_stage { action: "resume", feature: "<slug>" }
```

它读 `.scratch/<slug>/` 下的文件，倒推已经走到哪：

| 磁盘上有 | 记为 |
|---|---|
| `issues/*.md` 至少 1 个 | `implement` |
| `spec.md` ≥ 200 字符 | `tickets` |
| `decisions.md` | `spec` |
| 都没有 | `grill` |

只往前推，不往回退：记录已经是 `done` 时再 resume，仍然是 `done`。来源会写进 `flow.json` 的 history，形如 `resumed from spec.md, issues (2)`。

两条限制：只看 `.scratch/<slug>/` 里的文件，`docs/agents/issue-tracker.md` 这类仓库级配置不算进度；如果那边的任务单落在 GitHub Issues 而不是本地 markdown，这里读不到，resume 会停在 `spec`，需要先把单子导成 `.scratch/<slug>/issues/NN-slug.md`。

### 为什么 spec 要求先记下 issue tracker

Matt 的套件有一条前置：`/setup-matt-pocock-skills`，用来定下 issue 放哪（GitHub / GitLab / 本地 markdown）、triage 标签词表、以及 `CONTEXT.md` 与 ADR 的目录布局，产出写进 `docs/agents/*.md` 并在 CLAUDE.md/AGENTS.md 里留一个 `## Agent skills` 块。

那一整套是用户命令，模型跑不了；但它的结论是下游技能的前提——`/to-spec`、`/to-tickets`、`/triage` 的正文里都写着"若未配置，让用户先跑 `/setup-matt-pocock-skills`"。

所以这里只强制**最小的一步**：把 issue tracker 的结论落进 `docs/agents/issue-tracker.md` 才允许写 spec。默认值是本地 markdown（`.scratch/<feature>/`），因为流程本来就写在那里；想要完整的标签词表与域文档布局，再让用户跑一次 `/setup-matt-pocock-skills`。

## 安装

从 npm 装（推荐，预构建，装得快）：

```bash
dsh plugin add @baotherye/dsh-matt-flow-preset
```

从 GitHub 装（拿到的是仓库最新代码，但需要本地构建）：

```bash
dsh plugin add git+https://github.com/baotherye/dsh-matt-flow-preset
```

也可以在 DSH 的 Plugins 页面填上面任一地址。装完**重启一次**，再**新建会话**，在预设置换器里选「Matt 工程流 / Matt Flow」。

也可以在本地开发时用目录安装：

```bash
dsh plugin --profile desktop add /path/to/dsh-matt-flow-preset
```

已存在的会话不受影响：预设只在新建会话时装入。

### 装好之后

第一次进规范阶段前，仓库里需要有一份 `docs/agents/issue-tracker.md` 说明 issue 放在哪。没配过就跑一次 `/setup-matt-pocock-skills`，或者直接让模型按本地 markdown 写一份。

技能套件（39 个）就在插件的 `skills/` 目录里，随包安装完成即生效，**没有安装步骤、没有网络请求、也没有子进程**。让模型调 `flow_skills` 可以确认它们的位置和完整性。

如果你以前装过原版 `dsh-matt-flow` 或本包的 0.8.x，技能可能残留在共享的 `~/.agents/skills`（旧版）或 `~/.dsh/dsh-matt-flow-preset/.agents/skills`（0.8.x 的私有目录）里。0.9.0 起两者都不再使用，可以整个删掉：

```bash
rm -rf ~/.dsh/dsh-matt-flow-preset
```

共享目录里的旧副本（如 `~/.agents/skills/grilling`）请留意：它们对其他预设仍可见，建议一并清理。本预设用的是包内的新副本，不受影响。

### 在哪里选

1. **新建会话的空白页**：底部输入区的工具行里，工作区选择器旁边有预设芯片（默认显示「标准 / Standard」），点开就是预设菜单，选「Matt 工程流」。
2. **设置 → Agent 预设**（`settings.agentPreset`）：按「内置 / 自定义」分组列出卡片，「Matt 工程流」在自定义组；卡片可「查看配置」（只读 YAML），也可设为**新建会话的默认**。

装好后若菜单里还没出现，刷新页面一次——预设名单在连接重置时刷新；当前已存在的会话不会切过去，必须新建。

## 用起来是什么样

1. 新建会话，选 `Matt Flow`，把你的想法说出来。
2. 模型会拉 `grilling` 跟你把设计问清楚，而不是直接改代码。
3. 它调 `flow_stage({action:"advance", to:"spec"})` 前进时，前置条件要求它先把决策写进 evidence。
4. 规范写进 `.scratch/<feature>/spec.md`，任务单写进 `.scratch/<feature>/issues/`。实现阶段逐张任务单走 `tdd`，每张做完就跑 `code-review` 并提交。
5. 随时 `flow_stage({action:"status", feature:"..."})` 看进度和下一阶段的前置条件。

## 本地开发

改完代码后：

- **`index.js` 改动**：必须重启 DSH。预设子树持有的模块在 Node 的 ESM 缓存里，`install_bundle` 会返回 `restart-required`（原因 `unmanaged-plugin`），热重载换不掉已加载的代码。重启后看系统临时目录的 `dsh-matt-flow-load.log` 确认版本号（macOS/Linux 在 `/tmp`，Windows 在 `%TEMP%`）。
- **`client.js` 改动**：先 `node --check client.js`，再刷新页面。浏览器侧模块由 `dsh.client` 清单扫描后加载，不刷新拿不到新模块；注册成功后可在 `tool.call.toolview` 的 occupant 里看到 `flow_ask`。
- **改完先跑一遍**：`npm test`（不依赖网络）。


## 外部依赖与权限

### 运行时依赖

**没有任何 npm 依赖。** 插件只使用 Node 内置模块（`fs`、`path`、`os`），浏览器侧只用宿主提供的 React。

### 它不启动任何子进程

0.9.0 起，插件不再调用 `npx`、不再下载技能、也不发起任何网络请求。技能就在包里，`skill-filesystem` 直接读目录。

以前的版本（0.8.x 及原版）会执行：

```bash
npx -y skills@latest add mattpocock/skills ...
```

其中原版用 `-g`（全局），把技能装进所有预设都会扫描的 `~/.agents/skills`——这正是本 fork 要修掉的跨预设泄漏。0.9.0 把技能直接打进包，这条命令连同它带来的网络、权限、失败重试问题一起消失了。

`cordis.patch.yml` 用一段 `!!js` 表达式把包内的 `skills/` 声明为 `preset-matt` 的 `customSkillDirs`（从 profile 里解析本包的 `package.json` 位置）；其他预设没有这项配置，永远不会扫描它。

### 它写哪些文件

| 路径 | 内容 |
|---|---|
| `.scratch/<feature>/flow.json` | 阶段状态 |
| `.scratch/<feature>/decisions.md`、`spec.md`、`issues/*.md` | 流程产物（由模型写，不是你手动维护） |
| `docs/agents/issue-tracker.md` | 首次进规范阶段前要求存在的 tracker 说明 |
| 包内的 `skills/` | Matt 技能套件本体（随包安装，只被本预设扫描；不需要也不应该改写） |
| 系统临时目录下的 `dsh-matt-flow-*.log` | 启动打点日志 |

### 权限范围

插件不申请额外权限，不读取凭据，不发起任何网络请求，不启动子进程。唯一的写操作是上表里首次初始化仓库时的那几个文件，且需要你批准一次。

## 已知边界

- **不接管模型行为**：提示词是强约束、不是硬约束。真正的强制只有 `flow_stage` 的前置条件——模型完全可以绕过它直接改代码。要更强的约束，得再加 `ctx.tools.guard()`。
- **预设即快照**：插件集复制自官方 `standard` 预设。DSH 升级后 `standard` 若增删插件，这个预设不会自动跟随；升级后建议对照 `@deepseek-ai/dsh-web-app/presets/standard.patch.yml` 同步一次。
- **UI 有限**：只有一个状态胶囊（输入框工具行）+ 决策卡，没有任务看板。
- **resume 只认本地文件**：它按 `.scratch/<feature>/` 里的 `decisions.md`、`spec.md`、`issues/*.md` 推断阶段。任务单若在 GitHub Issues 或 Linear 上，读不到，只能停在 `spec`。
- **工具定义用普通 JSON Schema**：没有用 `defineTool()`，因为插件从工作区链接安装时解析不到 `@deepseek-ai/*`。发布为 npm 包后可以改回。
- **技能是快照**：包内的 `skills/` 是打包时的上游快照，不会自己跟着 `mattpocock/skills` 更新；要跟进上游就重新打包发版。DSH 侧改写的部分见 [`skills/ATTRIBUTION.md`](skills/ATTRIBUTION.md)。
- **未在 Windows 上实测**：已按平台适配日志目录，但没有真机验证。

## 许可证

MIT，见 [LICENSE](./LICENSE)。包内 `skills/` 来自 [mattpocock/skills](https://github.com/mattpocock/skills)（MIT），来源与本地改动见 [`skills/ATTRIBUTION.md`](skills/ATTRIBUTION.md)。

### 排障

`apply` 会往系统临时目录的 `dsh-matt-flow-load.log` 与 `dsh-matt-flow-apply.log` 各写一行启动打点（macOS/Linux 在 `/tmp`，Windows 在 `%TEMP%`）：前者证明模块被导入，后者证明 `apply` 执行、各注册项成功。出现任何"预设加载失败"时先看这两个文件——没有 load 行是导入问题，有 load 无 apply 是注入问题。确认稳定后可以删掉这两处打点。


## 卸载

```bash
dsh plugin --profile desktop remove @baotherye/dsh-matt-flow-preset
```

`.scratch/` 下的数据是你的，不会被清理。
