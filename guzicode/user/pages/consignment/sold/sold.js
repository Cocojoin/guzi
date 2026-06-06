const session = require("../../../../utils/session");
const usersRepository = require("../../../../utils/usersRepository");
const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");

function belongsToUser(product, user) {
  return product.ownerUserId === user._id || product.owner === user.nickname || product.owner === user.account;
}

function formatDate(dateLike) {
  const date = new Date(dateLike || Date.now());
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

Page({
  data: {
    products: [],
    loading: true,
    hasLoaded: false
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
      const products = (await productsRepository.getAllProducts())
        .map(buildProductCard)
        .filter((item) => belongsToUser(item, normalized) && item.displayStatus === "sold")
        .sort((left, right) => new Date(right.updatedAt || right.createdAt) - new Date(left.updatedAt || left.createdAt))
        .map((item) => ({
          ...item,
          soldTimeText: formatDate(item.updatedAt || item.createdAt),
          orderNo: `SO${String(item.id || "").replace(/\D/g, "").padStart(8, "0")}`
        }));
      this.setData({ products, loading: false, hasLoaded: true });
    } catch (error) {
      this.setData({ loading: false });
      wx.showToast({ title: "已出售商品加载失败", icon: "none" });
    }
  },

  goBack() {
    wx.navigateBack();
  }
});
