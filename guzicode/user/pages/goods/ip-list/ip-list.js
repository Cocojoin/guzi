const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { debounce } = require("../../../../utils/debounce");

function uniqueOptions(products, key, label) {
  const values = Array.from(new Set(
    products
      .map((item) => String(item[key] || "").trim())
      .filter(Boolean)
  )).sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

  return [label].concat(values);
}

function formatDateValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

Page({
  data: {
    mode: "ip",
    pageTitle: "商品列表",
    searchPlaceholder: "搜索角色 / 系列名",
    ip: "",
    keyword: "",
    loading: true,
    hasLoaded: false,
    allProducts: [],
    products: [],
    roleOptions: ["角色"],
    seriesOptions: ["系列"],
    roleIndex: 0,
    seriesIndex: 0,
    activeDropdown: "",
    emptyTitle: "暂无商品",
    emptyDesc: "",
    error: false
  },

  onLoad(options) {
    const mode = options.mode === "search" ? "search" : "ip";
    const ip = decodeURIComponent(options.ip || "");
    const keyword = decodeURIComponent(options.keyword || "");

    this.goBack = debounce(this.goBack.bind(this), 500);
    this.goDetail = debounce(this.goDetail.bind(this), 500);
    this.onSearchConfirm = debounce(this.onSearchConfirm.bind(this), 300);

    const navTitle = mode === "search" ? "搜索结果" : (ip || "商品列表");

    this.setData({
      mode,
      ip,
      keyword,
      pageTitle: navTitle,
      searchPlaceholder: mode === "search" ? "搜索 IP / 角色 / 系列名" : "搜索角色 / 系列名"
    });

    wx.setNavigationBarTitle({ title: navTitle });
  },

  onShow() {
    this.loadProducts();
  },

  onPullDownRefresh() {
    this.loadProducts().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadProducts() {
    if (!this.data.hasLoaded) {
      this.setData({ loading: true, error: false });
    }

    try {
      const rawProducts = await productsRepository.getAllProducts();
      const allProducts = rawProducts
        .map((rawItem) => {
          const built = buildProductCard(rawItem);
          const roleSeriesTitle = (rawItem.role && rawItem.series)
            ? `${rawItem.role} · ${rawItem.series}`
            : (built.title || "未命名商品");
          const ipInfo = (rawItem.role && rawItem.ip)
            ? `${rawItem.role} · ${rawItem.ip}`
            : (rawItem.ip || "未分 IP");
          return {
            ...built,
            ipInitial: String(rawItem.ip || "").trim().slice(0, 1) || "谷",
            roleInitial: String(rawItem.role || "").trim().slice(0, 1) || "",
            displayTitle: roleSeriesTitle,
            displayType: built.typeLabel || "小卡",
            displayIpInfo: ipInfo,
            originalTitle: rawItem.title || ""
          };
        })
        .filter((item) => item.displayStatus === "up")
        .filter((item) => {
          if (this.data.mode !== "ip") return true;
          return String(item.ip || "").trim() === this.data.ip;
        })
        .sort((left, right) => {
          return Math.max(formatDateValue(right.updatedAt), formatDateValue(right.createdAt))
            - Math.max(formatDateValue(left.updatedAt), formatDateValue(left.createdAt));
        });

      this.setData({
        allProducts,
        roleOptions: uniqueOptions(allProducts, "role", "角色"),
        seriesOptions: uniqueOptions(allProducts, "series", "系列"),
        roleIndex: 0,
        seriesIndex: 0,
        loading: false,
        hasLoaded: true,
        error: false
      });
      this.applyFilters();
    } catch (error) {
      console.error("商品列表加载失败:", error);
      this.setData({
        loading: false,
        hasLoaded: true,
        error: true,
        products: []
      });
      wx.showToast({ title: "加载失败，请重试", icon: "none" });
    }
  },

  applyFilters() {
    const keyword = String(this.data.keyword || "").trim().toLowerCase();
    const role = this.data.roleOptions[this.data.roleIndex];
    const series = this.data.seriesOptions[this.data.seriesIndex];

    const products = this.data.allProducts.filter((item) => {
      if (role !== "角色" && item.role !== role) return false;
      if (series !== "系列" && item.series !== series) return false;
      if (!keyword) return true;

      const searchFields = this.data.mode === "search"
        ? [item.ip, item.role, item.series]
        : [item.role, item.series];

      return searchFields.join("|").toLowerCase().includes(keyword);
    });

    let emptyTitle = "暂无商品";
    let emptyDesc = "";
    if (this.data.mode === "search") {
      emptyTitle = "未找到相关商品";
      emptyDesc = "换个关键词或筛选条件试试";
    } else if (!this.data.loading) {
      emptyTitle = "该 IP 暂无上架商品";
    }

    this.setData({
      products,
      emptyTitle,
      emptyDesc
    });
  },

  onSearchInput(event) {
    this.setData({
      keyword: event.detail.value
    });
  },

  onSearchConfirm() {
    this.applyFilters();
  },

  clearKeyword() {
    this.setData({
      keyword: ""
    }, () => {
      this.applyFilters();
    });
  },

  toggleDropdown(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({
      activeDropdown: this.data.activeDropdown === key ? "" : key
    });
  },

  closeDropdown() {
    this.setData({
      activeDropdown: ""
    });
  },

  onDropdownSelect(event) {
    const { key, index } = event.currentTarget.dataset;
    this.setData({
      [`${key}Index`]: Number(index),
      activeDropdown: ""
    }, () => {
      this.applyFilters();
    });
  },

  resetFilters() {
    this.setData({
      roleIndex: 0,
      seriesIndex: 0,
      activeDropdown: ""
    }, () => {
      this.applyFilters();
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/user/pages/goods/list/list" })
    });
  },

  retryLoad() {
    this.setData({
      loading: true,
      error: false
    });
    this.loadProducts();
  },

  goDetail(event) {
    const id = event.currentTarget.dataset.id;
    if (!id) return;

    wx.navigateTo({
      url: `/user/pages/goods/detail/detail?id=${id}`
    });
  }
});
