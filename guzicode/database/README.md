# users 表初始化说明

## 1. 目录说明

- `users.schema.json`：`users` 表字段设计说明
- `users.init.json`：初始化数据数组格式，当前包含 1 条管理员账号
- `users.init.jsonl`：微信云开发导入用 JSON Lines 格式，当前包含 1 条管理员账号
- `users.init.import.json`：微信开发者工具可选择的 JSON Lines 导入文件，当前包含 1 条管理员账号
- `users.indexes.json`：索引建议，包含账号唯一索引

## 2. 在微信开发者工具中创建 `users` 表

1. 打开微信开发者工具
2. 确认当前项目已开通云开发，并绑定正确环境
3. 进入「云开发」面板
4. 打开「数据库」
5. 新建集合，名称填写 `users`
6. 将 `users.schema.json` 作为字段设计参考，按字段创建集合结构
7. 参考 `users.indexes.json` 创建索引，至少保证 `account` 为唯一索引

建议创建完成后确认字段包含：

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| account | String | 登录账号，唯一 |
| nickname | String | 用户昵称 |
| password | String | 登录密码明文，由云函数侧校验 |
| role | String | `admin` / `consignment_user` / `normal_user` |
| isAgentEnabled | Boolean | 是否开启代理权限 |
| platformRate | Number / Null | 平台抽成比例 |
| commissionRate | Number / Null | 代理佣金比例 |
| contactWechat | String | 微信联系方式 |
| contactMobile | String | 手机号联系方式 |
| avatarUrl | String | 头像地址 |
| status | String | `active` / `disabled` |
| createdAt | Date | 创建时间 |
| updatedAt | Date | 更新时间 |

## 3. 导入初始化数据

1. 在数据库中选中 `users` 集合
2. 点击「导入」
3. 优先选择 `database/users.init.import.json`
   - 这个文件是 `.json` 后缀，但内容是微信导入需要的 JSON Lines 格式
   - 如果导入面板明确选择 JSON Lines 格式，选择 JSON Lines
   - 如果导入面板明确选择 JSON 数组格式，才使用 `users.init.json`
4. 完成导入后，会创建管理员账号：
   - 账号：`admin`
   - 初始密码：`cc19980905`
   - 存储方式：明文

## 4. 集合权限

当前认证链路已切到 `auth` 云函数处理：

- 注册：云函数创建普通用户并绑定当前微信 `openid`
- 登录：云函数校验账号状态、密码并回写 `lastLoginAt`
- 资料保存：云函数校验当前 `openid` 后更新 `nickname`、`avatarUrl`
- 改密 / 管理员重置密码：云函数校验登录态后执行
- 用户资料读取、寄售用户列表、管理员用户管理：统一由云函数返回必要字段

前端不再直接读取或校验 `password` 字段。开发联调阶段仍可使用数据库测试权限做普通资料查询，但上线前应继续收紧 `users` 集合权限，只保留云函数可写。

### 推荐权限设置

`users` 集合建议在微信云开发控制台中改为：

- 仅创建者可读：关闭
- 所有用户可读：关闭
- 仅创建者可写：关闭
- 所有用户可写：关闭

即：前端页面不直接读写 `users`，统一只允许云函数访问。

如果当前仍处于联调期，可短暂保留测试权限；但在真机验收通过后，建议立即切回上述配置。

## 5. 字段补充说明

1. 前台注册用户默认写入：
   - `role = normal_user`
   - `isAgentEnabled = false`
   - `status = active`
2. 寄售用户升级后，可更新：
   - `role = consignment_user`
   - `platformRate`
3. 代理不是独立角色，而是管理员赋予用户的附加权限，可填写：
   - `isAgentEnabled = true`
   - `commissionRate`
4. `password` 当前初始化示例为明文；若后续重新启用加密，需要同步迁移历史数据和云函数逻辑。
