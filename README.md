# Beecode AI

Beecode 当前包含本地 CLI Agent Runtime、Hono Backend、React Web Agent 工作台，以及正在进入业务开发的原生 iOS 工程。CLI 与 Web 共用账号和额度，但 Session 按 `surface` 严格隔离；Web Runtime 只开放后端安全工具，目前为 `calculator`。iOS 当前完成 Slice 0 工程与测试基线，尚未接入账号、Session 和 Agent Runtime。

- [Web 使用文档](docs/usage/web.md)
- [CLI 使用文档](docs/usage/cli.md)
- [多端开发规范](docs/development/platform-development-guidelines.md)
- [第二阶段 Web 开发设计](docs/development/phase-2-web-development-design.md)
- [第三阶段 iOS 原生开发设计](docs/development/phase-3-ios-development-design.md)
- [产品规格](docs/product/beecode-product-spec.md)

本地启动：

```bash
pnpm install --frozen-lockfile
pnpm backend
# 新终端
pnpm web
```

访问 `http://127.0.0.1:5173`，使用本地 development identity 登录。CLI 使用同一浏览器账号授权：

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
