const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const USERS_COLLECTION = "users";

function normalizePasswordInput(password) {
  return String(password == null ? "" : password);
}

function hashPassword(password) {
  return normalizePasswordInput(password);
}

function verifyPassword(plainPassword, storedPassword) {
  const plain = normalizePasswordInput(plainPassword);
  const stored = normalizePasswordInput(storedPassword);
  return !!stored && stored === plain;
}

function ok(extra = {}) {
  return { ok: true, ...extra };
}

function fail(code, message) {
  return { ok: false, code, message };
}

async function getUserByAccount(account) {
  const res = await db.collection(USERS_COLLECTION).where({ account }).limit(1).get();
  return (res.data || [])[0] || null;
}

async function getUserByOpenId(openid) {
  if (!openid) {
    return null;
  }
  const res = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get();
  return (res.data || [])[0] || null;
}

async function getUserById(userId) {
  if (!userId) {
    return null;
  }
  const res = await db.collection(USERS_COLLECTION).doc(userId).get();
  return res.data || null;
}

async function queryAllUsers(whereBuilder = null) {
  const list = [];
  const pageSize = 100;
  let skip = 0;

  while (true) {
    let query = db.collection(USERS_COLLECTION);
    if (typeof whereBuilder === "function") {
      query = whereBuilder(query);
    }
    const res = await query.skip(skip).limit(pageSize).get();
    const rows = res.data || [];
    list.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return list;
}

function sanitizeUser(user, options = {}) {
  if (!user) {
    return null;
  }
  const sanitized = {
    _id: user._id,
    account: user.account,
    role: user.role,
    nickname: user.nickname || "",
    status: user.status || "active",
    isAgentEnabled: !!user.isAgentEnabled
  };
  if (options.includeProfile === true) {
    sanitized.avatarUrl = user.avatarUrl || "";
    sanitized.contactWechat = user.contactWechat || "";
    sanitized.contactMobile = user.contactMobile || "";
    sanitized.platformRate = user.platformRate == null ? null : Number(user.platformRate);
    sanitized.commissionRate = user.commissionRate == null ? null : Number(user.commissionRate);
    sanitized.lastLoginAt = user.lastLoginAt || null;
    sanitized.createdAt = user.createdAt || null;
    sanitized.updatedAt = user.updatedAt || null;
  }
  if (options.includePassword === true) {
    sanitized.password = user.password || "";
  }
  return sanitized;
}

async function requireRequester(openid) {
  if (!openid) {
    return null;
  }
  return getUserByOpenId(openid);
}

async function requireAdmin(openid) {
  const requester = await requireRequester(openid);
  if (!requester) {
    return fail("AUTH_MISMATCH", "管理员登录态已失效，请重新登录");
  }
  if (requester.role !== "admin") {
    return fail("FORBIDDEN", "仅管理员可执行此操作");
  }
  return requester;
}

function validateNickname(value) {
  const nickname = String(value || "").trim();
  if (!nickname) {
    return "请输入昵称";
  }
  if (!/^[\u4e00-\u9fa5A-Za-z0-9]+$/.test(nickname)) {
    return "昵称仅支持中文、英文或数字";
  }
  if (nickname.length > 12) {
    return "昵称不能超过12个字";
  }
  return "";
}

async function handleLogin({ account, password }, openid) {
  const user = await getUserByAccount(String(account || "").trim());
  if (!user) {
    return fail("ACCOUNT_NOT_FOUND", "账号不存在，请先注册");
  }
  if (user.status === "disabled") {
    return fail("ACCOUNT_DISABLED", "账号已被禁用，请联系管理员");
  }
  
  if (!verifyPassword(password, user.password)) {
    return fail("PASSWORD_INCORRECT", "密码错误，请重新输入");
  }

  const nextData = {
    lastLoginAt: new Date(),
    updatedAt: new Date()
  };
  if (openid && user.openid !== openid) {
    nextData.openid = openid;
  }

  await db.collection(USERS_COLLECTION).doc(user._id).update({ data: nextData });
  return ok({ user: sanitizeUser({ ...user, ...nextData }) });
}

async function handleRegister({ account, password }, openid) {
  const normalizedAccount = String(account || "").trim();
  const normalizedPassword = String(password || "");
  if (!normalizedAccount || !normalizedPassword) {
    return fail("INVALID_PARAMS", "账号或密码不能为空");
  }

  const existing = await getUserByAccount(normalizedAccount);
  if (existing) {
    return fail("ACCOUNT_EXISTS", "账号已存在，请更换账号");
  }

  const now = new Date();
  const res = await db.collection(USERS_COLLECTION).add({
    data: {
      account: normalizedAccount,
      nickname: "",
      password: hashPassword(normalizedPassword),
      role: "normal_user",
      isAgentEnabled: false,
      platformRate: null,
      commissionRate: null,
      contactWechat: "",
      contactMobile: "",
      avatarUrl: "",
      status: "active",
      lastLoginAt: null,
      openid: openid || "",
      createdAt: now,
      updatedAt: now
    }
  });

  return ok({
    user: {
      _id: res._id,
      account: normalizedAccount,
      role: "normal_user",
      nickname: "",
      status: "active",
      isAgentEnabled: false
    }
  });
}

async function handleUpdateProfile({ userId, nickname, avatarUrl }, openid) {
  const normalizedUserId = String(userId || "").trim();
  const user = await getUserById(normalizedUserId);
  if (!user) {
    return fail("USER_NOT_FOUND", "用户不存在");
  }
  if (!openid || user.openid !== openid) {
    return fail("AUTH_MISMATCH", "登录态已失效，请重新登录");
  }

  const nicknameError = validateNickname(nickname);
  if (nicknameError) {
    return fail("INVALID_NICKNAME", nicknameError);
  }

  const nextAvatarUrl = String(avatarUrl || "").trim();
  await db.collection(USERS_COLLECTION).doc(user._id).update({
    data: {
      nickname: String(nickname).trim(),
      avatarUrl: nextAvatarUrl,
      updatedAt: new Date()
    }
  });

  return ok({
    user: sanitizeUser({
      ...user,
      nickname: String(nickname).trim(),
      avatarUrl: nextAvatarUrl
    }, { includeProfile: true })
  });
}

async function handleGetUserById({ userId }, openid) {
  const normalizedUserId = String(userId || "").trim();
  const targetUser = await getUserById(normalizedUserId);
  if (!targetUser) {
    return ok({ user: null });
  }

  const requester = await requireRequester(openid);
  const isSelf = !!requester && requester._id === targetUser._id;
  const isAdmin = !!requester && requester.role === "admin";

  if (!isSelf && !isAdmin) {
    return fail("FORBIDDEN", "暂无操作权限，请联系管理员");
  }

  return ok({
    user: sanitizeUser(targetUser, { includeProfile: true })
  });
}

async function handleListConsignmentUsers(_, openid) {
  const admin = await requireAdmin(openid);
  if (admin && admin.ok === false) {
    return admin;
  }

  const command = db.command;
  const rows = await queryAllUsers((query) => query.where(
    command.and([
      command.or([
        { role: "consignment_user" },
        { isAgentEnabled: true }
      ]),
      {
        status: command.neq("disabled")
      }
    ])
  ));

  return ok({
    users: rows
      .map((item) => sanitizeUser(item, { includeProfile: true }))
      .map((item) => ({
        ...item,
        nickname: String(item.nickname || "").trim() || String(item.account || "").trim()
      }))
      .filter((item) => item.nickname)
  });
}

async function handleListUsers({ includePassword } = {}, openid) {
  const admin = await requireAdmin(openid);
  if (admin && admin.ok === false) {
    return admin;
  }

  const rows = await queryAllUsers();
  return ok({
    users: rows
      .filter((item) => item.role !== "admin")
      .map((item) => sanitizeUser(item, {
        includeProfile: true,
        includePassword: includePassword === true
      }))
  });
}

async function handleAdminUpdateUserProfile({ userId, nickname, contactWechat, platformRate }, openid) {
  const admin = await requireAdmin(openid);
  if (admin && admin.ok === false) {
    return admin;
  }

  const normalizedUserId = String(userId || "").trim();
  const targetUser = await getUserById(normalizedUserId);
  if (!targetUser) {
    return fail("USER_NOT_FOUND", "用户不存在");
  }

  const nicknameError = validateNickname(nickname);
  if (nicknameError) {
    return fail("INVALID_NICKNAME", nicknameError);
  }

  const normalizedContactWechat = String(contactWechat || "").trim();
  const updateData = {
    nickname: String(nickname).trim(),
    contactWechat: normalizedContactWechat,
    updatedAt: new Date()
  };

  if (targetUser.role === "consignment_user" || targetUser.isAgentEnabled) {
    const parsedRate = platformRate == null || platformRate === "" ? null : Number(platformRate);
    if (parsedRate != null && (!Number.isFinite(parsedRate) || parsedRate < 0 || parsedRate > 1)) {
      return fail("INVALID_PLATFORM_RATE", "抽成比例不合法");
    }
    updateData.platformRate = parsedRate;
  }

  await db.collection(USERS_COLLECTION).doc(targetUser._id).update({ data: updateData });
  return ok({
    user: sanitizeUser({
      ...targetUser,
      ...updateData
    }, { includeProfile: true })
  });
}

async function handleAdminToggleConsignPermission({ userId, enabled }, openid) {
  const admin = await requireAdmin(openid);
  if (admin && admin.ok === false) {
    return admin;
  }

  const normalizedUserId = String(userId || "").trim();
  const targetUser = await getUserById(normalizedUserId);
  if (!targetUser) {
    return fail("USER_NOT_FOUND", "用户不存在");
  }

  await db.collection(USERS_COLLECTION).doc(targetUser._id).update({
    data: {
      isAgentEnabled: !!enabled,
      updatedAt: new Date()
    }
  });

  return ok({
    user: sanitizeUser({
      ...targetUser,
      isAgentEnabled: !!enabled,
      updatedAt: new Date()
    }, { includeProfile: true })
  });
}

async function handleAdminDeleteUsers({ userIds }, openid) {
  const admin = await requireAdmin(openid);
  if (admin && admin.ok === false) {
    return admin;
  }

  const ids = Array.isArray(userIds)
    ? userIds.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!ids.length) {
    return fail("INVALID_PARAMS", "请选择要删除的用户");
  }

  const targets = await Promise.all(ids.map((id) => getUserById(id)));
  const validTargets = targets.filter(Boolean).filter((item) => item.role !== "admin");
  await Promise.all(validTargets.map((item) => db.collection(USERS_COLLECTION).doc(item._id).remove()));

  return ok({
    deletedUserIds: validTargets.map((item) => item._id)
  });
}

async function handleChangePassword({ userId, oldPassword, newPassword }, openid) {
  const user = await getUserById(String(userId || "").trim());
  if (!user) {
    return fail("USER_NOT_FOUND", "用户不存在");
  }
  if (!openid || user.openid !== openid) {
    return fail("AUTH_MISMATCH", "登录态已失效，请重新登录");
  }
  
  if (!verifyPassword(oldPassword, user.password)) {
    return fail("PASSWORD_INCORRECT", "原密码错误，请重新输入");
  }

  await db.collection(USERS_COLLECTION).doc(user._id).update({
    data: {
      password: hashPassword(newPassword),
      updatedAt: new Date()
    }
  });

  return ok();
}

async function handleAdminResetPassword({ requesterUserId, targetUserId, nextPassword }, openid) {
  const requester = await getUserById(String(requesterUserId || "").trim());
  if (!requester) {
    return fail("REQUESTER_NOT_FOUND", "管理员身份失效，请重新登录");
  }
  if (requester.role !== "admin") {
    return fail("FORBIDDEN", "仅管理员可执行此操作");
  }
  if (!openid || requester.openid !== openid) {
    return fail("AUTH_MISMATCH", "管理员登录态已失效，请重新登录");
  }

  const target = await getUserById(String(targetUserId || "").trim());
  if (!target) {
    return fail("TARGET_NOT_FOUND", "目标用户不存在");
  }

  await db.collection(USERS_COLLECTION).doc(target._id).update({
    data: {
      password: hashPassword(String(nextPassword || "123456")),
      updatedAt: new Date()
    }
  });

  return ok();
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = String(event && event.action || "").trim();

  try {
    if (action === "login") {
      return await handleLogin(event, OPENID);
    }
    if (action === "register") {
      return await handleRegister(event, OPENID);
    }
    if (action === "updateProfile") {
      return await handleUpdateProfile(event, OPENID);
    }
    if (action === "getUserById") {
      return await handleGetUserById(event, OPENID);
    }
    if (action === "listConsignmentUsers") {
      return await handleListConsignmentUsers(event, OPENID);
    }
    if (action === "listUsers") {
      return await handleListUsers(event, OPENID);
    }
    if (action === "adminUpdateUserProfile") {
      return await handleAdminUpdateUserProfile(event, OPENID);
    }
    if (action === "adminToggleConsignPermission") {
      return await handleAdminToggleConsignPermission(event, OPENID);
    }
    if (action === "adminDeleteUsers") {
      return await handleAdminDeleteUsers(event, OPENID);
    }
    if (action === "changePassword") {
      return await handleChangePassword(event, OPENID);
    }
    if (action === "adminResetPassword") {
      return await handleAdminResetPassword(event, OPENID);
    }
    return fail("UNKNOWN_ACTION", "未知认证操作");
  } catch (error) {
    console.error("auth cloud function error:", error);
    return fail("INTERNAL_ERROR", "认证服务异常，请稍后重试");
  }
};
