const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { debounce } = require("../../../../utils/debounce");
const { buildShareAppMessage, buildShareTimeline, enableShareMenus } = require("../../../../utils/share");
const { getVisibleShopChannels, getContactServiceSetting } = require("../../../../utils/shopChannelsRepository");

Page({
  data: {
    id: "",
    product: null,
    shopChannels: [],
    contactServiceEnabled: true,
    editable: false,
    submitting: false,
    invalid: false,
    invalidText: "商品已下架或不存在",
    invalidDesc: "该商品当前不可见，去看看其它好物吧"
  },

  onLoad(options) {
    this.goBack = debounce(this.goBack.bind(this), 800);
    this.goEdit = debounce(this.goEdit.bind(this), 800);
    this.deleteProduct = debounce(this.deleteProduct.bind(this), 800);
    this.backToList = debounce(this.backToList.bind(this), 800);
    
    this.setData({ id: options.id || "", editable: options.editable === "1" });
    enableShareMenus();
  },

  async onShow() {
    await this.loadProduct();
  },

  async loadProduct() {
    try {
      const [product, shopChannels, contactServiceSetting] = await Promise.all([
        productsRepository.getProductById(this.data.id),
        getVisibleShopChannels(),
        getContactServiceSetting()
      ]);
      if (!product) {
        this.setData({
          product: null,
          invalid: true,
          invalidText: "商品已下架或不存在"
        });
        return;
      }
      const productView = buildProductCard(product);
      if (!this.data.editable && productView.displayStatus === "down") {
        this.setData({
          product: null,
          invalid: true,
          invalidText: "商品已下架或不存在"
        });
        return;
      }
      this.setData({
        product: productView,
        shopChannels,
        contactServiceEnabled: contactServiceSetting.enabled !== false,
        invalid: false
      });
    } catch (error) {
      wx.showToast({ title: "商品加载失败", icon: "none" });
    }
  },

  previewImage() {
    if (!this.data.product || !this.data.product.images || !this.data.product.images.length) return;
    wx.previewImage({
      urls: this.data.product.images,
      current: this.data.product.images[0],
      showmenu: false
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => wx.reLaunch({ url: "/user/pages/goods/list/list" })
    });
  },

  backToList() {
    wx.reLaunch({ url: "/user/pages/goods/list/list" });
  },

  goEdit() {
    wx.navigateTo({ url: `/user/pages/consignment/upload/upload?id=${this.data.id}` });
  },

  deleteProduct() {
    wx.showModal({
      title: "确认删除",
      content: "删除后不可恢复，确认删除该商品吗？",
      success: async ({ confirm }) => {
        if (!confirm) return;
        try {
          await productsRepository.deleteProducts([this.data.id]);
          wx.showToast({ title: "删除成功", icon: "success" });
          setTimeout(() => wx.navigateBack(), 500);
        } catch (error) {
          wx.showToast({ title: "删除失败", icon: "none" });
        }
      }
    });
  },

  copyShopKeyword(event) {
    const { text } = event.currentTarget.dataset;
    if (!text) {
      wx.showToast({
        title: "复制失败，请手动搜索店铺名",
        icon: "none"
      });
      return;
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: "店铺名已复制",
          icon: "none"
        });
      },
      fail: () => {
        wx.showToast({
          title: "复制失败，请手动搜索店铺名",
          icon: "none"
        });
      }
    });
  },

  onShareAppMessage() {
    const product = this.data.product;
    const title = product
      ? `谷圈星社 | ${product.title || "商品详情"}`
      : "谷圈星社 | 商品详情";

    return buildShareAppMessage({
      title,
      path: "/user/pages/goods/detail/detail",
      query: { id: this.data.id || "" },
      imageUrl: product && product.coverImage ? product.coverImage : undefined
    });
  },

  onShareTimeline() {
    const product = this.data.product;
    const title = product
      ? `谷圈星社 | ${product.title || "商品详情"}`
      : "谷圈星社 | 商品详情";

    return buildShareTimeline({
      title,
      query: { id: this.data.id || "" },
      imageUrl: product && product.coverImage ? product.coverImage : undefined
    });
  }
});
