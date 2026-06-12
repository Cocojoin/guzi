const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { debounce } = require("../../../../utils/debounce");

const SEARCH_HISTORY_KEY = "userGoodsSearchHistory";
const SEARCH_COUNT_KEY = "userSearchCount";

function uniqueOptions(products, key, label) {
  const values = Array.from(new Set(products.map((item) => String(item[key] || "").trim()).filter(Boolean)));
  return [label].concat(values);
}

function getHotIPs(allProducts) {
  const searchCounts = wx.getStorageSync(SEARCH_COUNT_KEY) || {};
  const ipCounts = {};
  allProducts.forEach(item => {
    const ip = String(item.ip || "").trim();
    if (ip) {
      ipCounts[ip] = (searchCounts[ip] || 0);
    }
  });
  return Object.keys(ipCounts).sort((a, b) => (ipCounts[b] || 0) - (ipCounts[a] || 0)).slice(0, 6);
}

Page({
  data: {
    allProducts: [],
    products: [],
    keyword: "",
    searchMode: false,
    submitting: false,
    showResult: true,
    searchHistory: [],
    hotTerms: [],
    activeDropdown: "",
    roleOptions: ["角色"],
    ipOptions: ["IP"],
    roleIndex: 0,
    ipIndex: 0,
    loading: true,
    hasLoaded: false
  },

  onLoad() {
    this.goBack = debounce(this.goBack.bind(this), 800);
    this.onSearchConfirm = debounce(this.onSearchConfirm.bind(this), 500);
    this.goDetail = debounce(this.goDetail.bind(this), 800);
  },

  syncTabBarVisibility(hidden) {
    const method = hidden ? "hideTabBar" : "showTabBar";
    if (typeof wx[method] === "function") {
      wx[method]({ animation: false });
    }
  },

  goBack() {
    if (this.data.searchMode && this.data.showResult) {
      this.setData({ showResult: false });
      return;
    }
    if (this.data.searchMode) {
      this.syncTabBarVisibility(false);
      this.setData({
        searchMode: false,
        showResult: true,
        keyword: ''
      }, () => {
        this.applyFilters();
      });
      return;
    }
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({ url: "/user/pages/index/index" });
    }
  },

  onShow() {
    this.syncTabBarVisibility(this.data.searchMode);
    this.loadSearchHistory();
    if (!this.data.searchMode) {
      this.setData({ showResult: true });
    }
    this.loadProducts();
  },

  onHide() {
    this.syncTabBarVisibility(false);
  },

  onUnload() {
    this.syncTabBarVisibility(false);
  },

  loadSearchHistory() {
    this.setData({
      searchHistory: wx.getStorageSync(SEARCH_HISTORY_KEY) || []
    });
  },

  async loadProducts() {
    if (!this.data.allProducts.length) {
      this.setData({ loading: true });
    }
    try {
      const rawProducts = await productsRepository.getAllProducts();
      const processedProducts = rawProducts.map(buildProductCard);
      const allProducts = processedProducts
        .filter((item) => item.displayStatus === "up")
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));

      const hotTerms = getHotIPs(allProducts);

      this.setData({
        allProducts,
        hotTerms,
        roleOptions: uniqueOptions(allProducts, "role", "角色"),
        ipOptions: uniqueOptions(allProducts, "ip", "IP"),
        loading: false,
        hasLoaded: true
      });
      this.applyFilters();
    } catch (error) {
      console.error("商品加载错误:", error);
      this.setData({ loading: false });
      wx.showToast({ title: "商品加载失败", icon: "none" });
    }
  },

  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const role = this.data.roleOptions[this.data.roleIndex];
    const ip = this.data.ipOptions[this.data.ipIndex];

    const products = this.data.allProducts.filter((item) => {
      if (role !== "角色" && item.role !== role) return false;
      if (ip !== "IP" && item.ip !== ip) return false;
      if (!keyword) return true;
      return [item.ip, item.role, item.series].join("|").toLowerCase().includes(keyword);
    });

    this.setData({ products });
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value });
  },

  onSearchFocus() {
    this.syncTabBarVisibility(true);
    this.setData({
      searchMode: true,
      showResult: false,
      activeDropdown: ""
    });
  },

  onSearchConfirm() {
    const keyword = this.data.keyword.trim();
    if (!keyword) {
      return;
    }
    
    this.recordSearch(keyword);
    
    const history = [keyword]
      .concat(this.data.searchHistory.filter((item) => item !== keyword))
      .slice(0, 6);
    wx.setStorageSync(SEARCH_HISTORY_KEY, history);
    
    this.setData({
      searchHistory: history,
      searchMode: true,
      showResult: true
    });
    
    this.applyFilters();
  },

  recordSearch(keyword) {
    const searchCounts = wx.getStorageSync(SEARCH_COUNT_KEY) || {};
    searchCounts[keyword] = (searchCounts[keyword] || 0) + 1;
    wx.setStorageSync(SEARCH_COUNT_KEY, searchCounts);
    
    this.updateHotTerms();
  },

  updateHotTerms() {
    const hotTerms = getHotIPs(this.data.allProducts);
    this.setData({ hotTerms });
  },

  clearKeyword() {
    this.setData({
      keyword: "",
      searchMode: true,
      showResult: false
    });
  },

  useKeyword(event) {
    const keyword = event.currentTarget.dataset.keyword || "";
    this.setData({
      keyword,
      searchMode: true
    }, () => {
      this.onSearchConfirm();
    });
  },

  clearHistory() {
    wx.removeStorageSync(SEARCH_HISTORY_KEY);
    this.setData({ searchHistory: [] });
  },

  toggleDropdown(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({
      activeDropdown: this.data.activeDropdown === key ? "" : key
    });
  },

  closeDropdown() {
    this.setData({ activeDropdown: "" });
  },

  onDropdownSelect(event) {
    const { key, index } = event.currentTarget.dataset;
    this.setData({
      [`${key}Index`]: Number(index),
      activeDropdown: ""
    });
    this.applyFilters();
  },

  goDetail(event) {
    wx.navigateTo({
      url: `/user/pages/goods/detail/detail?id=${event.currentTarget.dataset.id}`
    });
  }
});
