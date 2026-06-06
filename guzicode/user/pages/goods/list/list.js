const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");

const SEARCH_HISTORY_KEY = "userGoodsSearchHistory";
const SEARCH_COUNT_KEY = "userSearchCount";

function uniqueOptions(products, key, label) {
  const values = Array.from(new Set(products.map((item) => String(item[key] || "").trim()).filter(Boolean)));
  return [label].concat(values);
}

function isConsignmentProduct(product) {
  return !!String(product.ownerUserId || "").trim() || !!String(product.owner || "").trim();
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

  syncTabBarVisibility(hidden) {
    const method = hidden ? "hideTabBar" : "showTabBar";
    if (typeof wx[method] === "function") {
      wx[method]({ animation: false });
    }
  },

  goBack() {
    // 如果在搜索模式且显示搜索结果，先回到搜索输入页面
    if (this.data.searchMode && this.data.showResult) {
      this.setData({
        showResult: false
      });
      return;
    }
    // 如果在搜索模式但不在搜索结果页面（显示搜索历史），退出搜索模式
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
    // 非搜索模式，按正常逻辑返回
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.switchTab({
        url: "/user/pages/index/index"
      });
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
      console.log("原始商品数据:", rawProducts);
      
      const processedProducts = rawProducts.map(buildProductCard);
      console.log("buildProductCard 处理后:", processedProducts);
      
      const consignmentProducts = processedProducts.filter(item => {
        const isConsignment = isConsignmentProduct(item);
        console.log(`商品 ${item.id} 是否寄售商品:`, isConsignment, "ownerUserId:", item.ownerUserId, "owner:", item.owner);
        return isConsignment;
      });
      
      const allProducts = consignmentProducts
        .filter(item => {
          const isUp = item.displayStatus === "up";
          console.log(`商品 ${item.id} 状态:`, item.displayStatus, "是否上架:", isUp);
          return isUp;
        })
        .sort((left, right) => new Date(right.createdAt) - new Date(left.createdAt));
      
      console.log("最终过滤后的商品数据:", allProducts);

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
    
    console.log("过滤后的商品:", products);

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

  clearSearch() {
    this.syncTabBarVisibility(false);
    this.setData({
      keyword: "",
      searchMode: false,
      showResult: false,
      activeDropdown: ""
    });
    this.applyFilters();
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

  onFilterChange(event) {
    const { key } = event.currentTarget.dataset;
    this.setData({ [`${key}Index`]: Number(event.detail.value) });
    this.applyFilters();
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