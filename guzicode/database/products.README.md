# products 表初始化说明

## 1. 目录说明

- `products.schema.json`：`products` 表字段设计说明
- `products.init.json`：初始化数据数组格式
- `products.init.jsonl`：微信云开发导入用 JSON Lines 格式
- `products.init.import.json`：微信开发者工具可直接选择的 JSON Lines 导入文件
- `products.indexes.json`：索引建议

## 2. 在微信开发者工具中创建 `products` 表

1. 打开微信开发者工具并确认云开发环境
2. 进入「云开发」>「数据库」
3. 新建集合，名称填写 `products`
4. 参考 `products.schema.json` 创建字段结构
5. 参考 `products.indexes.json` 创建索引，至少保证 `id` 唯一

关键字段说明：

| 字段名 | 类型 | 说明 |
| --- | --- | --- |
| id | String | 商品业务编号，唯一（如 A00128） |
| owner | String | 寄售用户昵称 |
| ip | String | IP 名称 |
| role | String | 角色名称 |
| series | String | 系列名称 |
| type | String | 商品类型 |
| customType | String | 自定义类型 |
| price | Number | 价格 |
| quality | String | `clean` / `flaw` |
| status | String | `up` / `down` / `sold` / `settled` |
| totalQuantity | Number | 总数量 |
| soldCount | Number | 已售出数量 |
| settledCount | Number | 已结算数量 |
| listedDays | Number | 上架天数 |
| purchaseRecord | String | `有` / `无` |
| images | Array | 图片地址数组 |
| links | Array | 平台链接数组（`platform`,`url`） |
| remark | String | 备注 |
| createdAt | Date | 创建时间 |
| updatedAt | Date | 更新时间 |

## 3. 导入初始化数据

1. 选中 `products` 集合点击「导入」
2. 优先选择 `database/products.init.import.json`
3. 若导入器要求数组格式，则改用 `database/products.init.json`

## 4. 与现有代码对应关系

当前小程序商品管理页与仓库工具基于这些字段工作：

- `utils/productsRepository.js`：增删改查与状态统计
- `utils/productPresentation.js`：展示状态、质量、价格、剩余数量
- `admin/pages/goods/*`：上传、编辑、批量操作等页面

