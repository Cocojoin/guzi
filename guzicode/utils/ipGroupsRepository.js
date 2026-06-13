const { buildProductCard } = require("./productPresentation");
const dataAccessService = require("./dataAccessService");

const PRODUCTS_COLLECTION = "products";
const IP_GROUPS_COLLECTION = "ip_groups";
const STORAGE_KEY = "adminIpGroupsLocal";

function normalizeIpName(value) {
  return String(value || "").trim();
}

function safeDateValue(value) {
  const date = value instanceof Date ? value : new Date(value || 0);
  const time = date.getTime();
  return Number.isNaN(time) ? 0 : time;
}

function toIsoString(value) {
  const time = safeDateValue(value);
  return new Date(time || Date.now()).toISOString();
}

function getInitials(text) {
  const value = normalizeIpName(text);
  if (!value) return "IP";
  if (/^[A-Za-z0-9]/.test(value)) {
    return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "IP";
  }
  return value.slice(0, 1).toUpperCase();
}

function getTone(index) {
  const tones = ["gold", "green", "purple", "blue", "pink", "orange"];
  return tones[index % tones.length];
}

function getLocalGroups() {
  return wx.getStorageSync(STORAGE_KEY) || [];
}

function saveLocalGroups(groups) {
  wx.setStorageSync(STORAGE_KEY, groups);
}

async function fetchAllProducts() {
  return dataAccessService.fetchAll(PRODUCTS_COLLECTION, {
    orderByField: "updatedAt",
    orderByDirection: "desc"
  });
}

async function fetchCloudGroups() {
  try {
    return await dataAccessService.fetchAll(IP_GROUPS_COLLECTION, {
      orderByField: "updatedAt",
      orderByDirection: "desc"
    });
  } catch (error) {
    const message = String((error && (error.errMsg || error.message)) || "");
    if (!/does not exist|collection|permission/i.test(message)) {
      console.warn("fetchCloudGroups fallback to local:", message);
    }
    return [];
  }
}

function buildManualGroupRecord(name, current = {}) {
  const normalized = normalizeIpName(name);
  const now = new Date().toISOString();
  return {
    id: current.id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: normalized,
    createdAt: current.createdAt || now,
    updatedAt: current.updatedAt || now
  };
}

async function listManualGroups() {
  const localGroups = getLocalGroups()
    .map((item) => buildManualGroupRecord(item.name || item.ip || "", item))
    .filter((item) => item.name);
  const cloudGroups = (await fetchCloudGroups())
    .map((item) => buildManualGroupRecord(item.name || item.ip || "", item))
    .filter((item) => item.name);

  const merged = new Map();
  localGroups.concat(cloudGroups).forEach((item) => {
    const key = item.name;
    const current = merged.get(key);
    if (!current || safeDateValue(item.updatedAt) > safeDateValue(current.updatedAt)) {
      merged.set(key, item);
    }
  });

  const groups = [...merged.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  saveLocalGroups(groups);
  return groups;
}

async function addCloudGroup(record) {
  try {
    const list = await dataAccessService.fetchAll(IP_GROUPS_COLLECTION, {
      where: { name: record.name }
    });
    const current = list && list[0];
    if (current && current._id) {
      await dataAccessService.updateDocById(IP_GROUPS_COLLECTION, current._id, {
        name: record.name,
        updatedAt: record.updatedAt
      });
      return;
    }
    await dataAccessService.addDoc(IP_GROUPS_COLLECTION, record);
  } catch (error) {
    console.warn("addCloudGroup fallback to local:", error && (error.errMsg || error.message || error));
  }
}

async function removeCloudGroup(name) {
  try {
    const rows = await dataAccessService.fetchAll(IP_GROUPS_COLLECTION, {
      where: { name }
    });
    if (!rows.length) return;
    await Promise.all(rows.map((item) => dataAccessService.removeDocById(IP_GROUPS_COLLECTION, item._id)));
  } catch (error) {
    console.warn("removeCloudGroup fallback to local:", error && (error.errMsg || error.message || error));
  }
}

async function retainIpGroupNames(names) {
  const normalizedNames = [...new Set((Array.isArray(names) ? names : [names]).map(normalizeIpName).filter(Boolean))];
  if (!normalizedNames.length) {
    return listManualGroups();
  }

  const existing = await listManualGroups();
  const existingMap = new Map(existing.map((item) => [item.name, item]));
  let changed = false;

  for (const name of normalizedNames) {
    if (existingMap.has(name)) {
      continue;
    }
    const record = buildManualGroupRecord(name);
    existingMap.set(name, record);
    changed = true;
    await addCloudGroup(record);
  }

  const groups = [...existingMap.values()].sort((left, right) => left.name.localeCompare(right.name, "zh-Hans-CN"));
  if (changed) {
    saveLocalGroups(groups);
  }
  return groups;
}

async function buildGroupMap(products) {
  const derivedNames = [...new Set(products.map((item) => normalizeIpName(item.ip)).filter(Boolean))];
  await retainIpGroupNames(derivedNames);
  const manualGroups = await listManualGroups();
  const map = new Map();

  manualGroups.forEach((item) => {
    map.set(item.name, {
      name: item.name,
      goodsCount: 0,
      onSaleCount: 0,
      roles: new Set(),
      latestTime: safeDateValue(item.updatedAt || item.createdAt),
      createdAt: item.createdAt,
      updatedAt: item.updatedAt
    });
  });

  products.forEach((rawItem) => {
    const item = buildProductCard(rawItem);
    const name = normalizeIpName(item.ip);
    if (!name) return;

    const current = map.get(name) || {
      name,
      goodsCount: 0,
      onSaleCount: 0,
      roles: new Set(),
      latestTime: 0
    };

    current.goodsCount += 1;
    if (item.displayStatus === "up") {
      current.onSaleCount += 1;
    }
    if (normalizeIpName(item.role)) {
      current.roles.add(normalizeIpName(item.role));
    }
    current.latestTime = Math.max(
      current.latestTime,
      safeDateValue(rawItem.updatedAt),
      safeDateValue(rawItem.createdAt)
    );
    map.set(name, current);
  });

  return map;
}

function sortGroupList(groups) {
  return groups.sort((left, right) => {
    if (right.onSaleCount !== left.onSaleCount) return right.onSaleCount - left.onSaleCount;
    if (right.latestTime !== left.latestTime) return right.latestTime - left.latestTime;
    return left.name.localeCompare(right.name, "zh-Hans-CN");
  });
}

async function listIpGroups() {
  const products = await fetchAllProducts();
  const groupMap = await buildGroupMap(products);

  return sortGroupList([...groupMap.values()]).map((item, index) => ({
    name: item.name,
    goodsCount: item.goodsCount,
    onSaleCount: item.onSaleCount,
    roleCount: item.roles.size,
    latestTime: item.latestTime,
    initials: getInitials(item.name),
    tone: getTone(index),
    empty: item.goodsCount === 0
  }));
}

async function createIpGroup(name) {
  const normalized = normalizeIpName(name);
  if (!normalized) {
    throw new Error("请输入 IP 名称");
  }

  const groups = await listIpGroups();
  if (groups.some((item) => item.name === normalized)) {
    throw new Error("IP 已存在，请勿重复添加");
  }

  await retainIpGroupNames([normalized]);
  return normalized;
}

async function deleteIpGroup(name) {
  const normalized = normalizeIpName(name);
  const products = await fetchAllProducts();
  const hasGoods = products.some((item) => normalizeIpName(item.ip) === normalized);
  if (hasGoods) {
    throw new Error("当前 IP 下仍有商品，无法删除");
  }

  const groups = await listManualGroups();
  const remained = groups.filter((item) => item.name !== normalized);
  saveLocalGroups(remained);
  await removeCloudGroup(normalized);
  return true;
}

async function getIpGroupDetail(name) {
  const normalized = normalizeIpName(name);
  const products = await fetchAllProducts();
  const groups = await listIpGroups();
  const summary = groups.find((item) => item.name === normalized) || {
    name: normalized,
    goodsCount: 0,
    onSaleCount: 0,
    roleCount: 0,
    initials: getInitials(normalized),
    tone: "gold",
    empty: true
  };

  const goods = products
    .filter((item) => normalizeIpName(item.ip) === normalized)
    .map((item) => {
      const view = buildProductCard(item);
      return {
        ...view,
        ipInitial: getInitials(normalized),
        selectable: true
      };
    })
    .sort((left, right) => safeDateValue(right.updatedAt) - safeDateValue(left.updatedAt));

  return {
    summary,
    goods
  };
}

async function updateProductIpByIds(ids, ipName) {
  const targetIds = [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean))];
  if (!targetIds.length) {
    return [];
  }

  const products = await fetchAllProducts();
  const matched = products.filter((item) => targetIds.includes(item.id));
  const now = new Date();

  await Promise.all(matched.map((item) => {
    const { _id, _openid, ...rest } = item;
    return dataAccessService.updateDocById(PRODUCTS_COLLECTION, item._id, {
      ...rest,
      ip: ipName,
      updatedAt: now
    });
  }));

  return matched;
}

async function assignProductsToIp(name, ids) {
  const normalized = normalizeIpName(name);
  if (!normalized) {
    throw new Error("IP 不存在");
  }
  await retainIpGroupNames([normalized]);
  const updated = await updateProductIpByIds(ids, normalized);
  const relatedNames = updated.map((item) => normalizeIpName(item.ip)).concat(normalized);
  await retainIpGroupNames(relatedNames);
  return updated;
}

async function removeProductsFromIp(name, ids) {
  const normalized = normalizeIpName(name);
  await retainIpGroupNames([normalized]);
  const updated = await updateProductIpByIds(ids, "");
  return updated.filter((item) => normalizeIpName(item.ip) === normalized);
}

async function listAssignableProducts(targetName, keyword = "") {
  const normalizedTarget = normalizeIpName(targetName);
  const query = String(keyword || "").trim().toLowerCase();
  const products = await fetchAllProducts();

  return products
    .map((item) => buildProductCard(item))
    .filter((item) => {
      if (!query) return true;
      return [item.id, item.title, item.role, item.series, item.ip]
        .join("|")
        .toLowerCase()
        .includes(query);
    })
    .sort((left, right) => safeDateValue(right.updatedAt) - safeDateValue(left.updatedAt))
    .map((item) => ({
      ...item,
      currentIp: normalizeIpName(item.ip),
      currentIpLabel: normalizeIpName(item.ip) || "未分配",
      ipInitial: getInitials(item.ip || "未"),
      alreadyInTarget: normalizeIpName(item.ip) === normalizedTarget
    }));
}

module.exports = {
  assignProductsToIp,
  createIpGroup,
  deleteIpGroup,
  getIpGroupDetail,
  listAssignableProducts,
  listIpGroups,
  normalizeIpName,
  removeProductsFromIp,
  retainIpGroupNames
};
