const session = require("../../../../utils/session");
const { formatRatePercent } = require("../../../../utils/consignmentRate");
const { debounce } = require("../../../../utils/debounce");
const dataAccessService = require("../../../../utils/dataAccessService");

function formatDate(dateLike) {
  const date = new Date(dateLike || Date.now());
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

Page({
  data: {
    record: null,
    items: [],
    submitting: false,
    vouchers: [],
    amountText: "¥0.00",
    feeText: "¥0.00",
    netText: "¥0.00",
    orderNo: "",
    dateText: "",
    rate: 0
  },

  onLoad(options = {}) {
    this.goBack = debounce(this.goBack.bind(this), 800);
    this.previewVoucher = debounce(this.previewVoucher.bind(this), 500);
    
    this.id = options.id || "";
    this.loadDetail();
  },

  async onShow() {
    // 当页面重新显示时，如果有id就重新加载
    if (this.id) {
      this.loadDetail();
    }
  },

  async loadDetail() {
    try {
      const current = session.getSession();
      if (!current || !this.id) {
        throw new Error("结算记录不存在");
      }
      const record = await dataAccessService.getDocById("settlement_records", this.id);
      if (!record || record.userId !== current.userId) {
        throw new Error("结算记录不存在");
      }
      const items = Array.isArray(record.settlementItems)
        ? record.settlementItems.map((item, index) => {
            const qty = Number(item.soldQty || item.count || 0);
            const price = Number(item.price || 0);
            const rateFraction = Number(item.rateFraction);
            const normalizedRateFraction = Number.isFinite(rateFraction)
              ? rateFraction
              : Number(item.rate || 0) / 100;
            const gross = price * qty;
            const fee = gross * normalizedRateFraction;
            return {
              ...item,
              rowId: `${item.id || index}-${index}`,
              soldQty: qty,
              grossText: `¥${gross.toFixed(2)}`,
              feeText: `-¥${fee.toFixed(2)}`,
              payableText: `¥${(gross - fee).toFixed(2)}`,
              rateText: formatRatePercent(normalizedRateFraction)
            };
          })
        : [];
      
      // 获取结算凭证
      const vouchers = Array.isArray(record.vouchers) ? record.vouchers : [];
      let displayVouchers = vouchers;
      
      // 处理云存储fileID，转换为临时URL
      if (vouchers.length > 0) {
        try {
          const cloudIds = vouchers.filter((p) => p && p.startsWith("cloud://"));
          const tempUrls = {};

          if (cloudIds.length > 0) {
            const res = await wx.cloud.getTempFileURL({ fileList: cloudIds });
            (res.fileList || []).forEach((item) => {
              if (item.status === 0 && item.tempFileURL) {
                tempUrls[item.fileID] = item.tempFileURL;
              }
            });
          }

          displayVouchers = vouchers.map((p) => {
            if (!p) return "";
            if (p.startsWith("cloud://")) {
              return tempUrls[p] || p;
            }
            return p;
          }).filter(Boolean);
        } catch (e) {
          console.error("转换结算凭证URL失败:", e);
          displayVouchers = vouchers;
        }
      }
      
      this.setData({
        record,
        items,
        vouchers: displayVouchers,
        rate: 0,
        amountText: `¥${Number(record.gross || 0).toFixed(2)}`,
        feeText: `-¥${Number(record.commission || 0).toFixed(2)}`,
        netText: `¥${Number(record.payable || 0).toFixed(2)}`,
        orderNo: `JS${String(record._id || "").replace(/\W/g, "").slice(-8).padStart(8, "0")}`,
        dateText: formatDate(record.date || record.updatedAt || record.createdAt)
      });
    } catch (error) {
      console.error("加载结算详情失败:", error);
      wx.showToast({ title: "结算详情加载失败", icon: "none" });
    }
  },

  previewVoucher(e) {
    const index = e.currentTarget.dataset.index;
    const urls = this.data.vouchers;
    if (!urls || urls.length === 0) return;
    
    wx.previewImage({
      current: urls[index],
      urls: urls
    });
  },

  goBack() {
    wx.navigateBack();
  }
});
