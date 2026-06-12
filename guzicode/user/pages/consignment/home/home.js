const session = require("../../../../utils/session");
const usersRepository = require("../../../../utils/usersRepository");
const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { formatRatePercent, getUserRateFraction } = require("../../../../utils/consignmentRate");
const { debounce } = require("../../../../utils/debounce");

function db() {
  return wx.cloud.database();
}

async function fetchSettlementRecordsByUser(userId) {
  const collection = db().collection("settlement_records");
  const pageSize = 100;
  let skip = 0;
  const all = [];

  while (true) {
    const res = await collection.where({ userId }).orderBy("updatedAt", "desc").skip(skip).limit(pageSize).get();
    const rows = res.data || [];
    all.push(...rows);
    if (rows.length < pageSize) {
      break;
    }
    skip += pageSize;
  }

  return all;
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
      const products = (await productsRepository.getAllProducts()).map(buildProductCard).filter((item) => belongsToUser(item, normalized));
      const settlementRecords = await fetchSettlementRecordsByUser(current.userId);
      const rateFraction = getUserRateFraction(user);
      this.setData({
        user: normalized,
        enabled: true,
        rateText: formatRatePercent(rateFraction),
        counts: {
          all: products.length,
          sold: products.filter((item) => item.displayStatus === "sold").length,
          settled: settlementRecords.length
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
