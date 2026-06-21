const PRODUCTS_COLLECTION = "products";
const { appendSoldBatch, settleSoldBatches } = require("./consignmentRate");
const { retainIpGroupNames, normalizeIpName } = require("./ipGroupsRepository");
const dataAccessService = require("./dataAccessService");

const FULL_LIST_CACHE_TTL = 60 * 1000;

let fullListCache = null;
let fullListCacheAt = 0;
let fullListRequest = null;

function cloneProducts(items) {
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

function isUsingDefaultListQuery(options = {}) {
  return !options.where
    && (options.orderByField || "updatedAt") === "updatedAt"
    && (options.orderByDirection || "desc") === "desc";
}

function getCachedFullList() {
  if (!Array.isArray(fullListCache)) {
    return null;
  }
  if (Date.now() - fullListCacheAt > FULL_LIST_CACHE_TTL) {
    return null;
  }
  return cloneProducts(fullListCache);
}

function setCachedFullList(items) {
  fullListCache = cloneProducts(items);
  fullListCacheAt = Date.now();
}

function invalidateFullListCache() {
  fullListCache = null;
  fullListCacheAt = 0;
  fullListRequest = null;
}

function upsertCachedProducts(items) {
  if (!fullListCache || !Array.isArray(items) || !items.length) {
    return;
  }

  const cacheMap = new Map(fullListCache.map((item) => [String(item._id || item.id || ""), item]));
  items.forEach((item) => {
    const key = String(item && (item._id || item.id) || "");
    if (!key) {
      return;
    }
    cacheMap.set(key, { ...item });
  });
  fullListCache = Array.from(cacheMap.values());
  fullListCacheAt = Date.now();
}

function removeCachedProductsByDocIds(docIds) {
  if (!fullListCache || !Array.isArray(docIds) || !docIds.length) {
    return;
  }
  const deletedSet = new Set(docIds.map((item) => String(item || "").trim()).filter(Boolean));
  fullListCache = fullListCache.filter((item) => !deletedSet.has(String(item._id || "").trim()));
  fullListCacheAt = Date.now();
}

async function getAllProducts(options = {}) {
  const normalizedOptions = {
    where: options.where || null,
    orderByField: options.orderByField || "updatedAt",
    orderByDirection: options.orderByDirection || "desc",
    forceRefresh: options.forceRefresh === true
  };

  const useCache = isUsingDefaultListQuery(normalizedOptions);
  if (useCache && !normalizedOptions.forceRefresh) {
    const cached = getCachedFullList();
    if (cached) {
      return cached;
    }
    if (fullListRequest) {
      return cloneProducts(await fullListRequest);
    }
  }

  const request = dataAccessService.fetchAll(PRODUCTS_COLLECTION, normalizedOptions);
  if (useCache) {
    fullListRequest = request;
  }

  try {
    const items = await request;
    if (useCache) {
      setCachedFullList(items);
    }
    return cloneProducts(items);
  } finally {
    if (useCache) {
      fullListRequest = null;
    }
  }
}

async function getProductsByIds(ids, options = {}) {
  const list = Array.isArray(ids)
    ? ids.map((item) => String(item || "").trim()).filter(Boolean)
    : [];

  if (!list.length) {
    return [];
  }

  const cacheEnabled = options.forceRefresh !== true;
  if (cacheEnabled) {
    const cached = getCachedFullList();
    if (cached) {
      const cacheMap = new Map(cached.map((item) => [String(item.id || "").trim(), item]));
      return list.map((id) => cacheMap.get(id)).filter(Boolean);
    }
  }

  const items = await getAllProducts({
    where: { id: list },
    orderByField: "updatedAt",
    orderByDirection: "desc",
    forceRefresh: options.forceRefresh === true
  });
  const itemMap = new Map(items.map((item) => [String(item.id || "").trim(), item]));
  return list.map((id) => itemMap.get(id)).filter(Boolean);
}

async function getProductById(id, options = {}) {
  const normalizedId = String(id || "").trim();
  if (!normalizedId) {
    return null;
  }

  const cacheEnabled = options.forceRefresh !== true;
  if (cacheEnabled) {
    const cached = getCachedFullList();
    if (cached) {
      return cached.find((item) => String(item.id || "").trim() === normalizedId) || null;
    }
  }

  const list = await getProductsByIds([normalizedId], options);
  return list[0] || null;
}

function getRemainingCount(product) {
  return Math.max(
    0,
    Number(product.totalQuantity || 0) - Number(product.soldCount || 0)
  );
}

async function createProduct(payload) {
  const now = new Date();
  const record = {
    id: payload.id,
    ownerUserId: payload.ownerUserId || "",
    role: payload.role,
    series: payload.series,
    ip: payload.ip,
    owner: payload.owner,
    type: payload.type || "小卡",
    customType: payload.customType || "",
    price: payload.price,
    quality: payload.quality,
    status: payload.status,
    totalQuantity: payload.totalQuantity,
    soldCount: payload.soldCount || 0,
    settledCount: payload.settledCount || 0,
    soldBatches: Array.isArray(payload.soldBatches) ? payload.soldBatches : [],
    listedDays: payload.listedDays || 0,
    purchaseRecord: payload.purchaseRecord,
    images: payload.images || [],
    links: payload.links || [],
    remark: payload.remark || "",
    createdAt: now,
    updatedAt: now
  };

  const result = await dataAccessService.addDoc(PRODUCTS_COLLECTION, record);
  const created = {
    ...record,
    _id: result && result._id
  };
  upsertCachedProducts([created]);
  await retainIpGroupNames([record.ip]);
  return created;
}

function buildUpdatedProduct(current, updater) {
  const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  const { _id, _openid, ...rest } = next;
  const payload = {
    ...rest,
    updatedAt: new Date()
  };
  return {
    current,
    payload,
    next: {
      ...current,
      ...payload
    }
  };
}

async function syncIpGroupNames(previousItem, nextItem) {
  const previousIp = normalizeIpName(previousItem && previousItem.ip);
  const nextIp = normalizeIpName(nextItem && nextItem.ip);
  if (previousIp || nextIp) {
    await retainIpGroupNames([previousIp, nextIp]);
  }
}

async function recordProductSale(id, quantity, rateFraction, overrides = {}) {
  const qty = Math.max(0, Number(quantity || 0));
  if (!qty) {
    return getProductById(id);
  }

  return updateProduct(id, (current) => {
    const soldCount = Number(current.soldCount || 0) + qty;
    const totalQuantity = Number(current.totalQuantity || 0);
    const remainingCount = Math.max(0, totalQuantity - soldCount);

    let nextStatus = current.status;
    if (remainingCount <= 0 && totalQuantity > 0) {
      nextStatus = "sold";
    } else if (["sold", "settled"].includes(nextStatus) && remainingCount > 0) {
      nextStatus = "up";
    }

    return {
      ...current,
      ...overrides,
      soldCount,
      status: nextStatus,
      soldBatches: appendSoldBatch(current, qty, rateFraction, new Date())
    };
  });
}

async function bulkRecordProductSales(sales, resolveRateFraction) {
  const normalizedSales = Array.isArray(sales)
    ? sales.map((item) => ({
      id: String(item && item.id || "").trim(),
      qty: Math.max(0, Number(item && item.qty || 0)),
      price: Number(item && item.price || 0)
    })).filter((item) => item.id && item.qty > 0)
    : [];

  if (!normalizedSales.length) {
    return [];
  }

  const products = await getProductsByIds(normalizedSales.map((item) => item.id), { forceRefresh: true });
  const productMap = new Map(products.map((item) => [String(item.id || "").trim(), item]));
  const updates = [];
  const syncPairs = [];

  for (const sale of normalizedSales) {
    const product = productMap.get(sale.id);
    if (!product || !product._id) {
      continue;
    }

    const remaining = Math.max(
      0,
      Number(product.totalQuantity || 0) - Number(product.soldCount || 0) - Number(product.settledCount || 0)
    );
    const qty = Math.max(0, Math.min(sale.qty, remaining));
    if (!qty) {
      continue;
    }

    const rateFraction = typeof resolveRateFraction === "function"
      ? await resolveRateFraction(product)
      : 0;
    const next = buildUpdatedProduct(product, (current) => {
      const soldCount = Number(current.soldCount || 0) + qty;
      const totalQuantity = Number(current.totalQuantity || 0);
      const remainingCount = Math.max(0, totalQuantity - soldCount - Number(current.settledCount || 0));
      let nextStatus = current.status;

      if (remainingCount <= 0 && totalQuantity > 0) {
        nextStatus = "sold";
      } else if (["sold", "settled"].includes(nextStatus) && remainingCount > 0) {
        nextStatus = "up";
      }

      return {
        ...current,
        price: Number.isFinite(sale.price) && sale.price > 0 ? sale.price : current.price,
        soldCount,
        status: nextStatus,
        soldBatches: appendSoldBatch(current, qty, rateFraction, new Date())
      };
    });

    updates.push({
      docId: product._id,
      data: next.payload
    });
    syncPairs.push({
      previous: product,
      next: next.next
    });
  }

  if (!updates.length) {
    return [];
  }

  const updated = await dataAccessService.bulkUpdateDocs(PRODUCTS_COLLECTION, updates);
  const nextProducts = syncPairs.map((item) => item.next);
  upsertCachedProducts(updated.length ? updated : nextProducts);

  await Promise.all(syncPairs.map((item) => syncIpGroupNames(item.previous, item.next)));
  return updated.length ? updated : nextProducts;
}

async function applySettlementToProduct(id, quantity, fallbackRateFraction) {
  const qty = Math.max(0, Number(quantity || 0));
  if (!qty) {
    return getProductById(id);
  }

  return updateProduct(id, (current) => {
    const totalQuantity = Number(current.totalQuantity || 0);
    const soldCount = Number(current.soldCount || 0);
    const nextSold = Math.max(0, soldCount - qty);
    const nextSettled = Number(current.settledCount || 0) + qty;
    const remainingCount = Math.max(0, totalQuantity - nextSold);

    let nextStatus = current.status;
    if (remainingCount <= 0 && totalQuantity > 0) {
      nextStatus = nextSold > 0 ? "sold" : "settled";
    } else if (["sold", "settled"].includes(nextStatus) && remainingCount > 0) {
      nextStatus = "up";
    }

    return {
      ...current,
      soldCount: nextSold,
      settledCount: nextSettled,
      soldBatches: settleSoldBatches(current, qty, fallbackRateFraction),
      status: nextStatus
    };
  });
}

async function updateProduct(id, updater) {
  const current = await getProductById(id, { forceRefresh: true });
  if (!current || !current._id) {
    return null;
  }

  const updated = buildUpdatedProduct(current, updater);
  await dataAccessService.updateDocById(PRODUCTS_COLLECTION, current._id, updated.payload);
  upsertCachedProducts([updated.next]);
  await syncIpGroupNames(current, updated.next);
  return updated.next;
}

async function bulkUpdateProducts(items) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) {
    return [];
  }

  const products = await getProductsByIds(list.map((item) => item.id), { forceRefresh: true });
  const productMap = new Map(products.map((item) => [String(item.id || "").trim(), item]));
  const updates = [];
  const syncPairs = [];

  list.forEach((item) => {
    const current = productMap.get(String(item && item.id || "").trim());
    if (!current || !current._id) {
      return;
    }
    const updated = buildUpdatedProduct(current, item.data || {});
    updates.push({
      docId: current._id,
      data: updated.payload
    });
    syncPairs.push({
      previous: current,
      next: updated.next
    });
  });

  if (!updates.length) {
    return [];
  }

  const result = await dataAccessService.bulkUpdateDocs(PRODUCTS_COLLECTION, updates);
  const nextProducts = syncPairs.map((item) => item.next);
  upsertCachedProducts(result.length ? result : nextProducts);
  await Promise.all(syncPairs.map((item) => syncIpGroupNames(item.previous, item.next)));
  return result.length ? result : nextProducts;
}

async function deleteProducts(ids) {
  const records = await getProductsByIds(ids, { forceRefresh: true });
  if (!records.length) {
    return 0;
  }

  await Promise.all(records.map((item) => dataAccessService.removeDocById(PRODUCTS_COLLECTION, item._id)));
  removeCachedProductsByDocIds(records.map((item) => item._id));
  return records.length;
}

async function bulkUpdateStatus(ids, status) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) {
    return [];
  }

  return bulkUpdateProducts(list.map((id) => ({
    id,
    data: { status }
  })));
}

async function restoreSoldProduct(id) {
  return updateProduct(id, (product) => {
    const soldCount = Math.max(0, Number(product.soldCount || 0) - 1);
    const soldBatches = Array.isArray(product.soldBatches) ? [...product.soldBatches] : [];
    for (let index = soldBatches.length - 1; index >= 0; index -= 1) {
      const batch = soldBatches[index];
      const unsettledQty = Math.max(0, Number(batch && batch.qty || 0) - Number(batch && batch.settledQty || 0));
      if (!unsettledQty) {
        continue;
      }
      const nextQty = Math.max(0, Number(batch.qty || 0) - 1);
      if (!nextQty) {
        soldBatches.splice(index, 1);
      } else {
        soldBatches[index] = {
          ...batch,
          qty: nextQty
        };
      }
      break;
    }
    return {
      ...product,
      soldCount,
      soldBatches,
      status: "up"
    };
  });
}

async function buildNewProductId() {
  const all = await getAllProducts();
  const maxValue = all.reduce((max, item) => {
    const value = Number(String(item.id || "").replace(/\D/g, ""));
    return Number.isFinite(value) ? Math.max(max, value) : max;
  }, 0);
  return `A${String(maxValue + 1).padStart(5, "0")}`;
}

module.exports = {
  applySettlementToProduct,
  buildNewProductId,
  bulkRecordProductSales,
  bulkUpdateProducts,
  bulkUpdateStatus,
  createProduct,
  deleteProducts,
  getAllProducts,
  getProductById,
  getProductsByIds,
  getRemainingCount,
  invalidateFullListCache,
  recordProductSale,
  restoreSoldProduct,
  updateProduct
};
