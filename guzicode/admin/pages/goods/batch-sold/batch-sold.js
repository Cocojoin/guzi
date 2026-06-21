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

Page({
  data: {
    ids: [],
    items: [],
    remark: "",
    loading: true,
    submitting: false
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
          salePrice: String(item.price || "")
        }));

      this.setData({ items, loading: false });
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
      return {
        ...item,
        soldQuantity: numeric
      };
    });
    this.setData({ items: next });
  },

  onPriceInput(event) {
    const id = event.currentTarget.dataset.id;
    const next = this.data.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return {
        ...item,
        salePrice: event.detail.value
      };
    });
    this.setData({ items: next });
  },

  onRemarkInput(event) {
    this.setData({ remark: event.detail.value });
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
        price: Number(item.salePrice || 0)
      }))
      .filter((item) => item.qty > 0);

    if (!selling.length) {
      wx.showToast({ title: "请至少填写 1 个商品的售出数量", icon: "none" });
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
