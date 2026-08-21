# dsh-ai-recorder — 版本管理

本目录是 `dsh-ai-recorder` 插件的版本管理根目录，按「插件 → 版本」两层组织；
官方 DSH 源码独立存放于同级 `dsh-official/`，同样按版本管理。

## 目录结构

```
dsh-plugins/                          # dsh 插件总文件夹
├── dsh-official/                     # 官方 DSH 源码（按版本隔离，独立版本管理）
│   ├── README.md                     # 官方源码版本管理说明
│   ├── deepseek-harness-v0.1.0-rc.7/ # 官方 v0.1.0-rc.7 源码
│   ├── deepseek-harness-v0.1.0-rc.8/ # 官方 v0.1.0-rc.8 源码
│   └── deepseek-harness-v0.1.1-rc.1/ # 官方 v0.1.1-rc.1 源码
├── dsh-msg-link/                     # 同格式参考插件（多版本目录）
└── dsh-AIrecorder/                   # 本插件文件夹
    ├── README.md                     # 本文件：版本管理说明
    └── dsh-v0.1.1-rc.1/              # v0.1.1-rc.1 版本（适配官方 rc.1 内核）
        ├── MANIFEST.md               # 版本清单：依赖闭包/装卸命令/API 契约/验证状态
        ├── CHANGELOG.md              # 版本变更记录（相对上一版本的更新原因与内容）
        ├── CUSTOMIZATION.md          # 定制化说明
        ├── plugin/                   # 插件源码（package.json + src + scripts + lib + cordis.patch.yml）
        └── typecheck-tmp/            # typecheck 环境（指向 dsh-official/deepseek-harness-v0.1.1-rc.1）
```

## 版本管理规则

1. **每个版本一个文件夹**，文件夹名 = 完整版本号（`dsh-v0.X.Y-rc.N`），一眼可辨。
2. **每个版本必须声明依赖的官方插件**（见各版本 `MANIFEST.md`）：
   - 适配的官方内核版本（如 `0.1.1-rc.1`）
   - 插件实际消费的官方包及精确版本
   - 关键 API 契约（签名差异点）
   - 验证状态
3. **官方 DSH 更新后**：先对照 `MANIFEST.md` 判断本插件是否需要适配，
   再决定是否新建 `dsh-v<完整版本号>` 版本文件夹。
4. **官方源码与插件版本一一对应**：`dsh-official/deepseek-harness-v<完整版本号>/` 是 `dsh-v<完整版本号>/`
   的 typecheck 依据；官方源码无 node_modules，第三方依赖复用
   `dsh-deepknow/dsh-plugin-dev` 的 pnpm store（共享，版本一致）。
5. **纪律**：插件只消费官方 API，不修改/不重实现/不绕过官方实现；
   因此插件应同时兼容官方 dsh 与第三方 desktop 内核。

## 版本说明

| 版本 | 适配目标 | 状态 |
| --- | --- | --- |
| dsh-v0.1.1-rc.1 | 官方 dsh rc.1 内核 | 已 typecheck，待实机验证 |

## 新增版本流程

1. 复制上一版本文件夹为 `dsh-v0.X.Y-rc.N+1/`。
2. 下载对应官方 dsh 源码到 `dsh-official/deepseek-harness-v0.X.Y-rc.N+1/`。
3. 对照官方源码 diff，找出 API 契约变化，在 `plugin/` 中做适配。
4. 修改 `typecheck-tmp/tsconfig.json` 指向新官方源码，跑 typecheck。
5. 更新 `MANIFEST.md`：官方包版本、API 契约、验证状态。
6. 若为第二个及以上版本，编写 `CHANGELOG.md`：相对上一版本的更新原因与更新内容。
