const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const { debounce } = require("../../../../utils/debounce");

const BANNER_LIMIT = 3;

function formatDateValue(value) {
  if (!value) return 0;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getInitials(text) {
  const value = String(text || "").trim();
  if (!value) return "IP";

  if (/^[A-Za-z0-9]/.test(value)) {
    return value.replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "IP";
  }

  return value.slice(0, 1).toUpperCase();
}

function getTone(index) {
  const tones = ["pink", "purple", "blue", "green", "orange"];
  return tones[index % tones.length];
}

function getBannerTag(latestTime) {
  const now = new Date();
  const latest = latestTime ? new Date(latestTime) : null;
  if (!latest || Number.isNaN(latest.getTime())) {
    return "最新上新";
  }

  const isToday = now.getFullYear() === latest.getFullYear()
    && now.getMonth() === latest.getMonth()
    && now.getDate() === latest.getDate();

  return isToday ? "今日上新" : "最新上新";
}

function buildIpSummaries(products) {
  const map = new Map();

  products.forEach((item) => {
    const ip = String(item.ip || "").trim();
    if (!ip) return;

    const role = String(item.role || "").trim();
    const latestTime = Math.max(formatDateValue(item.updatedAt), formatDateValue(item.createdAt));
    const current = map.get(ip) || {
      ip,
      saleCount: 0,
      roles: new Set(),
      latestTime: 0
    };

    current.saleCount += Math.max(0, Number(item.remainingCount || 0));
    if (role) {
      current.roles.add(role);
    }
    current.latestTime = Math.max(current.latestTime, latestTime);
    map.set(ip, current);
  });

  return [...map.values()]
    .map((item, index) => ({
      ip: item.ip,
      saleCount: item.saleCount,
      roleCount: item.roles.size,
      latestTime: item.latestTime,
      initials: getInitials(item.ip),
      tone: getTone(index),
      bannerTag: getBannerTag(item.latestTime)
    }))
    .sort((left, right) => {
      if (right.latestTime !== left.latestTime) return right.latestTime - left.latestTime;
      if (right.saleCount !== left.saleCount) return right.saleCount - left.saleCount;
      return left.ip.localeCompare(right.ip, "zh-Hans-CN");
    });
}

Page({
  data: {
    loading: true,
    hasLoaded: false,
    ipSummaries: [],
    bannerItems: [],
    bannerCurrent: 0
  },

  onLoad() {
    this.openIp = debounce(this.openIp.bind(this), 500);
  },

  onShow() {
    this.loadProducts();
  },

  onPullDownRefresh() {
    this.loadProducts().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadProducts() {
    if (!this.data.hasLoaded) {
      this.setData({ loading: true });
    }

    try {
      const rawProducts = await productsRepository.getAllProducts();
      const products = rawProducts
        .map(buildProductCard)
        .filter((item) => item.displayStatus === "up");

      const ipSummaries = buildIpSummaries(products);
      this.setData({
        ipSummaries,
        bannerItems: ipSummaries.slice(0, BANNER_LIMIT),
        loading: false,
        hasLoaded: true
      });
    } catch (error) {
      console.error("IP分类页加载失败:", error);
      this.setData({ loading: false, hasLoaded: true });
      wx.showToast({ title: "加载失败，请重试", icon: "none" });
    }
  },

  goSearch() {
    wx.navigateTo({
      url: `/user/pages/goods/search/search`
    });
  },

  onBannerChange(event) {
    this.setData({
      bannerCurrent: Number(event.detail.current || 0)
    });
  },

  openIp(event) {
    const ip = event.currentTarget.dataset.ip;
    if (!ip) return;

    wx.navigateTo({
      url: `/user/pages/goods/ip-list/ip-list?mode=ip&ip=${encodeURIComponent(ip)}`
    });
  }
});
