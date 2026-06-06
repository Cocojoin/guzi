function normalizeRateFraction(rawRate) {
  const numeric = Number(rawRate);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  if (numeric > 1) {
    return numeric / 100;
  }
  return numeric;
}

function getUserRateFraction(user) {
  return normalizeRateFraction(user && (user.commissionRate ?? user.platformRate ?? user.rate));
}

function formatRatePercent(fraction) {
  const percent = normalizeRateFraction(fraction) * 100;
  return `${percent.toFixed(percent % 1 === 0 ? 0 : 1)}%`;
}

function normalizeSoldBatches(product) {
  return Array.isArray(product && product.soldBatches)
    ? product.soldBatches
        .map((batch) => ({
          qty: Math.max(0, Number(batch && batch.qty || 0)),
          settledQty: Math.max(0, Number(batch && batch.settledQty || 0)),
          rateFraction: normalizeRateFraction(batch && (batch.rateFraction ?? batch.rate)),
          soldAt: batch && batch.soldAt ? batch.soldAt : null
        }))
        .filter((batch) => batch.qty > 0)
    : [];
}

function getPendingSoldQuantity(product) {
  return Math.max(0, Number(product && product.soldCount || 0) - Number(product && product.settledCount || 0));
}

function ensurePendingSoldBatches(product, fallbackRateFraction) {
  const normalized = normalizeSoldBatches(product);
  const pendingQuantity = getPendingSoldQuantity(product);
  const accountedPending = normalized.reduce((sum, batch) => sum + Math.max(0, batch.qty - batch.settledQty), 0);
  const missingPending = Math.max(0, pendingQuantity - accountedPending);

  if (missingPending > 0) {
    normalized.push({
      qty: missingPending,
      settledQty: 0,
      rateFraction: normalizeRateFraction(fallbackRateFraction),
      soldAt: product && (product.updatedAt || product.createdAt) ? (product.updatedAt || product.createdAt) : null
    });
  }

  return normalized;
}

function appendSoldBatch(product, quantity, rateFraction, soldAt = new Date()) {
  const qty = Math.max(0, Number(quantity || 0));
  if (!qty) {
    return normalizeSoldBatches(product);
  }

  const normalized = normalizeSoldBatches(product);
  normalized.push({
    qty,
    settledQty: 0,
    rateFraction: normalizeRateFraction(rateFraction),
    soldAt
  });
  return normalized;
}

function settleSoldBatches(product, quantity, fallbackRateFraction) {
  let remaining = Math.max(0, Number(quantity || 0));
  const batches = ensurePendingSoldBatches(product, fallbackRateFraction);
  const next = batches.map((batch) => {
    if (!remaining) {
      return batch;
    }
    const unsettledQty = Math.max(0, batch.qty - batch.settledQty);
    if (!unsettledQty) {
      return batch;
    }
    const settledNow = Math.min(unsettledQty, remaining);
    remaining -= settledNow;
    return {
      ...batch,
      settledQty: batch.settledQty + settledNow
    };
  });

  return next;
}

function settleSpecificSoldBatch(product, batchIndex, quantity, fallbackRateFraction) {
  const index = Number(batchIndex);
  const qty = Math.max(0, Number(quantity || 0));
  const batches = ensurePendingSoldBatches(product, fallbackRateFraction);
  if (!qty || !Number.isInteger(index) || index < 0 || index >= batches.length) {
    return batches;
  }

  const next = [...batches];
  const current = next[index];
  const unsettledQty = Math.max(0, Number(current.qty || 0) - Number(current.settledQty || 0));
  const settledNow = Math.min(unsettledQty, qty);
  next[index] = {
    ...current,
    settledQty: Number(current.settledQty || 0) + settledNow
  };
  return next;
}

module.exports = {
  appendSoldBatch,
  ensurePendingSoldBatches,
  formatRatePercent,
  getPendingSoldQuantity,
  getUserRateFraction,
  normalizeRateFraction,
  normalizeSoldBatches,
  settleSpecificSoldBatch,
  settleSoldBatches
};
