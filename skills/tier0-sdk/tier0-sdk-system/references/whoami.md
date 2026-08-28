---
name: tier0-sdk-auth-whoami
version: 0.2.0
description: "SDK 调用 auth whoami — 仅诊断支持该能力的 API Key 凭证上下文；App API Key 是业务 Key，不能用于识别 App 当前用户"
---

# auth whoami — API Key 身份诊断

用于排查支持该能力的 API Key 绑定到了哪个用户或服务主体、Workspace，以及具备哪些角色和权限。

> `auth/whoami` 只用于凭证诊断，不是调用其他 API 的前置步骤，也不是应用的“当前用户”接口。

## App API Key 边界

App API Key 是应用服务端使用的共享业务凭证，不代表正在访问应用的自然人。因此：

- App API Key 查询不到当前访问用户的身份，不应使用 `auth/whoami` 实现登录、鉴权、个性化展示、操作人审计或通知收件人选择。
- 当前 App 用户必须来自应用自身的登录与会话层，例如 scaffold 中的 `requireAuth()`。
- Tier0 接口需要 `userId` 时，通过 Project 或 Workspace 的成员列表，把当前会话用户或用户选择的人按姓名、邮箱等信息匹配为内部 `userId`；用户不填写也不感知该 ID。
- App API Key 调用 `whoami` 无返回、返回不支持或返回凭证主体信息时，不得把结果解释为当前 App 用户。

保留此接口是为了个人 API Key、CLI 和运维场景中的凭证诊断。不要从 SDK 删除该底层能力。

## API

```
POST /openapi/v1/auth/whoami
```

## 请求参数

无需业务参数，传空对象即可。

## SDK 调用示例

```typescript
import { systemApi } from '@tier0/sdk/openapi';

const result = await systemApi.openapiv1authwhoami();
console.log(result);
```

## 响应结构

```json
{
  "code": 200,
  "msg": "ok",
  "data": {
    "userID": 1,
    "userName": "agent",
    "email": "agent@example.com",
    "workspaceID": 1001,
    "workspaceName": "Default",
    "apiKeyName": "agent-key",
    "keyPrefix": "sk-per",
    "permissions": ["full_access"],
    "roles": ["admin"],
    "keyType": "personal"
  }
}
```

## 排查规则

1. `workspaceID` / `workspaceName` 用来确认当前 key 是否绑定到目标 Workspace。
2. `permissions` 用来确认 key 是否具备目标接口所需权限；`full_access` 可访问所有 OpenAPI 资源。
3. `keyType` 用来区分 personal / service 等 key 类型。
4. 如果接口返回 401，先检查 `configureClient` 里的 apiKey 是否正确、`apiHost` 是否可达。
5. 如果运行在 App 内，不以 `userID`、`userName` 或 `email` 作为当前 App 用户；改用 App 会话。
6. 当前 OpenAPI 契约把 `userID` 和 `workspaceID` 暴露为 JavaScript `number`。不要把它们转成其他接口需要的字符串 ID，也不要作为业务关系持久化；大整数可能已经丢失精度。
