const session = require("../../../../utils/session");
const usersRepository = require("../../../../utils/usersRepository");
const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { debounce } = require("../../../../utils/debounce");

function belongsToUser(product, user) {
  return product.ownerUserId === user._id || product.owner === user.nickname || product.owner === user.account;
}

function uniqueOptions(products, key, label) {
  const values = Array.from(new Set(products.map(function(item) {
    return String(item[key] || "").trim();
  }).filter(Boolean)));
  return [label].concat(values);
}

Page({
  data: {
    allProducts: [],
    products: [],
    keyword: "",
    submitting: false,
    activeDropdown: "",
    roleOptions: ["角色"],
    ipOptions: ["IP"],
    statusOptions: ["状态", "已上架", "已下架", "已售出", "已结算"],
    roleIndex: 0,
    ipIndex: 0,
    statusIndex: 0,
    loading: true,
    hasLoaded: false
  },

  onLoad() {
    this.goBack = debounce(this.goBack.bind(this), 800);
    this.goAdd = debounce(this.goAdd.bind(this), 800);
    this.goDetail = debounce(this.goDetail.bind(this), 800);
  },

  async onShow() {
    await this.loadProducts();
  },

  async getCurrentUser() {
    const current = session.getSession();
    if (!current) return null;
    const user = await usersRepository.getUserById(current.userId);
    return { 
      ...user, 
      _id: current.userId, 
      account: current.account, 
      nickname: String((user && user.nickname) || current.account || "") 
    };
  },

  async loadProducts() {
    this.setData({ loading: true });
    try {
      const user = await this.getCurrentUser();
      if (!user) {
        wx.reLaunch({ url: "/auth/pages/login/login" });
        return;
      }
      
      // 清除所有可能的缓存，强制重新获取
      if (wx.clearStorageSync) {
        try {
          // 不清除全部，只清除可能影响的
          const keys = wx.getStorageInfoSync().keys;
          if (Array.isArray(keys)) {
            keys.forEach(function(key) {
              if (key && key.indexOf("product") !== -1) {
                try {
                  wx.removeStorageSync(key);
                } catch (e) {}
              }
            });
          }
        } catch (e) {}
      }
      
      const allProducts = (await productsRepository.getAllProducts())
        .map(buildProductCard)
        .filter(function(item) {
          return belongsToUser(item, user);
        })
        .sort(function(left, right) {
          const leftTime = left.updatedAt ? new Date(left.updatedAt).getTime() : 0;
          const rightTime = right.updatedAt ? new Date(right.updatedAt).getTime() : 0;
          return rightTime - leftTime;
        });

      this.setData({
        allProducts: allProducts,
        roleOptions: uniqueOptions(allProducts, "role", "角色"),
        ipOptions: uniqueOptions(allProducts, "ip", "IP"),
        loading: false,
        hasLoaded: true
      });
      this.applyFilters();
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: "寄售商品加载失败", icon: "none" });
    }
  },

  applyFilters() {
    const keyword = this.data.keyword.trim().toLowerCase();
    const role = this.data.roleOptions[this.data.roleIndex];
    const ip = this.data.ipOptions[this.data.ipIndex];
    const status = this.data.statusOptions[this.data.statusIndex];

    const products = this.data.allProducts.filter(function(item) {
      if (role !== "角色" && item.role !== role) return false;
      if (ip !== "IP" && item.ip !== ip) return false;
      
      if (status !== "状态") {
        if (status === "已上架" && item.displayStatus !== "up") return false;
        if (status === "已下架" && item.displayStatus !== "down") return false;
        if (status === "已售出" && item.displayStatus !== "sold") return false;
        if (status === "已结算" && item.displayStatus !== "settled") return false;
      }

      if (!keyword) return true;
      return [item.title, item.ip, item.id, item.role, item.series].join("|").toLowerCase().includes(keyword);
    });

    this.setData({ products: products });
  },

  onSearchInput(event) {
    this.setData({ keyword: event.detail.value });
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
    const key = event.currentTarget.dataset.key;
    const index = event.currentTarget.dataset.index;
    this.setData({
      [key + "Index"]: Number(index),
      activeDropdown: ""
    });
    this.applyFilters();
  },

  goBack() {
    wx.navigateBack();
  },

  goAdd() {
    wx.navigateTo({ url: "/user/pages/consignment/upload/upload" });
  },

  goDetail(event) {
    const product = this.data.products.find(function(item) {
      return item.id === event.currentTarget.dataset.id;
    });
    const editable = product && product.displayStatus === "down" ? "1" : "0";
    wx.navigateTo({ 
      url: "/user/pages/goods/detail/detail?id=" + event.currentTarget.dataset.id + "&editable=" + editable 
    });
  }
});
