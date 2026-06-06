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
    remark: ""
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
      const items = (await productsRepository.getAllProducts())
        .filter((item) => this.data.ids.includes(item.id))
        .map(buildProductCard)
        .map((item) => ({
          id: item.id,
          title: item.title,
          remainingCount: item.remainingCount,
          soldQuantity: "",
          salePrice: String(item.price || "")
        }));

      this.setData({ items });
    } catch (error) {
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
      for (const item of selling) {
        const product = await productsRepository.getProductById(item.id);
        if (!product) {
          continue;
        }

        const remaining = Math.max(
          0,
          Number(product.totalQuantity || 0) - Number(product.soldCount || 0) - Number(product.settledCount || 0)
        );
        const qty = clampInt(item.qty, 0, remaining);
        const ownerUserId = String(product.ownerUserId || "").trim();
        const ownerUser = ownerUserId ? await usersRepository.getUserById(ownerUserId) : null;
        const rateFraction = getUserRateFraction(ownerUser);

        await productsRepository.recordProductSale(item.id, qty, rateFraction, {
          price: Number.isFinite(item.price) && item.price > 0 ? item.price : product.price
        });
      }
      await addOperationLog({
        title: "批量标记售出",
        target: `${selling.length} 件商品`,
        type: "商品",
        note: selling.map((item) => `${item.id}×${item.qty}`).slice(0, 5).join("、")
      });

      wx.showToast({ title: "已标记售出", icon: "success" });
      setTimeout(() => {
        wx.reLaunch({ url: "/admin/pages/goods/list/list" });
      }, 500);
    } catch (error) {
      await addOperationLog({
        title: "批量标记售出",
        target: `${selling.length} 件商品`,
        type: "商品",
        note: formatFailureContext(error, selling.map((item) => `${item.id}×${item.qty}`).slice(0, 5).join("、")),
        success: false
      });
      wx.showToast({ title: "提交失败，请重试", icon: "none" });
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
