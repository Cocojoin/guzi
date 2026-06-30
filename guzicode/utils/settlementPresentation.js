const { ensurePendingSoldBatches, normalizeRateFraction } = require("./consignmentRate");

function fmt2(value) {
  return Number(value || 0).toFixed(2);
}

function calcPayableAmount(price, quantity, rateFraction) {
  const grossAmount = Number(price || 0) * Number(quantity || 0);
  const commissionAmount = grossAmount * normalizeRateFraction(rateFraction);
  return grossAmount - commissionAmount;
}

function formatDateTimeLabel(value) {
  const date = new Date(value || Date.now());
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function getQualityLabel(quality) {
  return quality === "flaw" ? "有瑕" : "无暇";
}

function buildPendingSettlementItems(product, fallbackRateFraction) {
  const pendingBatches = ensurePendingSoldBatches(product, fallbackRateFraction);
  return pendingBatches
    .map((batch, batchIndex) => {
      const unsettledQty = Math.max(0, Number(batch.qty || 0) - Number(batch.settledQty || 0));
      if (!unsettledQty) {
        return null;
      }

      const rateFraction = normalizeRateFraction(batch.rateFraction);
      const price = Number(batch.price != null ? batch.price : product.price || 0);
      const totalPrice = price * unsettledQty;
      const payableAmount = calcPayableAmount(price, unsettledQty, rateFraction);
      const batchSaleAmount = Number(batch.saleAmount || 0);
      const unitSaleAmount = batch.qty > 0 && batchSaleAmount > 0 ? batchSaleAmount / Number(batch.qty || 1) : price;
      const saleAmount = Number((unitSaleAmount * unsettledQty).toFixed(2));
      const docId = product._id || product.id || "";

      return {
        id: docId,
        rowKey: `${docId}-${batchIndex}`,
        productId: product.id,
        role: product.role || "-",
        productSeries: product.series || "-",
        ip: product.ip || "-",
        title: `${product.role || ""} · ${product.series || ""}`.trim(),
        soldQty: unsettledQty,
        price,
        totalPrice,
        totalPriceText: fmt2(totalPrice),
        saleAmount,
        saleAmountText: fmt2(saleAmount),
        payableAmount,
        payableText: fmt2(payableAmount),
        rate: Number((rateFraction * 100).toFixed(2)),
        rateFraction,
        batchIndex,
        type: product.customType || product.type || "-",
        series: product.ip || product.series || "-",
        quality: product.purchaseRecord || "无",
        qualityLabel: getQualityLabel(product.quality),
        qualityClassName: product.quality === "flaw" ? "quality-badge--flaw" : "quality-badge--clean",
        soldTimeText: formatDateTimeLabel(batch.soldAt || product.updatedAt || product.createdAt),
        selected: true,
        coverImage: Array.isArray(product.images) ? (product.images[0] || "") : ""
      };
    })
    .filter(Boolean);
}

module.exports = {
  buildPendingSettlementItems,
  calcPayableAmount,
  fmt2
};
