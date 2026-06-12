const PLATFORM_OPTIONS = ["拼多多", "淘宝/天猫", "小红书"];

function getRemainingCount(product) {
  return Math.max(
    0,
    Number(product.totalQuantity || 0) - Number(product.soldCount || 0)
  );
}

function getDisplayStatus(product) {
  const totalQuantity = Number(product.totalQuantity || 0);
  const soldCount = Number(product.soldCount || 0);
  const settledCount = Number(product.settledCount || 0);
  const remainingCount = getRemainingCount(product);

  if (remainingCount <= 0 && totalQuantity > 0) {
    if (settledCount > 0 && soldCount <= 0) {
      return "settled";
    }
    return "sold";
  }

  if (product.status === "up" || product.status === "down") {
    return product.status;
  }

  return "up";
}

function getStatusMeta(status) {
  const statusMap = {
    down: { label: "已下架", className: "status-pill--down" },
    up: { label: "已上架", className: "status-pill--up" },
    sold: { label: "已售出", className: "status-pill--sold" },
    settled: { label: "已结算", className: "status-pill--settled" }
  };

  return statusMap[status] || statusMap.down;
}

function getQualityMeta(quality) {
  if (quality === "flaw") {
    return { label: "有瑕", className: "quality-badge--flaw" };
  }

  return { label: "无暇", className: "quality-badge--clean" };
}

function buildTitle(product) {
  return `${product.role || ""} · ${product.series || ""}`.trim();
}

function getTypeLabel(product) {
  return product.type === "自定义" ? (product.customType || "自定义") : (product.type || "小卡");
}

function formatPrice(value) {
  return `¥${Number(value || 0)}`;
}

function normalizeLinks(links) {
  return Array.isArray(links)
    ? links.filter((item) => item && item.platform && item.url)
    : [];
}

function validateLink(platform, url) {
  const value = String(url || "").trim();

  if (!platform || !value) {
    return false;
  }

  if (!/^https?:\/\//.test(value)) {
    return false;
  }

  const hostChecks = {
    拼多多: /(yangkeduo|pinduoduo|pdd)/i,
    "淘宝/天猫": /(taobao|tmall)/i,
    小红书: /(xiaohongshu|xhslink)/i
  };

  const matcher = hostChecks[platform];
  return Boolean(matcher && matcher.test(value));
}

function getValidLinks(links) {
  return normalizeLinks(links).filter((item) => validateLink(item.platform, item.url));
}

function hasValidLinks(links) {
  return getValidLinks(links).length > 0;
}

function hasDuplicatePlatforms(links) {
  const platforms = normalizeLinks(links).map((item) => item.platform);
  return new Set(platforms).size !== platforms.length;
}

function buildProductCard(product) {
  const displayStatus = getDisplayStatus(product);
  const statusMeta = getStatusMeta(displayStatus);
  const qualityMeta = getQualityMeta(product.quality);
  const remainingCount = getRemainingCount(product);

  const coverImage = Array.isArray(product.images)
    ? (product.images[0] || "")
    : (typeof product.images === "string" ? product.images : "");

  return {
    ...product,
    picture: coverImage,
    displayStatus,
    statusLabel: statusMeta.label,
    statusClassName: statusMeta.className,
    qualityLabel: qualityMeta.label,
    qualityClassName: qualityMeta.className,
    typeLabel: getTypeLabel(product),
    title: buildTitle(product),
    priceText: formatPrice(product.price),
    remainingCount,
    coverImage
  };
}

module.exports = {
  PLATFORM_OPTIONS,
  buildProductCard,
  buildTitle,
  formatPrice,
  getDisplayStatus,
  getQualityMeta,
  getRemainingCount,
  getStatusMeta,
  getTypeLabel,
  getValidLinks,
  hasDuplicatePlatforms,
  hasValidLinks,
  normalizeLinks,
  validateLink
};
