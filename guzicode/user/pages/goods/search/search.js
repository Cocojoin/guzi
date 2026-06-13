const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");

const SEARCH_HISTORY_KEY = "userGoodsSearchHistory";
const SEARCH_COUNT_KEY = "userSearchCount";

function formatDateValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function buildSearchHistory() {
  return wx.getStorageSync(SEARCH_HISTORY_KEY) || [];
}

function getSearchCounts() {
  return wx.getStorageSync(SEARCH_COUNT_KEY) || {};
}

function saveSearchKeyword(keyword) {
  const history = [keyword]
    .concat(buildSearchHistory().filter((item) => item !== keyword))
    .slice(0, 8);
  wx.setStorageSync(SEARCH_HISTORY_KEY, history);

  const searchCounts = getSearchCounts();
  searchCounts[keyword] = (searchCounts[keyword] || 0) + 1;
  wx.setStorageSync(SEARCH_COUNT_KEY, searchCounts);

  return history;
}

function getHotTerms(products) {
  const searchCounts = getSearchCounts();
  const ipMap = new Map();

  products.forEach((item) => {
    const ip = String(item.ip || "").trim();
    if (!ip) return;
    const existing = ipMap.get(ip);
    const latestTime = Math.max(
      formatDateValue(item.updatedAt),
      formatDateValue(item.createdAt)
    );
    if (existing) {
      existing.count += 1;
      existing.latestTime = Math.max(existing.latestTime, latestTime);
    } else {
      ipMap.set(ip, { ip, count: 1, latestTime });
    }
  });

  return [...ipMap.values()]
    .sort((left, right) => {
      const leftScore = searchCounts[left.ip] || 0;
      const rightScore = searchCounts[right.ip] || 0;
      if (rightScore !== leftScore) return rightScore - leftScore;
      if (right.latestTime !== left.latestTime) return right.latestTime - left.latestTime;
      return right.count - left.count;
    })
    .slice(0, 8)
    .map((item) => item.ip);
}

Page({
  data: {
    keyword: "",
    autoFocus: true,
    searchHistory: [],
    hotTerms: [],
    products: [],
    hasSearchResult: false
  },

  onLoad() {
    this.loadSearchMeta();
    this.loadHotTerms();
  },

  loadSearchMeta() {
    this.setData({
      searchHistory: buildSearchHistory()
    });
  },

  async loadHotTerms() {
    try {
      const rawProducts = await productsRepository.getAllProducts();
      const hotTerms = getHotTerms(rawProducts);
      this.setData({ hotTerms });
    } catch (error) {
      console.error("加载热门IP失败:", error);
    }
  },

  onInput(event) {
    this.setData({
      keyword: event.detail.value
    });
  },

  onConfirm() {
    const keyword = String(this.data.keyword || "").trim();
    if (!keyword) {
      return;
    }

    saveSearchKeyword(keyword);
    this.searchProducts(keyword);
  },

  useKeyword(event) {
    const keyword = event.currentTarget.dataset.keyword || "";
    if (!keyword) return;

    this.setData({ keyword });
    saveSearchKeyword(keyword);
    this.searchProducts(keyword);
  },

  clearHistory() {
    wx.removeStorageSync(SEARCH_HISTORY_KEY);
    this.setData({
      searchHistory: []
    });
  },

  async searchProducts(keyword) {
    wx.showLoading({ title: "搜索中", mask: true });

    try {
      const rawProducts = await productsRepository.getAllProducts();
      const products = rawProducts
        .map(buildProductCard)
        .filter((item) => item.displayStatus === "up")
        .filter((item) => {
          const searchText = [item.ip, item.role, item.series, item.type]
            .join("|")
            .toLowerCase();
          return searchText.includes(keyword.toLowerCase());
        })
        .map((item) => ({
          ...item,
          ipInitial: String(item.ip || "").trim().slice(0, 1) || "谷",
          displayTitle: (item.role && item.series)
            ? `${item.role} · ${item.series}`
            : (item.ip || "未命名"),
          displayType: item.typeLabel || "小卡"
        }))
        .sort((left, right) => {
          return Math.max(formatDateValue(right.updatedAt), formatDateValue(right.createdAt))
            - Math.max(formatDateValue(left.updatedAt), formatDateValue(left.createdAt));
        });

      wx.hideLoading();

      this.setData({
        products,
        hasSearchResult: true,
        searchHistory: buildSearchHistory()
      });
    } catch (error) {
      console.error("搜索失败:", error);
      wx.hideLoading();
      wx.showToast({ title: "搜索失败，请重试", icon: "none" });
    }
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    wx.navigateTo({
      url: `/user/pages/goods/detail/detail?id=${id}`
    });
  }
});
