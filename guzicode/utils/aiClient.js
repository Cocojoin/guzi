const AI_PROXY_URL = 'http://127.0.0.1:8787/api/ai/chat';

function chatWithAI(options) {
  const messages = options.messages || [
    {
      role: 'user',
      content: options.prompt || ''
    }
  ];

  return new Promise((resolve, reject) => {
    wx.request({
      url: AI_PROXY_URL,
      method: 'POST',
      data: {
        messages,
        temperature: options.temperature,
        max_tokens: options.maxTokens
      },
      header: {
        'content-type': 'application/json'
      },
      success(response) {
        if (response.statusCode >= 200 && response.statusCode < 300) {
          resolve(response.data);
          return;
        }

        reject(new Error(response.data?.error || 'AI 请求失败'));
      },
      fail(error) {
        reject(error);
      }
    });
  });
}

module.exports = {
  chatWithAI
};
