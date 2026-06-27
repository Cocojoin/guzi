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
  const normalized = Array.isArray(product && product.soldBatches)
    ? product.soldBatches
        .map((batch) => ({
          qty: Math.max(0, Number(batch && batch.qty || 0)),
          settledQty: Math.max(0, Number(batch && batch.settledQty || 0)),
          saleAmount: Math.max(0, Number(batch && (batch.saleAmount != null ? batch.saleAmount : batch.price) || 0)),
          rateFraction: normalizeRateFraction(batch && (batch.rateFraction ?? batch.rate)),
          soldAt: batch && batch.soldAt ? batch.soldAt : null
        }))
        .filter((batch) => batch.qty > 0)
    : [];

  const expectedTotalQty = Math.max(
    0,
    Number(product && product.soldCount || 0) + Number(product && product.settledCount || 0)
  );
  let overflowQty = normalized.reduce((sum, batch) => sum + batch.qty, 0) - expectedTotalQty;

  if (overflowQty <= 0) {
    return normalized;
  }

  const trimmed = [];
  for (let index = 0; index < normalized.length; index += 1) {
    const batch = normalized[index];
    if (!overflowQty) {
      trimmed.push(batch);
      continue;
    }

    const removeQty = Math.min(batch.qty, overflowQty);
    const nextQty = batch.qty - removeQty;
    overflowQty -= removeQty;

    if (nextQty <= 0) {
      continue;
    }

    const unitSaleAmount = batch.qty > 0 ? Number(batch.saleAmount || 0) / batch.qty : 0;
    trimmed.push({
      ...batch,
      qty: nextQty,
      settledQty: Math.min(batch.settledQty, nextQty),
      saleAmount: Number((unitSaleAmount * nextQty).toFixed(2))
    });
  }

  return trimmed;
}

function getPendingSoldQuantity(product) {
  return Math.max(0, Number(product && product.soldCount || 0) - Number(product && product.settledCount || 0));
}

function ensurePendingSoldBatches(product, fallbackRateFraction) {
  const normalized = normalizeSoldBatches(product);
  const pendingQuantity = getPendingSoldQuantity(product);
  const accountedPending = normalized.reduce((sum, batch) => sum + Math.max(0, batch.qty - batch.settledQty), 0);
  const missingPending = Math.max(0, pendingQuantity - accountedPending);
  const price = Math.max(0, Number(product && product.price || 0));

  if (missingPending > 0) {
    normalized.push({
      qty: missingPending,
      settledQty: 0,
      saleAmount: price * missingPending,
      rateFraction: normalizeRateFraction(fallbackRateFraction),
      soldAt: product && (product.updatedAt || product.createdAt) ? (product.updatedAt || product.createdAt) : null
    });
  }

  return normalized;
}

function appendSoldBatch(product, quantity, rateFraction, soldAt = new Date(), saleAmount) {
  const qty = Math.max(0, Number(quantity || 0));
  if (!qty) {
    return normalizeSoldBatches(product);
  }

  const fallbackSaleAmount = Math.max(0, Number(product && product.price || 0)) * qty;
  const normalized = normalizeSoldBatches(product);
  normalized.push({
    qty,
    settledQty: 0,
    saleAmount: Math.max(0, Number(saleAmount != null ? saleAmount : fallbackSaleAmount)),
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
