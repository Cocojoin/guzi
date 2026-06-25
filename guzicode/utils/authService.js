function extractErrorMessage(error, fallback = "操作失败，请稍后重试") {
  const message = String((error && (error.errMsg || error.message)) || "").trim();
  if (!message) {
    return fallback;
  }
  if (/FunctionName parameter could not be found|function not found|does not exist/i.test(message)) {
    return "云函数未部署，请先上传 auth 云函数";
  }
  if (/permission|auth|denied/i.test(message)) {
    return "暂无操作权限，请联系管理员";
  }
  if (/network|timeout|fail/i.test(message)) {
    return "网络异常，请稍后重试";
  }
  return message;
}

async function invokeAuth(action, data = {}) {
  try {
    const res = await wx.cloud.callFunction({
      name: "auth",
      data: {
        action,
        ...data
      }
    });
    const result = res && res.result ? res.result : null;
    if (!result || result.ok !== true) {
      const error = new Error(result && result.message ? result.message : "认证服务调用失败");
      error.code = result && result.code ? result.code : "AUTH_FUNCTION_FAILED";
      throw error;
    }
    return result;
  } catch (error) {
    if (!error.userMessage) {
      error.userMessage = extractErrorMessage(error);
    }
    throw error;
  }
}

async function login(account, password) {
  const result = await invokeAuth("login", { account, password });
  return result.user;
}

async function register(account, password) {
  const result = await invokeAuth("register", { account, password });
  return result.user;
}

async function updateProfile(userId, nickname, avatarUrl) {
  const result = await invokeAuth("updateProfile", { userId, nickname, avatarUrl });
  return result.user;
}

async function changePassword(userId, oldPassword, newPassword) {
  await invokeAuth("changePassword", { userId, oldPassword, newPassword });
}

async function adminResetPassword(requesterUserId, targetUserId, nextPassword = "123456") {
  await invokeAuth("adminResetPassword", {
    requesterUserId,
    targetUserId,
    nextPassword
  });
}

module.exports = {
  adminResetPassword,
  changePassword,
  login,
  register,
  updateProfile
};
