# Beecode 多端开发规范

> 状态：Active  
> 范围：Backend、CLI、Web、iOS，以及后续 Desktop、Android 等产品端  
> 更新日期：2026-08-13

## 1. 目标

本规范统一多端功能的设计、实现和验收流程。它不替代各阶段设计文档，也不要求每个端复制完整规则，而是建立三层约束：

1. 根 `AGENTS.md` 保存跨端强约束和 Skill 管理规则。
2. 本文保存跨端协作流程、契约变更顺序和交付标准。
3. `apps/<platform>/AGENTS.md` 只保存该应用的增量规则、Skill 路由和验证命令。

规则冲突时，先满足根规则；应用局部规则只能增加平台约束，不能放宽根规则或共享协议约束。

## 2. 开始任务前

每个实现任务按以下顺序获取上下文：

1. 读取根 `AGENTS.md` 和 `.agents/skills/INDEX.md`。
2. 读取目标应用最近的 `AGENTS.md`。
3. 判断变更是平台内部实现，还是会影响共享协议、认证、事件、持久化、Runtime 或 surface 隔离。
4. 只读取当前任务对应的阶段设计章节，不默认加载全部产品文档。
5. 按任务加载最小 Skill 集合；一个 Skill 已覆盖任务时，不为平台标签额外加载其他 Skill。

新增或缺少领域能力时，按照根规则使用 `find-skills` 搜索，并在安装前取得用户同意。

## 3. 架构边界

### 3.1 共享契约优先

以下内容属于共享契约，不能只在某个客户端私自定义：

- Session、Turn、Message、Part、ToolCall、Capability 和稳定错误。
- Agent 事件信封、事件顺序、终态和取消语义。
- OpenAPI Schema、`operationId`、认证方式和分页/幂等规则。
- surface 枚举、数据所有权和服务端隔离行为。

共享 TypeScript 契约以 `packages/protocol` 为准；公开 HTTP 行为必须同步体现在 OpenAPI 和契约测试中。平台可以建立自己的展示模型，但必须从共享 DTO 显式映射，不得改变服务端事实。

### 3.2 Surface 隔离

CLI、Web、iOS、Android 和 Desktop 使用同一账号与额度体系，但 Session 数据按 surface 隔离：

- 服务端根据认证客户端和路由固定 surface，不信任请求体指定或覆盖。
- 客户端只访问自己的 API/Transport 边界，不能复用另一端的 Cookie、Token 或路由伪装 surface。
- 新增列表、搜索、导出、同步或统计能力时，必须包含跨账号和跨 surface 的负向测试。

### 3.3 Runtime 与凭据

- CLI 与 Desktop 可拥有受控的本地 Runtime；Web 和移动端的 Agent Runtime 位于 Backend，除非新的阶段设计明确修改该决策。
- 所有模型访问都经过 Beecode Model Gateway。
- Provider 凭据只存在于 Backend，不进入浏览器、移动端、CLI 配置、日志或生成代码。
- 客户端不能自行把 Turn、Tool Call 或用量标记为成功；终态来自权威 Runtime/Backend。

## 4. 多端功能开发流程

一个影响共享能力的功能按纵向切片推进：

```text
需求与完成标准
  -> 共享领域模型 / OpenAPI / 事件语义
  -> Backend 与 Runtime 行为
  -> Client SDK 或平台网络包装层
  -> 目标端真实用户流程
  -> 契约、平台和端到端测试
  -> 使用与开发文档
```

具体要求：

1. 先定义用户可观察行为、错误和恢复语义，再修改 DTO 或路由。
2. 共享协议变更先更新 Schema 和兼容策略，再更新生产者与所有受影响消费者。
3. Backend 可以领先客户端半步，但同一个纵向切片结束时必须至少有一个真实客户端跑通，不以孤立接口或静态页面作为完成。
4. 优先做向后兼容的字段新增。删除、重命名、收紧验证或改变事件顺序时，必须列出迁移窗口和受影响端。
5. 每个客户端都从权威快照恢复状态；流式事件用于在线更新，不取代持久化事实。
6. 功能只在目标端可用时，由 Backend capability 明确表达；客户端不得根据版本号或失败结果猜测能力。

只涉及单端布局、交互或本地实现且不改变共享行为时，可以在端内完成，但仍需执行该端局部规范中的验证。

## 5. Skill 路由

Skill 按任务选择，不按端一次性全部加载。

| 任务 | 应加载的 Skill |
| --- | --- |
| 任意 `.ts` / `.tsx` 创建、修改或重构 | `typescript-coding-standards` |
| Hono 路由、中间件、验证、SSE 或 API 测试 | `hono` |
| React 组件、渲染、数据获取或性能 | `vercel-react-best-practices` |
| Web E2E、浏览器流程或 Playwright | `playwright-best-practices` |
| Web UI/无障碍规范审查 | `web-design-guidelines` |
| 对运行中的 Web 产品做完整交互 QA | `ux-audit` |
| 品牌页、落地页或展示型前端设计 | `design-taste-frontend` |
| SwiftUI 页面、导航、状态、无障碍或性能 | `swiftui-expert-skill` |
| iOS REST、SSE、认证、重试、分页或网络测试 | `ios-networking` |
| Swift async/await、Actor、Sendable、取消或 Swift 6 并发问题 | `swift-concurrency` |
| Swift Testing 单元或集成测试 | `swift-testing-pro` |
| 从已讨论需求形成 PRD/功能规格 | `to-spec` |
| Agent Loop、工具、上下文、多 Agent 等架构参考 | `reference-ai-superagent`，查看外部参考实现前先按根规则询问用户 |
| 当前索引没有对应能力 | `find-skills`，安装前先取得用户同意 |

示例：修改一个 SwiftUI 静态设置页只需 `swiftui-expert-skill`；实现通过 SSE 驱动的会话页通常需要 `swiftui-expert-skill`、`ios-networking` 和 `swift-concurrency`；只有同时编写 Swift Testing 测试时才加载 `swift-testing-pro`。

## 6. 测试与验收

测试遵守根 `AGENTS.md` 的独立目录规则。多端变更按风险选择以下层次：

- 协议测试：Schema、验证、稳定错误、事件和向后兼容行为。
- Backend 测试：认证、授权、surface 隔离、幂等、取消、持久化和 Runtime 生命周期。
- Client 测试：DTO 映射、状态投影、重连、取消、错误和本地存储。
- UI 测试：用户主流程、空态、加载态、失败态、恢复和无障碍。
- 端到端测试：至少跑通登录、创建 Session、提交 Turn、真实 Tool Call、完成和重新加载恢复。

共享行为发生变化时，不能只运行目标端测试；至少运行协议、Backend、受影响 SDK 和目标客户端测试。仓库全量 TypeScript 基线使用：

```bash
pnpm check
```

各应用的精确命令由其局部 `AGENTS.md` 维护。

## 7. 完成标准

多端功能只有同时满足以下条件才算完成：

- 行为与相关产品/阶段设计一致，未绕过既有架构边界。
- 共享契约、OpenAPI、SDK 和受影响端没有版本或语义漂移。
- 服务端强制认证、账号所有权和 surface 隔离。
- 加载、空、错误、取消、断线和恢复状态有明确行为。
- 对应层次的自动化测试通过，未执行的验证在交付说明中明确列出。
- 用户可见行为、配置或开发流程变化已同步更新文档。
- 没有把密钥、Token、用户内容或开发例外带入日志和发布配置。

## 8. 新平台接入

新增 Android、Desktop 或其他端时，在写生产代码前完成：

1. 创建阶段设计文档，确定 Runtime 位置、surface、认证、协议、存储、工具能力和恢复策略。
2. 创建 `apps/<platform>/AGENTS.md`，写明技术边界、必读文档、Skill 路由、测试目录、验证命令和禁止事项。
3. 在共享协议和 OpenAPI 中加入明确的 surface 与 capability，不复制另一端路由后只改客户端显示。
4. 建立该平台的独立测试目录和最小纵向端到端场景。
5. 更新根 `AGENTS.md` 的平台入口和本文相关路由。

局部规范应保持短小。跨端都适用的新规则应回收到根规则或本文，不在多个应用文件中重复维护。
