const session = require("../../../../utils/session");
const usersRepository = require("../../../../utils/usersRepository");
const productsRepository = require("../../../../utils/productsRepository");
const { formatRatePercent, getUserRateFraction } = require("../../../../utils/consignmentRate");
const { buildPendingSettlementItems } = require("../../../../utils/settlementPresentation");
const { debounce } = require("../../../../utils/debounce");
const dataAccessService = require("../../../../utils/dataAccessService");

async function fetchSettlementRecordsByUser(userId) {
  return dataAccessService.fetchAll("settlement_records", {
    where: { userId },
    orderByField: "updatedAt",
    orderByDirection: "desc"
  });
}

function belongsToUser(product, user) {
  return product.ownerUserId === user._id || product.owner === user.nickname || product.owner === user.account;
}

Page({
  data: {
    user: null,
    enabled: false,
    submitting: false,
    rateText: "0%",
    counts: {
      all: 0,
      sold: 0,
      settled: 0
    }
  },

  onLoad() {
    this.goBack = debounce(this.goBack.bind(this), 800);
    this.goList = debounce(this.goList.bind(this), 800);
    this.goSold = debounce(this.goSold.bind(this), 800);
    this.goSettled = debounce(this.goSettled.bind(this), 800);
  },

  async onShow() {
    const current = session.getSession();
    if (!current) {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }
    try {
      const user = await usersRepository.getUserById(current.userId);
      const nickname = String((user && user.nickname) || current.account || "");
      if (!user || !user.isAgentEnabled) {
        wx.redirectTo({ url: "/user/pages/consignment/intro/intro" });
        return;
      }
      const normalized = { ...user, _id: current.userId, account: current.account, nickname };
      const products = (await productsRepository.getAllProducts()).filter((item) => belongsToUser(item, normalized));
      const settlementRecords = await fetchSettlementRecordsByUser(current.userId);
      const rateFraction = getUserRateFraction(user);
      const soldItems = products
        .filter((item) => Number(item.soldCount || 0) > Number(item.settledCount || 0))
        .flatMap((item) => buildPendingSettlementItems(item, rateFraction));
      const soldCount = soldItems.reduce((sum, item) => sum + Number(item.soldQty || 0), 0);
      const settledCount = settlementRecords.reduce((sum, item) => sum + Number(item.items || 0), 0);
      this.setData({
        user: normalized,
        enabled: true,
        rateText: formatRatePercent(rateFraction),
        counts: {
          all: products.length,
          sold: soldCount,
          settled: settledCount
        }
      });
    } catch (error) {
      wx.showToast({ title: "寄售信息加载失败", icon: "none" });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  goList() {
    wx.navigateTo({ url: "/user/pages/consignment/list/list" });
  },

  goSold() {
    wx.navigateTo({ url: "/user/pages/consignment/sold/sold" });
  },

  goSettled() {
    wx.navigateTo({ url: "/user/pages/consignment/settled/settled" });
  }
});
