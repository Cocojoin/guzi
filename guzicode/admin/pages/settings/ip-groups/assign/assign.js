const session = require("../../../../../utils/session");
const { debounce } = require("../../../../../utils/debounce");
const { addOperationLog, formatFailureContext } = require("../../../../../utils/adminSettings");
const { listAssignableProducts, assignProductsToIp } = require("../../../../../utils/ipGroupsRepository");

Page({
  data: {
    name: "",
    keyword: "",
    products: [],
    filteredProducts: [],
    loading: true,
    hasLoaded: false,
    selectedIds: []
  },

  onLoad(options) {
    const currentSession = session.getSession();
    if (!currentSession || currentSession.role !== "admin") {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }

    this.goBack = debounce(this.goBack.bind(this), 500);
    this.submitAssign = debounce(this.submitAssign.bind(this), 800);

    this.setData({
      name: decodeURIComponent(options.name || "")
    });
  },

  onShow() {
    this.loadProducts();
  },

  async loadProducts() {
    this.setData({ loading: true });
    try {
      const products = await listAssignableProducts(this.data.name);
      this.setData({
        products: products.map((item) => ({
          ...item,
          selected: false
        })),
        loading: false,
        hasLoaded: true,
        selectedIds: []
      });
      this.applyFilters();
    } catch (error) {
      console.error("load assignable products error:", error);
      this.setData({
        loading: false,
        hasLoaded: true
      });
      wx.showToast({
        title: "商品数据加载失败",
        icon: "none"
      });
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: "/admin/pages/settings/ip-groups/ip-groups" });
      }
    });
  },

  onKeywordInput(event) {
    this.setData({
      keyword: event.detail.value
    });
    this.applyFilters();
  },

  clearKeyword() {
    this.setData({
      keyword: ""
    });
    this.applyFilters();
  },

  applyFilters() {
    const keyword = String(this.data.keyword || "").trim().toLowerCase();
    const selectedSet = new Set(this.data.selectedIds);
    const filteredProducts = this.data.products.filter((item) => {
      if (!keyword) return true;
      return [item.id, item.title, item.role, item.series, item.currentIp]
        .join("|")
        .toLowerCase()
        .includes(keyword);
    }).map((item) => ({
      ...item,
      selected: selectedSet.has(item.id)
    }));

    const validSelectedIds = this.data.selectedIds.filter((id) => filteredProducts.some((item) => item.id === id && !item.alreadyInTarget));
    this.setData({
      filteredProducts,
      selectedIds: validSelectedIds
    });
  },

  toggleSelection(event) {
    const { id } = event.currentTarget.dataset;
    const item = this.data.filteredProducts.find((product) => product.id === id);
    if (!item || item.alreadyInTarget) {
      return;
    }

    const selected = new Set(this.data.selectedIds);
    if (selected.has(id)) {
      selected.delete(id);
    } else {
      selected.add(id);
    }
    const nextSelectedIds = [...selected];
    this.setData({
      selectedIds: nextSelectedIds,
      products: this.data.products.map((product) => ({
        ...product,
        selected: selected.has(product.id)
      }))
    });
    this.applyFilters();
  },

  async submitAssign() {
    if (!this.data.selectedIds.length) {
      wx.showToast({
        title: "请先选择商品",
        icon: "none"
      });
      return;
    }

    try {
      const updated = await assignProductsToIp(this.data.name, this.data.selectedIds);
      await addOperationLog({
        title: "分配商品到 IP",
        target: this.data.name,
        type: "IP管理",
        note: `加入 ${updated.length} 件商品`
      });
      wx.showToast({
        title: "已加入该 IP",
        icon: "success"
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 300);
    } catch (error) {
      wx.showToast({
        title: "分配失败，请重试",
        icon: "none"
      });
      await addOperationLog({
        title: "分配商品到 IP",
        target: this.data.name,
        type: "IP管理",
        success: false,
        note: formatFailureContext(error, "分配商品失败")
      });
    }
  }
});
