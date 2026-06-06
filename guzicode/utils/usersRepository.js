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
  return fallback;
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
      const error = new Error(result && result.message ? result.message : "用户服务调用失败");
      error.code = result && result.code ? result.code : "USER_FUNCTION_FAILED";
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

async function getUserById(userId) {
  if (!userId) {
    return null;
  }
  const result = await invokeAuth("getUserById", { userId });
  return result.user || null;
}

async function listUsers() {
  const result = await invokeAuth("listUsers");
  return result.users || [];
}

async function listConsignmentUsers() {
  const result = await invokeAuth("listConsignmentUsers");
  return result.users || [];
}

async function adminUpdateUserProfile(userId, { nickname, contactWechat, platformRate }) {
  const result = await invokeAuth("adminUpdateUserProfile", {
    userId,
    nickname,
    contactWechat,
    platformRate
  });
  return result.user || null;
}

async function adminToggleConsignPermission(userId, enabled) {
  const result = await invokeAuth("adminToggleConsignPermission", {
    userId,
    enabled
  });
  return result.user || null;
}

async function adminDeleteUsers(userIds) {
  const result = await invokeAuth("adminDeleteUsers", {
    userIds
  });
  return result.deletedUserIds || [];
}

module.exports = {
  adminDeleteUsers,
  adminToggleConsignPermission,
  adminUpdateUserProfile,
  getUserById,
  listConsignmentUsers,
  listUsers
};
