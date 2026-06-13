function extractErrorMessage(error, fallback = "数据服务调用失败") {
  const message = String((error && (error.errMsg || error.message)) || "").trim();
  if (!message) {
    return fallback;
  }
  if (/FunctionName parameter could not be found|function not found|does not exist/i.test(message)) {
    return "云函数未部署，请先上传 dataAccess 云函数";
  }
  if (/permission|auth|denied/i.test(message)) {
    return "暂无数据权限，请重新登录后重试";
  }
  if (/network|timeout|fail/i.test(message)) {
    return "网络异常，请稍后重试";
  }
  return fallback;
}

async function invoke(action, data = {}) {
  try {
    const res = await wx.cloud.callFunction({
      name: "dataAccess",
      data: {
        action,
        ...data
      }
    });
    const result = res && res.result ? res.result : null;
    if (!result || result.ok !== true) {
      const error = new Error(result && result.message ? result.message : "数据服务调用失败");
      error.code = result && result.code ? result.code : "DATA_FUNCTION_FAILED";
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

async function fetchAll(collectionName, options = {}) {
  const result = await invoke("fetchAll", {
    collectionName,
    where: options.where || null,
    orderByField: options.orderByField || "",
    orderByDirection: options.orderByDirection || "desc"
  });
  return result.items || [];
}

async function getDocById(collectionName, docId) {
  const result = await invoke("getDocById", {
    collectionName,
    docId
  });
  return result.item || null;
}

async function addDoc(collectionName, data) {
  const result = await invoke("addDoc", {
    collectionName,
    data
  });
  return result.item || null;
}

async function updateDocById(collectionName, docId, data) {
  const result = await invoke("updateDocById", {
    collectionName,
    docId,
    data
  });
  return result.item || null;
}

async function removeDocById(collectionName, docId) {
  const result = await invoke("removeDocById", {
    collectionName,
    docId
  });
  return result.removed === true;
}

module.exports = {
  addDoc,
  fetchAll,
  getDocById,
  removeDocById,
  updateDocById
};
