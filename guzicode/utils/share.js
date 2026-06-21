const DEFAULT_SHARE_IMAGE = "/assets/logo.jpg";

function ensurePath(path) {
  const value = String(path || "").trim();
  if (!value) {
    return "/user/pages/goods/list/list";
  }
  return value.startsWith("/") ? value : `/${value}`;
}

function serializeQuery(query) {
  if (!query || typeof query !== "object") {
    return "";
  }

  const pairs = Object.keys(query).reduce((result, key) => {
    const value = query[key];
    if (value === undefined || value === null || value === "") {
      return result;
    }
    result.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    return result;
  }, []);

  return pairs.join("&");
}

function buildPath(path, query) {
  const normalizedPath = ensurePath(path);
  const queryString = serializeQuery(query);
  return queryString ? `${normalizedPath}?${queryString}` : normalizedPath;
}

function buildShareAppMessage(config = {}) {
  return {
    title: config.title || "谷圈星社",
    path: buildPath(config.path, config.query),
    imageUrl: config.imageUrl || DEFAULT_SHARE_IMAGE
  };
}

function buildShareTimeline(config = {}) {
  return {
    title: config.title || "谷圈星社",
    query: serializeQuery(config.query),
    imageUrl: config.imageUrl || DEFAULT_SHARE_IMAGE
  };
}

function enableShareMenus() {
  if (!wx.showShareMenu) {
    return;
  }

  wx.showShareMenu({
    menus: ["shareAppMessage", "shareTimeline"]
  });
}

module.exports = {
  DEFAULT_SHARE_IMAGE,
  buildPath,
  buildShareAppMessage,
  buildShareTimeline,
  enableShareMenus,
  serializeQuery
};
