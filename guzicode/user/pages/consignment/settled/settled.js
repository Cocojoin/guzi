const session = require("../../../../utils/session");
const usersRepository = require("../../../../utils/usersRepository");
const { debounce } = require("../../../../utils/debounce");
const dataAccessService = require("../../../../utils/dataAccessService");

function formatDate(dateLike) {
  const date = new Date(dateLike || Date.now());
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

async function fetchSettlementRecordsByUser(userId) {
  return dataAccessService.fetchAll("settlement_records", {
    where: { userId },
    orderByField: "updatedAt",
    orderByDirection: "desc"
  });
}

Page({
  data: {
    records: [],
    totalText: "¥0.00",
    submitting: false,
    loading: true,
    hasLoaded: false
  },

  onLoad() {
    this.goBack = debounce(this.goBack.bind(this), 800);
    this.goDetail = debounce(this.goDetail.bind(this), 800);
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
      if (!user) {
        throw new Error("用户不存在");
      }
      const records = (await fetchSettlementRecordsByUser(current.userId))
        .map((item) => ({
          id: item._id,
          dateText: formatDate(item.date || item.updatedAt || item.createdAt),
          title: `${formatDate(item.date || item.updatedAt || item.createdAt)} 结算`,
          orderNo: `JS${String(item._id || "").replace(/\W/g, "").slice(-8).padStart(8, "0")}`,
          count: Number(item.items || 0),
          amount: Number(item.payable || 0),
          amountText: `¥${Number(item.payable || 0).toFixed(2)}`,
          rateText: item.rateText || "",
          summaryText: item.summaryText || ""
        }))
        .sort((left, right) => right.dateText.localeCompare(left.dateText));
      const total = records.reduce((sum, item) => sum + item.amount, 0);
      this.setData({ records, totalText: `¥${total.toFixed(2)}`, loading: false, hasLoaded: true });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: "已结算商品加载失败", icon: "none" });
    }
  },

  goBack() {
    wx.navigateBack();
  },

  goDetail(event) {
    wx.navigateTo({ url: `/user/pages/consignment/settlement-detail/settlement-detail?id=${event.currentTarget.dataset.id}` });
  }
});
