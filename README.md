# Beecode AI

Beecode 当前包含本地 CLI Agent Runtime、Hono Backend、React Web Agent 工作台、进入 Slice 4 的 Electron Desktop，以及正在进入业务开发的原生 iOS 工程。各客户端共用账号和额度，但 Session 按 `surface` 严格隔离；CLI、Web 和 Desktop 支持 `calculator` 与受限只读 Workspace `read_file`。Web 通过浏览器目录句柄按工具请求读取单个文件，CLI/Desktop 由本地 Runtime 直接访问授权目录。iOS 当前完成 Slice 0 工程与测试基线，尚未接入账号、Session 和 Agent Runtime。

- [Web 使用文档](docs/usage/web.md)
- [CLI 使用文档](docs/usage/cli.md)
- [Desktop 使用文档](docs/usage/desktop.md)
- [多端开发规范](docs/development/platform-development-guidelines.md)
- [第二阶段 Web 开发设计](docs/development/phase-2-web-development-design.md)
- [第三阶段 iOS 原生开发设计](docs/development/phase-3-ios-development-design.md)
- [第四阶段 Desktop 开发设计](docs/development/phase-4-desktop-development-design.md)
- [产品规格](docs/product/beecode-product-spec.md)

本地启动：

```bash
pnpm install --frozen-lockfile
pnpm backend
# 新终端
pnpm web
# 再开一个终端启动 Desktop
pnpm --filter @beecode/desktop start
```

访问 `http://127.0.0.1:5173`，使用本地 development identity 登录。Desktop 点击“登录”后也通过该 Web 页面完成浏览器授权；完整步骤见 [Desktop 使用文档](docs/usage/desktop.md)。CLI 使用同一浏览器账号授权：

```bash
pnpm --filter @beecode/cli start login
pnpm cli
```

质量检查：

```bash
pnpm check
pnpm test:e2e
```

iOS 工程位于 `apps/ios/Beecode.xcodeproj`。无需签名的 Simulator SDK 构建：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO \
  build
```
