const SESSION_KEYS = {
  userId: "currentUserId",
  account: "currentUserAccount",
  role: "currentUserRole"
};

function setSession({ userId, account, role }) {
  wx.setStorageSync(SESSION_KEYS.userId, userId);
  wx.setStorageSync(SESSION_KEYS.account, account);
  wx.setStorageSync(SESSION_KEYS.role, role);
}

function getSession() {
  const userId = wx.getStorageSync(SESSION_KEYS.userId);
  const account = wx.getStorageSync(SESSION_KEYS.account);
  const role = wx.getStorageSync(SESSION_KEYS.role);

  if (!userId || !account || !role) {
    return null;
  }

  return {
    userId,
    account,
    role
  };
}

function clearSession() {
  wx.removeStorageSync(SESSION_KEYS.userId);
  wx.removeStorageSync(SESSION_KEYS.account);
  wx.removeStorageSync(SESSION_KEYS.role);
}

function getHomePathByRole(role) {
  if (role === "admin") {
    return "/admin/pages/goods/list/list";
  }
  return "/user/pages/goods/list/list";
}

module.exports = {
  SESSION_KEYS,
  setSession,
  getSession,
  clearSession,
  getHomePathByRole
};
