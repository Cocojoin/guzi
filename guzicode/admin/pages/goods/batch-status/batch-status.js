const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { addOperationLog, formatFailureContext } = require("../../../../utils/adminSettings");

Page({
  data: {
    ids: [],
    items: [],
    targetStatus: "up",
    remark: "",
    buttonText: "确认修改"
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
        .map(buildProductCard);
      this.setData({ items });
    } catch (error) {
      wx.showToast({
        title: "商品加载失败",
        icon: "none"
      });
    }
  },

  chooseTarget(event) {
    const targetStatus = event.currentTarget.dataset.value;
    let buttonText = "确认修改";
    if (targetStatus === "sold") {
      buttonText = "下一步：填写出售数量";
    }
    this.setData({
      targetStatus,
      buttonText
    });
  },

  onRemarkInput(event) {
    this.setData({
      remark: event.detail.value
    });
  },

  async handleNext() {
    if (!this.data.items.length) {
      wx.showToast({
        title: "请先选择商品",
        icon: "none"
      });
      return;
    }

    if (this.data.targetStatus === "sold") {
      wx.navigateTo({
        url: `/admin/pages/goods/batch-sold/batch-sold?ids=${this.data.ids.join(",")}`
      });
      return;
    }

    try {
      await productsRepository.bulkUpdateStatus(this.data.ids, this.data.targetStatus);
      await addOperationLog({
        title: this.data.targetStatus === "up" ? "批量上架商品" : "批量下架商品",
        target: `${this.data.ids.length} 件商品`,
        type: "商品",
        note: this.data.ids.slice(0, 5).join("、")
      });
      wx.showToast({
        title: "状态修改成功",
        icon: "success"
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 400);
    } catch (error) {
      await addOperationLog({
        title: this.data.targetStatus === "up" ? "批量上架商品" : "批量下架商品",
        target: `${this.data.ids.length} 件商品`,
        type: "商品",
        note: formatFailureContext(error, this.data.ids.slice(0, 5).join("、")),
        success: false
      });
      wx.showToast({
        title: "状态修改失败",
        icon: "none"
      });
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: "/admin/pages/goods/list/list"
        });
      }
    });
  }
});
