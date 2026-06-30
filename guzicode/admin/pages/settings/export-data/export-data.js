const { addOperationLog, createExportFile, formatFailureContext, openDocument } = require("../../../../utils/adminSettings");

Page({
  data: {
    items: [
      { key: "users", title: "用户数据", subtitle: "寄售用户资料与权限", checked: false },
      { key: "goods", title: "商品数据", subtitle: "商品信息与状态明细", checked: false },
      { key: "stats", title: "统计数据", subtitle: "明细 / 汇总 / 支出", checked: true },
      { key: "logs", title: "操作日志", subtitle: "管理操作记录", checked: false }
    ],
    rangeOptions: ["本月", "近三月", "自定义", "全部"],
    selectedRange: "本月",
    exportFormat: "Excel (.xls)",
    selectedCount: 1,
    customRange: {
      start: "",
      end: ""
    },
    exporting: false
  },

  handleBack() {
    wx.navigateBack({
      delta: 1,
      fail: () => {
        wx.reLaunch({
          url: "/admin/pages/settings/settings"
        });
      }
    });
  },

  toggleItem(event) {
    const { key } = event.currentTarget.dataset;
    const items = this.data.items.map((item) => {
      if (item.key !== key) {
        return item;
      }
      return {
        ...item,
        checked: !item.checked
      };
    });
    this.setData({
      items,
      selectedCount: items.filter((item) => item.checked).length
    });
  },

  selectRange(event) {
    const selectedRange = event.currentTarget.dataset.value;
    if (selectedRange === "自定义" && (!this.data.customRange.start || !this.data.customRange.end)) {
      const now = new Date();
      const month = String(now.getMonth() + 1).padStart(2, "0");
      const date = String(now.getDate()).padStart(2, "0");
      this.setData({
        selectedRange,
        customRange: {
          start: `${now.getFullYear()}-${month}-01`,
          end: `${now.getFullYear()}-${month}-${date}`
        }
      });
      return;
    }
    this.setData({ selectedRange });
  },

  onStartDateChange(event) {
    this.setData({
      "customRange.start": event.detail.value
    });
  },

  onEndDateChange(event) {
    this.setData({
      "customRange.end": event.detail.value
    });
  },

  async handleExport() {
    const selectedItems = this.data.items.filter((item) => item.checked);
    if (!selectedItems.length) {
      wx.showToast({
        title: "请至少选择一项导出范围",
        icon: "none"
      });
      return;
    }

    if (this.data.selectedRange === "自定义" && (!this.data.customRange.start || !this.data.customRange.end)) {
      wx.showToast({
        title: "请选择完整的自定义时间",
        icon: "none"
      });
      return;
    }

    if (
      this.data.selectedRange === "自定义"
      && this.data.customRange.start
      && this.data.customRange.end
      && this.data.customRange.start > this.data.customRange.end
    ) {
      wx.showToast({
        title: "开始时间不能晚于结束时间",
        icon: "none"
      });
      return;
    }

    if (this.data.exporting) {
      return;
    }

    let confirmRes;
    try {
      confirmRes = await wx.showModal({
        title: "导出数据",
        content: "导出数据可能包含敏感信息，请确认是否导出？",
        confirmText: "确认导出",
        cancelText: "取消"
      });
    } catch (error) {
      return;
    }

    if (!confirmRes.confirm) {
      return;
    }

    this.setData({ exporting: true });
    wx.showLoading({
      title: "导出中"
    });

    try {
      const result = await createExportFile({
        selectedKeys: selectedItems.map((item) => item.key),
        rangeType: this.data.selectedRange,
        customRange: this.data.selectedRange === "自定义" ? this.data.customRange : null
      });
      wx.hideLoading();
      wx.showToast({
        title: "文件生成成功",
        icon: "success"
      });
      setTimeout(() => {
        openDocument(result.filePath, "xls").catch(() => {});
      }, 300);
    } catch (error) {
      console.error("export data error:", error);
      wx.hideLoading();
      await addOperationLog({
        title: "导出数据",
        target: "导出文件",
        type: "导出",
        note: formatFailureContext(error, selectedItems.map((item) => item.title).join("、")),
        success: false
      });
      wx.showToast({
        title: "导出失败，请重试",
        icon: "none"
      });
    } finally {
      this.setData({ exporting: false });
    }
  }
});
