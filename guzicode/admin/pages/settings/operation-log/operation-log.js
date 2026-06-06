const {
  LOG_RETENTION_OPTIONS,
  addOperationLog,
  clearAllOperationLogs,
  cleanupOperationLogs,
  getLogRetentionConfig,
  getMonthKey,
  listOperationLogs,
  saveLogRetentionConfig
} = require("../../../../utils/adminSettings");

function buildPeriodLabel(dateLike) {
  const monthKey = getMonthKey(dateLike);
  const nowMonth = getMonthKey(new Date());
  if (monthKey === nowMonth) {
    return "本月";
  }

  const current = new Date(`${nowMonth}-01 00:00:00`);
  const target = new Date(`${monthKey}-01 00:00:00`);
  const diffMonths = (current.getFullYear() - target.getFullYear()) * 12 + (current.getMonth() - target.getMonth());
  if (diffMonths >= 1 && diffMonths <= 2) {
    return "近三月";
  }
  return "全部";
}

Page({
  data: {
    keyword: "",
    periodOptions: ["本月", "近三月", "全部"],
    typeOptions: ["全部类型"],
    operatorOptions: ["全部人员"],
    resultOptions: ["全部结果", "仅成功", "仅失败"],
    selectedPeriod: "本月",
    selectedType: "全部类型",
    selectedOperator: "全部人员",
    selectedResult: "全部结果",
    loading: true,
    loaded: false,
    loadFailed: false,
    retentionLabel: "90 天",
    logs: [],
    filteredLogs: []
  },

  async onLoad() {
    await this.loadLogs();
  },

  async loadLogs() {
    this.setData({ loading: true });
    try {
      const logs = await listOperationLogs();
      const normalizedLogs = logs.map((item) => ({
        ...item,
        period: buildPeriodLabel(item.createdAt)
      }));
      const typeOptions = ["全部类型"].concat([...new Set(normalizedLogs.map((item) => item.type).filter(Boolean))]);
      const operatorOptions = ["全部人员"].concat([...new Set(normalizedLogs.map((item) => item.operator).filter(Boolean))]);

      this.setData({
        loading: false,
        loaded: true,
        loadFailed: false,
        retentionLabel: getLogRetentionConfig().label,
        logs: normalizedLogs,
        typeOptions,
        operatorOptions
      });
      this.applyFilters();
    } catch (error) {
      console.error("load operation logs error:", error);
      this.setData({
        loading: false,
        loadFailed: true,
        logs: [],
        filteredLogs: []
      });
    }
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

  onKeywordInput(event) {
    this.setData({
      keyword: event.detail.value
    });
    this.applyFilters();
  },

  choosePeriod() {
    wx.showActionSheet({
      itemList: this.data.periodOptions,
      success: (res) => {
        this.setData({
          selectedPeriod: this.data.periodOptions[res.tapIndex]
        });
        this.applyFilters();
      }
    });
  },

  chooseType() {
    wx.showActionSheet({
      itemList: this.data.typeOptions,
      success: (res) => {
        this.setData({
          selectedType: this.data.typeOptions[res.tapIndex]
        });
        this.applyFilters();
      }
    });
  },

  chooseOperator() {
    wx.showActionSheet({
      itemList: this.data.operatorOptions,
      success: (res) => {
        this.setData({
          selectedOperator: this.data.operatorOptions[res.tapIndex]
        });
        this.applyFilters();
      }
    });
  },

  chooseResult() {
    wx.showActionSheet({
      itemList: this.data.resultOptions,
      success: (res) => {
        this.setData({
          selectedResult: this.data.resultOptions[res.tapIndex]
        });
        this.applyFilters();
      }
    });
  },

  async retryLoad() {
    await this.loadLogs();
  },

  chooseRetention() {
    wx.showActionSheet({
      itemList: LOG_RETENTION_OPTIONS.map((item) => item.label),
      success: async (res) => {
        const selected = LOG_RETENTION_OPTIONS[res.tapIndex];
        if (!selected) {
          return;
        }
        saveLogRetentionConfig(selected.days);
        const result = await cleanupOperationLogs({ retentionDays: selected.days });
        await addOperationLog({
          title: "修改日志保留周期",
          target: "操作日志",
          type: "日志",
          note: `调整为 ${selected.label}${result.removedCount ? `，清理 ${result.removedCount} 条过期日志` : ""}`
        });
        wx.showToast({
          title: `已改为${selected.label}`,
          icon: "success"
        });
        await this.loadLogs();
      }
    });
  },

  async clearExpiredLogs() {
    const retention = getLogRetentionConfig();
    const result = await cleanupOperationLogs({ retentionDays: retention.days });
    await addOperationLog({
      title: "清理过期日志",
      target: "操作日志",
      type: "日志",
      note: result.removedCount ? `已清理 ${result.removedCount} 条过期日志` : `当前策略 ${retention.label}，无需清理`
    });
    wx.showToast({
      title: result.removedCount ? `已清理 ${result.removedCount} 条` : "暂无过期日志",
      icon: "none"
    });
    await this.loadLogs();
  },

  clearAllLogs() {
    wx.showModal({
      title: "全部清空日志",
      content: "将清空本地与云端的全部操作日志，且不可恢复。确认继续吗？",
      confirmText: "确认清空",
      confirmColor: "#d84b4b",
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }

        try {
          const result = await clearAllOperationLogs();
          wx.showToast({
            title: result.removedCount ? `已清空 ${result.removedCount} 条` : "已清空",
            icon: "success"
          });
          this.setData({
            keyword: "",
            logs: [],
            filteredLogs: [],
            typeOptions: ["全部类型"],
            operatorOptions: ["全部人员"]
          });
          await this.loadLogs();
        } catch (error) {
          wx.showToast({
            title: "清空失败，请重试",
            icon: "none"
          });
        }
      }
    });
  },

  applyFilters() {
    const keyword = String(this.data.keyword || "").trim().toLowerCase();
    const filteredLogs = this.data.logs.filter((item) => {
      const matchKeyword = !keyword
        || String(item.title || "").toLowerCase().includes(keyword)
        || String(item.target || "").toLowerCase().includes(keyword)
        || String(item.operator || "").toLowerCase().includes(keyword)
        || String(item.note || "").toLowerCase().includes(keyword);
      const matchPeriod = this.data.selectedPeriod === "全部" || item.period === this.data.selectedPeriod;
      const matchType = this.data.selectedType === "全部类型" || item.type === this.data.selectedType;
      const matchOperator = this.data.selectedOperator === "全部人员" || item.operator === this.data.selectedOperator;
      const matchResult = this.data.selectedResult === "全部结果"
        || (this.data.selectedResult === "仅成功" && item.success)
        || (this.data.selectedResult === "仅失败" && !item.success);
      return matchKeyword && matchPeriod && matchType && matchOperator && matchResult;
    });

    this.setData({
      filteredLogs
    });
  }
});
