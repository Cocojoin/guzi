const PRODUCTS_COLLECTION = "products";
const { appendSoldBatch, settleSoldBatches } = require("./consignmentRate");

function getProductsCollection() {
  return wx.cloud.database().collection(PRODUCTS_COLLECTION);
}

async function getAllProducts() {
  const collection = getProductsCollection();
  const pageSize = 20;
  let skip = 0;
  const all = [];

  while (true) {
    const res = await collection
      .orderBy("updatedAt", "desc")
      .skip(skip)
      .limit(pageSize)
      .get({ latest: true });
    const rows = res.data || [];
    all.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return all;
}

async function getProductById(id) {
  const res = await getProductsCollection()
    .where({ id })
    .limit(1)
    .get({ latest: true });
  return res.data[0] || null;
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

  const result = await getProductsCollection().add({ data: record });
  return {
    ...record,
    _id: result._id
  };
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
  const current = await getProductById(id);
  if (!current) {
    return null;
  }

  const next = typeof updater === "function" ? updater(current) : { ...current, ...updater };
  const { _id, _openid, ...rest } = next;

  const payload = {
    ...rest,
    updatedAt: new Date()
  };

  await getProductsCollection()
    .doc(current._id)
    .update({ data: payload });

  return {
    ...current,
    ...payload
  };
}

async function deleteProducts(ids) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) {
    return 0;
  }

  const command = wx.cloud.database().command;
  const records = await getProductsCollection()
    .where({
      id: command.in(list)
    })
    .get();

  await Promise.all((records.data || []).map((item) => getProductsCollection().doc(item._id).remove()));
  return (records.data || []).length;
}

async function bulkUpdateStatus(ids, status) {
  const list = Array.isArray(ids) ? ids.filter(Boolean) : [];
  if (!list.length) {
    return;
  }

  await Promise.all(list.map((id) => updateProduct(id, { status })));
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
  bulkUpdateStatus,
  createProduct,
  deleteProducts,
  getAllProducts,
  getProductById,
  getRemainingCount,
  recordProductSale,
  restoreSoldProduct,
  updateProduct
};
