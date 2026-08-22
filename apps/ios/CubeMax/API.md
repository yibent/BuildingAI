# CubeMax iOS API 契约

CubeMax 使用原生 `URLSession` 调用 BuildingAI Web API。默认地址为生产环境的
`https://max.sh.creativone.cn/api`。登录页不直接显示服务器输入框；连续点击星球标识 5 次后可打开开发者服务器设置。真机调试建议使用局域网 HTTPS 地址。

## 请求约定

- 除登录、公开回调外，发送 `Authorization: Bearer <token>`。
- 所有已登录请求发送 `X-Installation-Id`（Keychain 中的小写 UUID，登出不删除）。
- 当前组织工作区通过 `x-organization-id` 发送；个人空间不发送该请求头。
- 服务端通常返回 `{ "code": 0, "message": "ok", "data": ... }`。客户端也接受直接返回的
  `data`，便于兼容旧接口。
- 401 时客户端清除 Keychain token 并回到登录页。

## 认证与工作区

| 方法 | 路径                     | 说明                                                                     |
| ---- | ------------------------ | ------------------------------------------------------------------------ |
| POST | `/auth/login`            | `{ username, password, terminal: 4 }`，返回 `token`、`expiresAt`、`user` |
| GET  | `/user/info`             | 当前用户信息                                                             |
| POST | `/auth/logout`           | 撤销当前 token                                                           |
| GET  | `/organizations/context` | 个人空间和组织工作区列表                                                 |

## 触发器与工程

| 方法   | 路径                                        | 说明                                   |
| ------ | ------------------------------------------- | -------------------------------------- |
| GET    | `/programming-triggers?page=1&pageSize=100` | 当前用户的触发器                       |
| GET    | `/programming-triggers/:id`                 | 触发器详情和表单 JSON Schema           |
| POST   | `/programming-triggers`                     | 创建表单触发器                         |
| PATCH  | `/programming-triggers/:id`                 | 修改启用、置顶和名称                   |
| DELETE | `/programming-triggers/:id`                 | 删除触发器                             |
| POST   | `/programming-triggers/:id/execute`         | `{ inputs: { ... } }`，返回运行任务 ID。含摄像头节点时需已连接 Mobile WS |
| GET    | `/programming-projects?page=1&pageSize=100` | 创建触发器时选择已发布工程             |

表单字段直接来自工程主流程 `start` 节点的输入 Schema。客户端支持
`string`、`integer`、`number`、`boolean`、`object`、`array`、`enum`、默认值和必填校验。

## 手机摄像头

登录成功后客户端连接 `wss://{host}/api/mobile-ws/v1`（由 API base URL 推导：`https` → `wss`，`http` → `ws`）。Upgrade 请求携带 `Authorization` 与 `X-Installation-Id`。hello 的 `capabilities` 固定为 `["camera.photo"]`。

拍照像素**不走 WebSocket**。服务器下发 `camera.capture` 后，App 截取当前预览 JPEG，上传：

`POST /mobile/camera/captures` multipart 字段 `file`，文本字段 `session_id`、`capture_id`、`sha256`、`facing`。

工作流节点拿到的 `imageUrl` 是短时 HMAC 地址：

`GET /mobile/camera/files/:fileId?exp=&sig=`（无需用户 JWT，过期 410）。

完整协议见仓库 `docs/mobile-camera-websocket-protocol.md`。`GET /mobile/config` 返回 `{ cameraEnabled: true }`（摄像头默认启用）。

## 对话

| 方法 | 路径                                                 | 说明                                                     |
| ---- | ---------------------------------------------------- | -------------------------------------------------------- |
| GET  | `/ai-conversations?page=1&pageSize=50`               | 对话列表                                                 |
| POST | `/ai-conversations`                                  | 创建对话                                                 |
| GET  | `/ai-conversations/:id/info`                         | 对话信息                                                 |
| GET  | `/ai-conversations/:id/messages?page=1&pageSize=100` | 消息列表                                                 |
| POST | `/ai-chat`                                           | AI SDK data stream；客户端解析 `data:` 行中的 text delta |

`/ai-chat` 请求需要 `modelId`（UUID）和 `messages`。客户端会优先使用已有对话的
`modelId`，新对话可在对话页输入默认模型 ID。

## Home Assistant 智能家居

连接配置在网页设置中完成（HA 地址 + 长期访问令牌或账号密码）。App 只负责浏览设备和灯光/开关控制。

| 方法   | 路径                                              | 说明                         |
| ------ | ------------------------------------------------- | ---------------------------- |
| GET    | `/smart-home/ha/instance`                         | 当前用户的 HA 连接，可能为 null |
| POST   | `/smart-home/ha/instance/sync`                    | 同步实体快照                   |
| GET    | `/smart-home/ha/devices`                          | 当前用户全部设备               |
| GET    | `/smart-home/ha/devices/:deviceId`                | 设备详情                     |
| POST   | `/smart-home/ha/devices/:deviceId/refresh`        | 刷新设备状态                 |
| POST   | `/smart-home/ha/devices/:deviceId/command`        | `{ on, brightness, color, colorTemp }` |

灯光控制优先：亮度 1–100，颜色为 `#rrggbb`，色温为 Kelvin。开关仅支持 `on`。

## CubeCat 设备管理

xiaozhi.me 账号属于组织资产，只允许老师、团队管理员或组织管理者在网页端的“讲台 > 设备管理”中绑定、重连、同步和移除。学生端不提供账号绑定，也不会取得账号信息；老师或管理员分配设备后，“我的 > 我的方糖猫”会自动展示当前团队中分配给该学生的设备。

方糖猫资产与正在开发的 Lua/ESP 设备网关是两套独立模型，iOS 的方糖猫页面不会读取 `/devices`
或展示 Lua 执行记录。

| 方法  | 路径                                                                   | 说明                           |
| ----- | ---------------------------------------------------------------------- | ------------------------------ |
| GET   | `/organizations/xiaozhi/devices`                                       | 当前工作空间可访问的全部方糖猫 |
| GET   | `/ai-agents/my-created?page=1&pageSize=100`                            | 切换设备智能体时的候选列表     |
| PATCH | `/organizations/xiaozhi/agents/:agentId/building-agent`                | 快捷切换 BuildingAI 智能体     |
| PATCH | `/organizations/xiaozhi/agents/:agentId/devices/:deviceId/alias`       | 修改设备名称                   |
| PATCH | `/organizations/xiaozhi/agents/:agentId/devices/:deviceId/settings`    | 保存音量、亮度和勿扰偏好       |
| PATCH | `/organizations/xiaozhi/agents/:agentId/devices/:deviceId/auto-update` | 修改自动升级设置               |

设备型号 `CubeCat-Lite` / `CubeCat-S` 由老师或组织管理员在网页端指定。账号管理接口要求
`x-organization-id`
和组织资产管理权限；设备查询接口则按组织权限或分配关系过滤。多个设备可属于同一个 xiaozhi 智能体组，切换智能体时该组设备会共同生效。
