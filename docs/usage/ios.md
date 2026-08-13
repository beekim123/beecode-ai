# Beecode iOS 开发与真机体验

当前 iOS 客户端完成第三阶段 Slice 0-Slice 3：原生 SwiftUI 壳、OAuth/PKCE、Keychain 凭据、Bearer API 和 `surface=ios` Session 管理。Conversation、Turn、Tool Call、SSE reducer、前后台恢复和断网重连属于后续 Slice 4-Slice 5。

## Simulator

在仓库根目录执行：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/ios/DerivedData \
  CODE_SIGNING_ALLOWED=NO build
```

Debug 默认访问 `http://127.0.0.1:8787`。模拟器与 Backend 在同一台 Mac 上时可以使用这个地址。UI 自动化可传入 `--ui-testing-signed-in`，跳过真实登录并验证 Session shell。

## 真机前置条件

1. 在 Xcode 中为 App 和测试 target 配置 Apple Developer Team，并替换 `ai.beecode.ios` 为已注册的正式 Bundle ID。
2. 在 `apps/ios/Config/Debug.xcconfig` 或用户本地 xcconfig 中设置 `BEECODE_API_BASE_URL` 为真机可访问的 Backend 地址，例如 `http://192.168.1.20:8787`。真机不能使用 `127.0.0.1`，它指向手机本身。
3. 确认手机与 Backend 位于同一局域网，Backend 监听地址不是仅绑定 loopback，并允许 macOS 防火墙入站连接。
4. 将 Backend 的 `publicBaseUrl`、OAuth `beecode-ios` client 和 `ai.beecode.ios://oauth/callback` 精确登记为同一组环境值。回调 URI 的 scheme、host、path 任一部分不一致都会拒绝授权码交换。
5. Debug 配置使用本地网络 ATS 例外；Release 不允许 HTTP，必须使用 HTTPS API 地址和正式域名 allowlist。
6. 在真机上首次登录时允许本地网络访问；不要把 Token、PKCE verifier 或授权回调写入日志或测试附件。

真机运行命令示例：

```bash
xcodebuild \
  -project apps/ios/Beecode.xcodeproj \
  -scheme Beecode \
  -configuration Debug \
  -destination 'platform=iOS,id=<device-udid>' \
  -derivedDataPath apps/ios/DerivedData \
  build
```

第三阶段真机可验证登录和 Session 管理；不能据此宣称 Agent 对话闭环已经完成。进入 Slice 4 后，再使用受控 Backend/Model Gateway 验证“计算 1+1”、Tool 状态和实时事件。

## OpenAPI 生成包

OpenAPI 输入由 Backend/Protocol 单一来源生成：

```bash
pnpm ios:openapi
```

生成产物在 `apps/ios/Packages/BeecodeAPI/`。App 当前通过稳定的 `BeecodeClient` 包装层运行，生成包暂未加入 Xcode App target；更新生成器或接入 target 前，应在网络可稳定完成依赖解析的环境生成并提交 SwiftPM `Package.resolved`，再检查生成 diff。当前自有版本清单与 `Package.swift` 一致，只固定 Generator 和 Runtime；尚未使用 `swift-openapi-urlsession`。
