const cloud = require("wx-server-sdk");

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const command = db.command;
const USERS_COLLECTION = "users";

const PRODUCTS_COLLECTION = "products";
const SETTLEMENT_RECORDS_COLLECTION = "settlement_records";
const MATERIAL_EXPENSES_COLLECTION = "material_expenses";
const LOGISTICS_EXPENSES_COLLECTION = "logistics_expenses";
const TECH_SERVICE_EXPENSES_COLLECTION = "tech_service_expenses";
const OPERATION_LOGS_COLLECTION = "admin_operation_logs";
const IP_GROUPS_COLLECTION = "ip_groups";
const SHOP_CHANNELS_COLLECTION = "shop_channels";

function ok(extra = {}) {
  return { ok: true, ...extra };
}

function fail(code, message) {
  return { ok: false, code, message };
}

function normalizeWritePayload(input) {
  if (input instanceof Date) {
    return input.toISOString();
  }
  if (Array.isArray(input)) {
    return input.map((item) => normalizeWritePayload(item));
  }
  if (!input || typeof input !== "object") {
    return input;
  }

  const result = {};
  Object.keys(input).forEach((key) => {
    const value = input[key];
    if (value === undefined) {
      return;
    }
    result[key] = normalizeWritePayload(value);
  });
  return result;
}

function extractServerErrorMessage(error) {
  const raw = String((error && (error.errMsg || error.message || error)) || "").trim();
  if (!raw) {
    return "数据服务异常，请稍后重试";
  }
  if (/duplicate/i.test(raw)) {
    return "数据重复，请刷新后重试";
  }
  if (/permission|auth|denied/i.test(raw)) {
    return "暂无数据操作权限，请重新登录后重试";
  }
  if (/timeout|network|fail/i.test(raw)) {
    return "数据服务请求超时，请稍后重试";
  }
  return raw.slice(0, 120);
}

function isPublicProductRead(action, collectionName) {
  return collectionName === PRODUCTS_COLLECTION && (action === "fetchAll" || action === "getDocById");
}

async function getUserByOpenId(openid) {
  if (!openid) {
    return null;
  }
  const res = await db.collection(USERS_COLLECTION).where({ openid }).limit(1).get();
  return (res.data || [])[0] || null;
}

function isAdmin(user) {
  return !!(user && user.role === "admin");
}

function canManageProducts(user) {
  return !!(user && (user.role === "admin" || user.role === "consignment_user" || user.isAgentEnabled));
}

function isExpenseCollection(collectionName) {
  return [
    MATERIAL_EXPENSES_COLLECTION,
    LOGISTICS_EXPENSES_COLLECTION,
    TECH_SERVICE_EXPENSES_COLLECTION
  ].includes(collectionName);
}

function normalizeWhere(where) {
  if (!where || typeof where !== "object" || Array.isArray(where)) {
    return null;
  }
  const normalized = {};
  Object.keys(where).forEach((key) => {
    const value = where[key];
    if (value === undefined) {
      return;
    }
    if (Array.isArray(value)) {
      normalized[key] = command.in(value);
      return;
    }
    normalized[key] = value;
  });
  return normalized;
}

async function queryAll(collectionName, options = {}) {
  const result = [];
  const pageSize = 100;
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 0;
  let skip = 0;
  const normalizedWhere = normalizeWhere(options.where);
  const orderByField = String(options.orderByField || "").trim();
  const orderByDirection = options.orderByDirection === "asc" ? "asc" : "desc";

  while (true) {
    let query = db.collection(collectionName);
    if (normalizedWhere) {
      query = query.where(normalizedWhere);
    }
    if (orderByField) {
      query = query.orderBy(orderByField, orderByDirection);
    }
    const currentLimit = limit ? Math.min(pageSize, Math.max(limit - result.length, 0)) : pageSize;
    if (!currentLimit) {
      break;
    }
    const res = await query.skip(skip).limit(currentLimit).get();
    const rows = res.data || [];
    result.push(...rows);
    if (rows.length < currentLimit || (limit && result.length >= limit)) {
      break;
    }
    skip += pageSize;
  }

  return result;
}

async function getDoc(collectionName, docId) {
  if (!docId) {
    return null;
  }
  const res = await db.collection(collectionName).doc(docId).get();
  return res.data || null;
}

async function requireRequester(openid) {
  const user = await getUserByOpenId(openid);
  if (!user) {
    return fail("AUTH_MISMATCH", "登录态已失效，请重新登录");
  }
  return user;
}

function canReadCollection(collectionName, requester, where = null) {
  if (collectionName === PRODUCTS_COLLECTION) {
    return !!requester;
  }
  if (collectionName === SHOP_CHANNELS_COLLECTION) {
    return !!requester;
  }
  if (collectionName === SETTLEMENT_RECORDS_COLLECTION) {
    return isAdmin(requester) || !!(where && String(where.userId || "").trim() === String(requester._id || "").trim());
  }
  if (isExpenseCollection(collectionName) || collectionName === OPERATION_LOGS_COLLECTION || collectionName === IP_GROUPS_COLLECTION) {
    return isAdmin(requester);
  }
  return false;
}

function canWriteCollection(collectionName, requester) {
  if (collectionName === PRODUCTS_COLLECTION) {
    return canManageProducts(requester);
  }
  if (collectionName === SHOP_CHANNELS_COLLECTION) {
    return isAdmin(requester);
  }
  if (collectionName === SETTLEMENT_RECORDS_COLLECTION) {
    return isAdmin(requester);
  }
  if (isExpenseCollection(collectionName) || collectionName === OPERATION_LOGS_COLLECTION || collectionName === IP_GROUPS_COLLECTION) {
    return isAdmin(requester);
  }
  return false;
}

async function handleFetchAll({ collectionName, where, orderByField, orderByDirection, limit }, requester) {
  if (!requester && collectionName === PRODUCTS_COLLECTION) {
    const publicWhere = {
      ...(normalizeWhere(where) || {}),
      status: "up"
    };
    const items = await queryAll(collectionName, {
      where: publicWhere,
      orderByField,
      orderByDirection,
      limit
    });
    return ok({ items });
  }

  if (!canReadCollection(collectionName, requester, where)) {
    return fail("FORBIDDEN", "暂无数据读取权限");
  }
  const items = await queryAll(collectionName, {
    where,
    orderByField,
    orderByDirection,
    limit
  });
  return ok({ items });
}

async function handleGetDocById({ collectionName, docId }, requester) {
  const item = await getDoc(collectionName, String(docId || "").trim());
  if (!item) {
    return ok({ item: null });
  }

  if (!requester && collectionName === PRODUCTS_COLLECTION) {
    return ok({ item: item.status === "up" ? item : null });
  }

  if (collectionName === SETTLEMENT_RECORDS_COLLECTION) {
    if (!isAdmin(requester) && String(item.userId || "").trim() !== String(requester._id || "").trim()) {
      return fail("FORBIDDEN", "暂无数据读取权限");
    }
    return ok({ item });
  }

  if (!canReadCollection(collectionName, requester, null)) {
    return fail("FORBIDDEN", "暂无数据读取权限");
  }
  return ok({ item });
}

async function handleAddDoc({ collectionName, data }, requester) {
  if (!canWriteCollection(collectionName, requester)) {
    return fail("FORBIDDEN", "暂无数据写入权限");
  }
  const payload = normalizeWritePayload(data && typeof data === "object" ? data : {});
  const res = await db.collection(collectionName).add({ data: payload });
  return ok({
    item: {
      ...payload,
      _id: res._id
    }
  });
}

async function handleUpdateDocById({ collectionName, docId, data }, requester) {
  if (!canWriteCollection(collectionName, requester)) {
    return fail("FORBIDDEN", "暂无数据写入权限");
  }
  const normalizedDocId = String(docId || "").trim();
  if (!normalizedDocId) {
    return fail("INVALID_PARAMS", "缺少文档 ID");
  }
  const current = await getDoc(collectionName, normalizedDocId);
  if (!current) {
    return ok({ item: null });
  }
  const payload = normalizeWritePayload(data && typeof data === "object" ? data : {});
  await db.collection(collectionName).doc(normalizedDocId).update({ data: payload });
  return ok({
    item: {
      ...current,
      ...payload,
      _id: normalizedDocId
    }
  });
}

async function handleBulkUpdateDocs({ collectionName, updates }, requester) {
  if (!canWriteCollection(collectionName, requester)) {
    return fail("FORBIDDEN", "暂无数据写入权限");
  }

  const list = Array.isArray(updates) ? updates : [];
  if (!list.length) {
    return ok({ items: [] });
  }

  const results = await Promise.all(list.map(async (updateItem) => {
    const normalizedDocId = String(updateItem && updateItem.docId || "").trim();
    if (!normalizedDocId) {
      return null;
    }

    const current = await getDoc(collectionName, normalizedDocId);
    if (!current) {
      return null;
    }

    const payload = updateItem && updateItem.data && typeof updateItem.data === "object"
      ? normalizeWritePayload(updateItem.data)
      : {};

    await db.collection(collectionName).doc(normalizedDocId).update({ data: payload });
    return {
      ...current,
      ...payload,
      _id: normalizedDocId
    };
  }));

  return ok({ items: results.filter(Boolean) });
}

async function handleRemoveDocById({ collectionName, docId }, requester) {
  if (!canWriteCollection(collectionName, requester)) {
    return fail("FORBIDDEN", "暂无数据删除权限");
  }
  const normalizedDocId = String(docId || "").trim();
  if (!normalizedDocId) {
    return fail("INVALID_PARAMS", "缺少文档 ID");
  }
  await db.collection(collectionName).doc(normalizedDocId).remove();
  return ok({ removed: true });
}

exports.main = async (event) => {
  const { OPENID } = cloud.getWXContext();
  const action = String((event && event.action) || "").trim();
  const collectionName = String((event && event.collectionName) || "").trim();

  try {
    let requester = null;

    if (OPENID) {
      const currentUser = await getUserByOpenId(OPENID);
      if (currentUser) {
        requester = currentUser;
      } else if (!isPublicProductRead(action, collectionName)) {
        return fail("AUTH_MISMATCH", "登录态已失效，请重新登录");
      }
    } else if (!isPublicProductRead(action, collectionName)) {
      return fail("AUTH_MISMATCH", "登录态已失效，请重新登录");
    }

    if (action === "fetchAll") {
      return await handleFetchAll(event, requester);
    }
    if (action === "getDocById") {
      return await handleGetDocById(event, requester);
    }
    if (action === "addDoc") {
      return await handleAddDoc(event, requester);
    }
    if (action === "updateDocById") {
      return await handleUpdateDocById(event, requester);
    }
    if (action === "bulkUpdateDocs") {
      return await handleBulkUpdateDocs(event, requester);
    }
    if (action === "removeDocById") {
      return await handleRemoveDocById(event, requester);
    }

    return fail("UNKNOWN_ACTION", "未知数据操作");
  } catch (error) {
    console.error("dataAccess cloud function error:", error);
    return fail("INTERNAL_ERROR", extractServerErrorMessage(error));
  }
};
