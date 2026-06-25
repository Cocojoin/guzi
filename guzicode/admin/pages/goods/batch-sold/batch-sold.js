const productsRepository = require("../../../../utils/productsRepository");
const { addOperationLog, formatFailureContext } = require("../../../../utils/adminSettings");
const { buildProductCard } = require("../../../../utils/productPresentation");
const usersRepository = require("../../../../utils/usersRepository");
const { getUserRateFraction } = require("../../../../utils/consignmentRate");

function clampInt(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return min;
  }
  return Math.max(min, Math.min(max, Math.floor(numeric)));
}

function formatMoneyInput(value) {
  return Number(value || 0).toFixed(2);
}

function sanitizeMoneyInput(value) {
  return String(value || "")
    .replace(/[^\d.]/g, "")
    .replace(/(\..*)\./g, "$1")
    .replace(/^0+(\d)/, "$1");
}

Page({
  data: {
    ids: [],
    items: [],
    remark: "",
    loading: true,
    submitting: false,
    totalSoldQuantity: 0,
    totalSaleAmount: "0.00"
  },

  onLoad(options) {
    const ids = String(options.ids || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    this.setData({ ids });
  },

  async onShow() {
    try {
      const items = (await productsRepository.getProductsByIds(this.data.ids))
        .map(buildProductCard)
        .map((item) => ({
          id: item.id,
          title: item.title,
          remainingCount: item.remainingCount,
          soldQuantity: "",
          unitPrice: Number(item.price || 0),
          saleAmount: ""
        }));

      this.setData({ items, loading: false }, () => this.recalcSummary());
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: "商品加载失败", icon: "none" });
    }
  },

  onQtyInput(event) {
    const id = event.currentTarget.dataset.id;
    const next = this.data.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      const max = Number(item.remainingCount || 0);
      const value = event.detail.value;
      const numeric = value === "" ? "" : String(clampInt(value, 0, max));
      const qty = Number(numeric || 0);
      return {
        ...item,
        soldQuantity: numeric,
        saleAmount: qty > 0 ? formatMoneyInput(item.unitPrice * qty) : ""
      };
    });
    this.setData({ items: next }, () => this.recalcSummary());
  },

  onPriceInput(event) {
    const id = event.currentTarget.dataset.id;
    const next = this.data.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return {
        ...item,
        saleAmount: sanitizeMoneyInput(event.detail.value)
      };
    });
    this.setData({ items: next }, () => this.recalcSummary());
  },

  increaseQty(event) {
    const id = event.currentTarget.dataset.id;
    const next = this.data.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      const max = Number(item.remainingCount || 0);
      const qty = clampInt(Number(item.soldQuantity || 0) + 1, 0, max);
      return {
        ...item,
        soldQuantity: String(qty),
        saleAmount: qty > 0 ? formatMoneyInput(item.unitPrice * qty) : ""
      };
    });
    this.setData({ items: next }, () => this.recalcSummary());
  },

  decreaseQty(event) {
    const id = event.currentTarget.dataset.id;
    const next = this.data.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      const qty = Math.max(0, Number(item.soldQuantity || 0) - 1);
      return {
        ...item,
        soldQuantity: qty > 0 ? String(qty) : "",
        saleAmount: qty > 0 ? formatMoneyInput(item.unitPrice * qty) : ""
      };
    });
    this.setData({ items: next }, () => this.recalcSummary());
  },

  onRemarkInput(event) {
    this.setData({ remark: event.detail.value });
  },

  recalcSummary() {
    const totalSoldQuantity = this.data.items.reduce((sum, item) => sum + Number(item.soldQuantity || 0), 0);
    const totalSaleAmount = this.data.items.reduce((sum, item) => sum + Number(item.saleAmount || 0), 0);
    this.setData({
      totalSoldQuantity,
      totalSaleAmount: formatMoneyInput(totalSaleAmount)
    });
  },

  async handleSubmit() {
    if (this.data.submitting) {
      return;
    }

    if (!this.data.items.length) {
      wx.showToast({ title: "请先选择商品", icon: "none" });
      return;
    }

    const selling = this.data.items
      .map((item) => ({
        ...item,
        qty: Number(item.soldQuantity || 0),
        price: Number(item.unitPrice || 0),
        saleAmount: Number(item.saleAmount || 0)
      }))
      .filter((item) => item.qty > 0);

    if (!selling.length) {
      wx.showToast({ title: "请至少填写 1 个商品的售出数量", icon: "none" });
      return;
    }

    if (selling.some((item) => !Number.isFinite(item.saleAmount) || item.saleAmount <= 0)) {
      wx.showToast({ title: "请填写实际出售金额", icon: "none" });
      return;
    }

    try {
      this.setData({ submitting: true });
      wx.showLoading({ title: "提交中", mask: true });

      const consignmentUsers = await usersRepository.listConsignmentUsers();
      const ownerUserMap = new Map(
        consignmentUsers.map((item) => [String(item._id || "").trim(), item])
      );

      await productsRepository.bulkRecordProductSales(selling, async (product) => {
        const ownerUserId = String(product.ownerUserId || "").trim();
        const ownerUser = ownerUserId ? ownerUserMap.get(ownerUserId) || null : null;
        return getUserRateFraction(ownerUser);
      });

      await addOperationLog({
        title: "批量标记售出",
        target: `${selling.length} 件商品`,
        type: "商品",
        note: selling.map((item) => `${item.id}×${item.qty}`).slice(0, 5).join("、")
      });

      wx.hideLoading();
      wx.showToast({ title: "已标记售出", icon: "success" });
      setTimeout(() => {
        wx.reLaunch({ url: "/admin/pages/goods/list/list" });
      }, 500);
    } catch (error) {
      wx.hideLoading();
      await addOperationLog({
        title: "批量标记售出",
        target: `${selling.length} 件商品`,
        type: "商品",
        note: formatFailureContext(error, selling.map((item) => `${item.id}×${item.qty}`).slice(0, 5).join("、")),
        success: false
      });
      wx.showToast({ title: "提交失败，请重试", icon: "none" });
    } finally {
      this.setData({ submitting: false });
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({ url: "/admin/pages/goods/list/list" });
      }
    });
  }
});
