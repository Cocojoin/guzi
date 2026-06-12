function normalizePath(path) {
  return String(path || "").replace(/^\//, "");
}

function buildUrl(path, query = {}) {
  const cleanPath = `/${normalizePath(path)}`;
  const queryEntries = Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (!queryEntries.length) {
    return cleanPath;
  }
  const search = queryEntries
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`)
    .join("&");
  return `${cleanPath}?${search}`;
}

function isSamePage(currentRoute, targetPath, query = {}) {
  if (normalizePath(currentRoute) !== normalizePath(targetPath)) {
    return false;
  }
  const currentPages = getCurrentPages();
  const currentPage = currentPages[currentPages.length - 1];
  const options = (currentPage && currentPage.options) || {};
  return Object.keys(query).every((key) => String(options[key] || "") === String(query[key] || ""));
}

function navigateAdminRoot(path, query = {}) {
  const currentPages = getCurrentPages();
  const currentPage = currentPages[currentPages.length - 1];
  const currentRoute = currentPage && currentPage.route;
  if (isSamePage(currentRoute, path, query)) {
    return;
  }
  wx.reLaunch({
    url: buildUrl(path, query)
  });
}

module.exports = {
  navigateAdminRoot
};
