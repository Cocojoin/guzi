const productsRepository = require("../../../../utils/productsRepository");
const usersRepository = require("../../../../utils/usersRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { navigateAdminRoot } = require("../../../../utils/adminNavigation");
const { addOperationLog, formatFailureContext } = require("../../../../utils/adminSettings");
const session = require("../../../../utils/session");
const { debounce } = require("../../../../utils/debounce");

const STATUS_OPTIONS = [
  { label: "全部状态", value: "all" },
  { label: "已上架", value: "up" },
  { label: "已下架", value: "down" },
  { label: "已售出", value: "sold" },
  { label: "已结算", value: "settled" }
];

const STATUS_ORDER = {
  up: 0,
  down: 1,
  sold: 2,
  settled: 3
};

function resolveOwnerName(product, consignmentUsers) {
  const ownerUserId = String(product && product.ownerUserId || "").trim();
  const owner = String(product && product.owner || "").trim();
  const list = Array.isArray(consignmentUsers) ? consignmentUsers : [];

  if (ownerUserId) {
    const matchedById = list.find((item) => String(item && item._id || "").trim() === ownerUserId);
    const nicknameById = String(matchedById && matchedById.nickname || "").trim();
    if (nicknameById) {
      return nicknameById;
    }
  }

  if (owner) {
    const matchedByAccount = list.find((item) => String(item && item.account || "").trim() === owner);
    const nicknameByAccount = String(matchedByAccount && matchedByAccount.nickname || "").trim();
    if (nicknameByAccount) {
      return nicknameByAccount;
    }
  }

  return owner;
}

function sortProducts(products) {
  return products.sort((left, right) => {
    const leftOrder = STATUS_ORDER[left.displayStatus] != null ? STATUS_ORDER[left.displayStatus] : Number.MAX_SAFE_INTEGER;
    const rightOrder = STATUS_ORDER[right.displayStatus] != null ? STATUS_ORDER[right.displayStatus] : Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftTime = new Date(left.updatedAt || left.createdAt || 0).getTime();
    const rightTime = new Date(right.updatedAt || right.createdAt || 0).getTime();
    return rightTime - leftTime;
  });
}

Page({
  data: {
    statusBarHeight: 20,
    navBarHeight: 44,
    contentPaddingTop: 64,
    allProducts: [],
    filteredProducts: [],
    loading: true,
    hasLoaded: false,
    ownerOptions: ["全部用户"],
    ownerIndex: 0,
    statusIndex: 0,
    statusLabels: ["商品状态", "已上架", "已下架", "已售出", "已结算"],
    roleOptions: ["角色"],
    roleIndex: 0,
    searchText: "",
    inputText: "",
    activeDropdown: "",
    multiSelect: false,
    selectedIds: [],
    allSelectableChecked: false
  },

  onLoad(options = {}) {
    this.handleCardTap = debounce(this.handleCardTap.bind(this), 500);
    this.handleBatchDelete = debounce(this.handleBatchDelete.bind(this), 800);
    this.handleBatchUp = debounce(this.handleBatchUp.bind(this), 800);
    this.handleBatchDown = debounce(this.handleBatchDown.bind(this), 800);
    this.handleOpenCreate = debounce(this.handleOpenCreate.bind(this), 500);
    this.goStats = debounce(this.goStats.bind(this), 500);
    this.goGoods = debounce(this.goGoods.bind(this), 500);
    this.goUsers = debounce(this.goUsers.bind(this), 500);
    this.goSettings = debounce(this.goSettings.bind(this), 500);
    
    const currentSession = session.getSession();
    if (!currentSession || currentSession.role !== "admin") {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }
    const status = String(options.status || "all");
    const idx = STATUS_OPTIONS.findIndex((item) => item.value === status);
    if (idx >= 0) {
      this.setData({ statusIndex: idx });
    }
    const sysInfo = wx.getSystemInfoSync();
    const menuBtn = wx.getMenuButtonBoundingClientRect();
    const statusBarHeight = sysInfo.statusBarHeight || 20;
    const capGap = menuBtn ? (menuBtn.top - statusBarHeight) * 2 : 8;
    const navBarHeight = menuBtn ? menuBtn.height + capGap : 44;
    const contentPaddingTop = statusBarHeight + navBarHeight;
    this.setData({ statusBarHeight, navBarHeight, contentPaddingTop });
  },

  async onShow() {
    const currentSession = session.getSession();
    if (!currentSession || currentSession.role !== "admin") {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }
    await this.loadProducts();
  },

  async loadProducts() {
    this.setData({ loading: true });
    try {
      const consignmentUsers = await usersRepository.listConsignmentUsers();
      const allProducts = sortProducts((await productsRepository.getAllProducts()).map((item) => {
        const displayOwner = resolveOwnerName(item, consignmentUsers);
        return buildProductCard({
          ...item,
          owner: displayOwner,
          ownerRaw: item.owner || ""
        });
      }));
      const ownerPool = new Set([
        ...consignmentUsers.map((item) => String(item.nickname || "").trim()).filter(Boolean),
        ...allProducts.map((item) => String(item.owner || "").trim()).filter(Boolean)
      ]);
      const ownerOptions = ["全部用户"].concat(Array.from(ownerPool));

      let ownerIndex = this.data.ownerIndex;
      if (ownerIndex >= ownerOptions.length) {
        ownerIndex = 0;
      }

      const rolePool = new Set(allProducts.map((item) => String(item.role || "").trim()).filter(Boolean));
      const roleOptions = ["全部角色"].concat(Array.from(rolePool));

      let roleIndex = this.data.roleIndex;
      if (roleIndex >= roleOptions.length) {
        roleIndex = 0;
      }

      const selectedIds = this.data.selectedIds.filter((id) => allProducts.some((item) => item.id === id));

      this.setData({
        allProducts,
        ownerOptions,
        ownerIndex,
        roleOptions,
        roleIndex,
        selectedIds,
        loading: false,
        hasLoaded: true
      });

      this.applyFilters();
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({
        title: "商品数据加载失败",
        icon: "none"
      });
    }
  },

  applyFilters() {
    const keyword = this.data.searchText.trim().toLowerCase();
    const owner = this.data.ownerOptions[this.data.ownerIndex];
    const status = STATUS_OPTIONS[this.data.statusIndex].value;
    const role = this.data.roleOptions[this.data.roleIndex];

    const filteredProducts = this.data.allProducts
      .filter((item) => {
        if (owner !== "全部用户" && item.owner !== owner) {
          return false;
        }

        if (status !== "all" && item.displayStatus !== status) {
          return false;
        }

        if (role !== "全部角色" && item.role !== role) {
          return false;
        }

        if (!keyword) {
          return true;
        }

        return [item.role, item.series, item.ip, item.owner, item.ownerRaw, item.id]
          .join("|")
          .toLowerCase()
          .includes(keyword);
      })
      .map((item) => {
        const selectable = ["up", "down"].includes(item.displayStatus);
        return {
          ...item,
          selectable,
          selected: this.data.selectedIds.includes(item.id)
        };
      });

    const selectableIds = filteredProducts.filter((item) => item.selectable).map((item) => item.id);
    const allSelectableChecked = Boolean(
      selectableIds.length && selectableIds.every((id) => this.data.selectedIds.includes(id))
    );

    this.setData({
      filteredProducts,
      allSelectableChecked
    });
  },

  onSearchInput(event) {
    this.setData({
      inputText: event.detail.value
    });
  },

  doSearch() {
    this.setData({
      searchText: this.data.inputText
    });
    this.applyFilters();
  },

  clearSearch() {
    this.setData({
      inputText: "",
      searchText: ""
    });
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
    const idx = Number(index);
    if (key === "owner") {
      this.setData({ ownerIndex: idx, activeDropdown: "" });
    } else if (key === "status") {
      this.setData({ statusIndex: idx, activeDropdown: "" });
    } else if (key === "role") {
      this.setData({ roleIndex: idx, activeDropdown: "" });
    }
    this.applyFilters();
  },

  toggleMultiSelect() {
    if (this.data.multiSelect) {
      this.setData({
        multiSelect: false,
        selectedIds: [],
        allSelectableChecked: false
      });
      this.applyFilters();
      return;
    }

    this.setData({
      multiSelect: true
    });
    this.applyFilters();
  },

  handleCardTap(event) {
    const { id } = event.currentTarget.dataset;

    if (this.data.multiSelect) {
      this.toggleSelectionById(id);
      return;
    }

    wx.navigateTo({
      url: `/admin/pages/goods/detail/detail?id=${id}`
    });
  },

  toggleSelectionById(id) {
    const target = this.data.filteredProducts.find((item) => item.id === id);
    if (!target || !target.selectable) {
      wx.showToast({
        title: "已售出或已结算商品不支持批量操作",
        icon: "none"
      });
      return;
    }

    const selectedSet = new Set(this.data.selectedIds);
    if (selectedSet.has(id)) {
      selectedSet.delete(id);
    } else {
      selectedSet.add(id);
    }

    this.setData({
      selectedIds: Array.from(selectedSet)
    });
    this.applyFilters();
  },

  toggleSelectAll() {
    const selectableIds = this.data.filteredProducts.filter((item) => item.selectable).map((item) => item.id);
    if (!selectableIds.length) {
      wx.showToast({
        title: "当前列表没有可批量操作的商品",
        icon: "none"
      });
      return;
    }

    if (this.data.allSelectableChecked) {
      const remaining = this.data.selectedIds.filter((id) => !selectableIds.includes(id));
      this.setData({
        selectedIds: remaining
      });
    } else {
      const merged = Array.from(new Set(this.data.selectedIds.concat(selectableIds)));
      this.setData({
        selectedIds: merged
      });
    }

    this.applyFilters();
  },

  handleBatchDelete() {
    if (!this.data.selectedIds.length) {
      wx.showToast({
        title: "请先选择商品",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "确认删除",
      content: "确认删除所选商品吗？删除后不可恢复。",
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }

        try {
          await productsRepository.deleteProducts(this.data.selectedIds);
          await addOperationLog({
            title: "批量删除商品",
            target: `${this.data.selectedIds.length} 件商品`,
            type: "商品",
            note: this.data.selectedIds.slice(0, 5).join("、")
          });
          wx.showToast({
            title: "删除成功",
            icon: "success"
          });
          this.setData({
            multiSelect: false,
            selectedIds: []
          });
          await this.loadProducts();
        } catch (error) {
          await addOperationLog({
            title: "批量删除商品",
            target: `${this.data.selectedIds.length} 件商品`,
            type: "商品",
            note: formatFailureContext(error, this.data.selectedIds.slice(0, 5).join("、")),
            success: false
          });
          wx.showToast({
            title: "删除失败，请重试",
            icon: "none"
          });
        }
      }
    });
  },

  handleBatchStatus() {
    if (!this.data.selectedIds.length) {
      wx.showToast({
        title: "请先选择商品",
        icon: "none"
      });
      return;
    }

    wx.navigateTo({
      url: `/admin/pages/goods/batch-status/batch-status?ids=${this.data.selectedIds.join(",")}`
    });
  },

  getSelectedProducts() {
    return this.data.allProducts.filter((item) => this.data.selectedIds.includes(item.id));
  },

  handleBatchUp() {
    const selectedProducts = this.getSelectedProducts();
    if (selectedProducts.some((item) => ["sold", "settled"].includes(item.displayStatus))) {
      wx.showToast({
        title: "已售出商品请到详情页单独修改状态",
        icon: "none"
      });
      return;
    }

    if (selectedProducts.some((item) => item.displayStatus !== "down")) {
      wx.showToast({
        title: "请仅选择待上架商品后重试",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "确认上架",
      content: `确认将所选 ${selectedProducts.length} 件商品上架吗？`,
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }
        try {
          await productsRepository.bulkUpdateStatus(this.data.selectedIds, "up");
          await addOperationLog({
            title: "批量上架商品",
            target: `${this.data.selectedIds.length} 件商品`,
            type: "商品",
            note: this.data.selectedIds.slice(0, 5).join("、")
          });
          wx.showToast({
            title: "状态修改成功",
            icon: "success"
          });
          this.setData({
            multiSelect: false,
            selectedIds: []
          });
          await this.loadProducts();
        } catch (error) {
          await addOperationLog({
            title: "批量上架商品",
            target: `${this.data.selectedIds.length} 件商品`,
            type: "商品",
            note: formatFailureContext(error, this.data.selectedIds.slice(0, 5).join("、")),
            success: false
          });
          wx.showToast({
            title: "状态修改失败",
            icon: "none"
          });
        }
      }
    });
  },

  handleBatchDown() {
    const selectedProducts = this.getSelectedProducts();
    if (selectedProducts.some((item) => ["sold", "settled"].includes(item.displayStatus))) {
      wx.showToast({
        title: "请仅选择可流转的商品后重试",
        icon: "none"
      });
      return;
    }

    if (selectedProducts.some((item) => item.displayStatus !== "up")) {
      wx.showToast({
        title: "请仅选择已上架商品后重试",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "确认下架",
      content: `确认将所选 ${selectedProducts.length} 件商品下架吗？`,
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }

        try {
          await productsRepository.bulkUpdateStatus(this.data.selectedIds, "down");
          await addOperationLog({
            title: "批量下架商品",
            target: `${this.data.selectedIds.length} 件商品`,
            type: "商品",
            note: this.data.selectedIds.slice(0, 5).join("、")
          });
          wx.showToast({
            title: "状态修改成功",
            icon: "success"
          });
          this.setData({
            multiSelect: false,
            selectedIds: []
          });
          await this.loadProducts();
        } catch (error) {
          await addOperationLog({
            title: "批量下架商品",
            target: `${this.data.selectedIds.length} 件商品`,
            type: "商品",
            note: formatFailureContext(error, this.data.selectedIds.slice(0, 5).join("、")),
            success: false
          });
          wx.showToast({
            title: "状态修改失败",
            icon: "none"
          });
        }
      }
    });
  },

  handleOpenCreate() {
    wx.showActionSheet({
      itemList: ["单个上传", "批量上传"],
      success: ({ tapIndex }) => {
        if (tapIndex === 0) {
          wx.navigateTo({
            url: "/admin/pages/goods/upload/upload"
          });
          return;
        }

        wx.navigateTo({
          url: "/admin/pages/goods/batch-upload/batch-upload"
        });
      }
    });
  },

  goStats() {
    navigateAdminRoot("/admin/pages/stats/stats");
  },

  goGoods() {
    navigateAdminRoot("/admin/pages/goods/list/list");
  },

  goUsers() {
    navigateAdminRoot("/admin/pages/users/users");
  },

  goSettings() {
    navigateAdminRoot("/admin/pages/settings/settings");
  }
});
