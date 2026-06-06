# AI 接入说明

当前项目通过后端代理接入 `claude-opus-4-7`，小程序前端不保存 API Key。

## 代理服务

代理服务文件：

- `server/ai-proxy.js`

环境变量示例：

- `server/.env.example`

需要配置的变量：

| 变量 | 说明 |
| --- | --- |
| AIPRO_BASE_URL | AI 服务 Base URL |
| AIPRO_API_KEY | AI 服务 API Key |
| AIPRO_MODEL | 模型名称，当前使用 claude-opus-4-7 |
| AI_PROXY_PORT | 本地代理端口，默认 8787 |
| AI_PROXY_HOST | 本地代理监听地址，默认 127.0.0.1 |

## 小程序调用

小程序调用封装：

- `utils/aiClient.js`

调用示例：

```js
const { chatWithAI } = require('../../utils/aiClient');

chatWithAI({
  prompt: '帮我生成一段商品描述'
}).then((res) => {
  console.log(res.content);
});
```

## 注意事项

1. 不要把 API Key 写入小程序页面、`app.js` 或任何会被打包到前端的文件。
2. 开发者工具本地调试时，需要在“详情 -> 本地设置”里允许不校验合法域名。
3. 正式发布时，应把 `server/ai-proxy.js` 部署到自己的后端服务，并把 `utils/aiClient.js` 里的地址改成正式后端域名。
