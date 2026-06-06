const { PLATFORM_OPTIONS, getDisplayStatus, hasDuplicatePlatforms, validateLink } = require("./productPresentation");

function createEmptyLink() {
  return {
    platform: PLATFORM_OPTIONS[0],
    platformIndex: 0,
    url: ""
  };
}

function buildOwnerOptions(products) {
  return Array.from(new Set((products || []).map((item) => item.owner).filter(Boolean)));
}

function sanitizeLinks(links) {
  return (Array.isArray(links) ? links : [])
    .map((item) => ({
      platform: item.platform || PLATFORM_OPTIONS[0],
      platformIndex: Math.max(0, PLATFORM_OPTIONS.indexOf(item.platform || PLATFORM_OPTIONS[0])),
      url: String(item.url || "").trim()
    }))
    .filter((item) => item.platform || item.url);
}

function getValidLinks(links) {
  return sanitizeLinks(links).filter((item) => validateLink(item.platform, item.url));
}

function validateProductForm(form, options = {}) {
  const products = options.products || [];
  const currentProduct = options.currentProduct || null;
  const errors = {};

  if (!String(form.owner || "").trim()) {
    errors.owner = "请选择或填写寄售用户";
  }

  ["role", "series", "ip"].forEach((field) => {
    if (!String(form[field] || "").trim()) {
      errors[field] = "请完整填写基础信息";
    }
  });

  if (form.type === "自定义" && !String(form.customType || "").trim()) {
    errors.customType = "请填写自定义类型";
  }

  const totalQuantity = Number(form.totalQuantity);
  if (!Number.isInteger(totalQuantity) || totalQuantity <= 0) {
    errors.totalQuantity = "数量必须为大于 0 的整数";
  }

  const soldBase = Number((currentProduct && currentProduct.soldCount) || 0) + Number((currentProduct && currentProduct.settledCount) || 0);
  if (!errors.totalQuantity && totalQuantity < soldBase) {
    errors.totalQuantity = "数量不能小于已售出与已结算总数";
  }

  const price = Number(form.price);
  if (!Number.isFinite(price) || price <= 0) {
    errors.price = "请填写正确的价格";
  }

  if (!form.quality) {
    errors.quality = "请选择质量";
  }

  if (!form.purchaseRecord) {
    errors.purchaseRecord = "请选择购买记录";
  }

  const links = sanitizeLinks(form.links);
  if (hasDuplicatePlatforms(links)) {
    errors.links = "同一商品不能重复填写相同平台链接";
  }

  const validLinks = getValidLinks(links);
  const nextDisplayStatus = getNextDisplayStatus(form, currentProduct);
  if (nextDisplayStatus === "up" && !validLinks.length) {
    errors.links = "请至少填写 1 条购物平台链接后再上架";
  }

  if (!errors.links && links.some((item) => item.url && !validateLink(item.platform, item.url))) {
    errors.links = "仅支持拼多多 / 淘宝 / 小红书合法链接";
  }

  if (String(form.remark || "").length > 200) {
    errors.remark = "备注字数不能超过 200 个";
  }

  return {
    isValid: !Object.keys(errors).length,
    errors,
    value: {
      owner: String(form.owner || "").trim(),
      role: String(form.role || "").trim(),
      series: String(form.series || "").trim(),
      ip: String(form.ip || "").trim(),
      type: form.type,
      customType: String(form.customType || "").trim(),
      totalQuantity,
      price,
      quality: form.quality,
      purchaseRecord: form.purchaseRecord,
      remark: String(form.remark || "").trim(),
      links: validLinks
    }
  };
}

function getNextDisplayStatus(form, currentProduct) {
  if (!currentProduct) {
    return form.status || "down";
  }

  const next = {
    ...currentProduct,
    totalQuantity: Number(form.totalQuantity),
    status: currentProduct.status
  };

  return getDisplayStatus(next);
}

module.exports = {
  PLATFORM_OPTIONS,
  buildOwnerOptions,
  createEmptyLink,
  getValidLinks,
  sanitizeLinks,
  validateProductForm
};
