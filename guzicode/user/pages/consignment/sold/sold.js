const session = require("../../../../utils/session");
const usersRepository = require("../../../../utils/usersRepository");
const productsRepository = require("../../../../utils/productsRepository");
const { debounce } = require("../../../../utils/debounce");
const { getUserRateFraction } = require("../../../../utils/consignmentRate");
const { buildPendingSettlementItems } = require("../../../../utils/settlementPresentation");

function belongsToUser(product, user) {
  return product.ownerUserId === user._id || product.owner === user.nickname || product.owner === user.account;
}

Page({
  data: {
    soldItems: [],
    loading: true,
    submitting: false,
    hasLoaded: false
  },

  onLoad() {
    this.goBack = debounce(this.goBack.bind(this), 800);
  },

  async onShow() {
    this.setData({ loading: true });
    try {
      const current = session.getSession();
      if (!current) {
        wx.reLaunch({ url: "/auth/pages/login/login" });
        return;
      }
      const user = await usersRepository.getUserById(current.userId);
      const normalized = { ...user, _id: current.userId, account: current.account, nickname: String((user && user.nickname) || current.account || "") };
      const matchedProducts = (await productsRepository.getAllProducts())
        .filter((item) => belongsToUser(item, normalized) && Number(item.soldCount || 0) > Number(item.settledCount || 0))
        .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt));
      const soldItems = matchedProducts.flatMap((item) => buildPendingSettlementItems(item, getUserRateFraction(normalized)));
      this.setData({
        soldItems,
        loading: false,
        hasLoaded: true
      });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: "已出售商品加载失败", icon: "none" });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
