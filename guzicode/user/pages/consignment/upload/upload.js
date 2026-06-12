const session = require("../../../../utils/session");
const productsRepository = require("../../../../utils/productsRepository");
const { ensureCloudImages } = require("../../../../utils/cloudFile");
const { debounce } = require("../../../../utils/debounce");

const TYPE_OPTIONS = ["小卡", "吧唧", "镭射票", "自定义"];

Page({
  data: {
    id: "",
    mode: "create",
    submitting: false,
    form: {
      id: "",
      role: "",
      series: "",
      ip: "",
      type: "小卡",
      customType: "",
      totalQuantity: "1",
      price: "",
      quality: "clean",
      purchaseRecord: "无",
      status: "down",
      remark: "",
      images: []
    },
    errors: {},
    activeDropdown: "",
    typeOptions: TYPE_OPTIONS,
    submitting: false
  },

  onLoad(options = {}) {
    this.handleSubmit = debounce(this.handleSubmit.bind(this), 800);
    this.goBack = debounce(this.goBack.bind(this), 800);
    this.choosePhoto = debounce(this.choosePhoto.bind(this), 800);
    
    const id = options.id || "";
    this.setData({ id, mode: id ? "edit" : "create" });
  },

  async onShow() {
    if (this.data.id && !this.data.form.role) {
      await this.loadProduct(this.data.id);
    }
    if (!this.initialSnapshot) {
      this.markInitialSnapshot();
    }
  },

  async loadProduct(id) {
    try {
      const product = await productsRepository.getProductById(id);
      if (!product) {
        wx.showToast({ title: "商品不存在", icon: "none" });
        this.goBack();
        return;
      }
      this.setData({
        form: {
          id: product.id,
          role: product.role || "",
          series: product.series || "",
          ip: product.ip || "",
          type: product.type || "小卡",
          customType: product.customType || "",
          totalQuantity: String(product.totalQuantity || "1"),
          price: String(product.price || ""),
          quality: product.quality || "clean",
          purchaseRecord: product.purchaseRecord || "无",
          status: product.status || "down",
          remark: product.remark || "",
          images: product.images || []
        }
      });
    } catch (error) {
      wx.showToast({ title: "商品加载失败", icon: "none" });
    }
  },

  buildDirtySnapshot() {
    const { form } = this.data;
    return JSON.stringify({
      role: form.role,
      series: form.series,
      ip: form.ip,
      type: form.type,
      customType: form.customType,
      totalQuantity: form.totalQuantity,
      price: form.price,
      quality: form.quality,
      purchaseRecord: form.purchaseRecord,
      status: form.status,
      remark: form.remark,
      images: form.images || []
    });
  },

  markInitialSnapshot() {
    this.initialSnapshot = this.buildDirtySnapshot();
  },

  hasUnsavedChanges() {
    return !!this.initialSnapshot && this.buildDirtySnapshot() !== this.initialSnapshot;
  },

  doNavigateBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: "/user/pages/consignment/list/list"
        });
      }
    });
  },

  onFieldInput(event) {
    const { field } = event.currentTarget.dataset;
    this.setData({
      [`form.${field}`]: event.detail.value,
      [`errors.${field}`]: ""
    });
  },

  toggleDropdown(event) {
    const key = event.currentTarget.dataset.key;
    this.setData({
      activeDropdown: this.data.activeDropdown === key ? "" : key
    });
  },

  closeDropdown() {
    this.setData({ activeDropdown: "" });
  },

  onTypeSelect(event) {
    const type = event.currentTarget.dataset.value;
    this.setData({
      "form.type": type,
      "errors.customType": "",
      activeDropdown: ""
    });
  },

  chooseQuality(event) {
    this.setData({
      "form.quality": event.currentTarget.dataset.value
    });
  },

  choosePurchaseRecord(event) {
    this.setData({
      "form.purchaseRecord": event.currentTarget.dataset.value
    });
  },

  // ===== 照片相关 =====
  choosePhoto() {
    const remaining = 9 - this.data.form.images.length;
    if (remaining <= 0) {
      wx.showToast({ title: "最多上传 9 张照片", icon: "none" });
      return;
    }
    wx.chooseMedia({
      count: remaining,
      mediaType: ["image"],
      sizeType: ["compressed"],
      sourceType: ["album", "camera"],
      success: (res) => {
        const valid = [];
        let rejected = 0;
        (res.tempFiles || []).forEach((file) => {
          if (file.size && file.size > 5 * 1024 * 1024) {
            rejected += 1;
            return;
          }
          valid.push(file.tempFilePath);
        });

        if (rejected) {
          wx.showToast({
            title: `已过滤 ${rejected} 张超过 5M 的图片`,
            icon: "none"
          });
        }

        const images = this.data.form.images.concat(valid).slice(0, 9);
        this.setData({
          "form.images": images,
          "errors.images": ""
        });
      }
    });
  },

  previewImage(event) {
    const { index } = event.currentTarget.dataset;
    wx.previewImage({
      current: this.data.form.images[index],
      urls: this.data.form.images
    });
  },

  deletePhoto(event) {
    const { index } = event.currentTarget.dataset;
    const images = this.data.form.images.filter((_, i) => i !== index);
    this.setData({ "form.images": images });
  },

  onPhotoLongPress(event) {
    const { index } = event.currentTarget.dataset;
    const itemList = ["删除"];
    if (index > 0) {
      itemList.push("设为封面");
    }
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const action = itemList[res.tapIndex];
        if (action === "删除") {
          const images = this.data.form.images.filter((_, i) => i !== index);
          this.setData({ "form.images": images });
        } else if (action === "设为封面") {
          const images = this.data.form.images.slice();
          const [moved] = images.splice(index, 1);
          images.unshift(moved);
          this.setData({ "form.images": images });
        }
      }
    });
  },

  // ===== 提交 =====
  async handleSubmit(options = {}) {
    if (this.data.submitting) {
      return;
    }

    const form = this.data.form;
    const current = session.getSession();
    if (!current) {
      wx.reLaunch({ url: "/auth/pages/login/login" });
      return;
    }

    // 手动校验
    const errors = {};

    // 照片
    if (!form.images || form.images.length === 0) {
      errors.images = "请上传商品照片";
    }

    // IP
    if (!form.ip) {
      errors.ip = "请填写 IP";
    } else if (form.ip.length > 12) {
      errors.ip = "IP 字数不能超过 12 个";
    }

    // 系列
    if (!form.series) {
      errors.series = "请填写系列";
    } else if (form.series.length > 30) {
      errors.series = "系列字数不能超过 30 个";
    }

    // 角色
    if (!form.role) {
      errors.role = "请填写角色";
    } else if (form.role.length > 12) {
      errors.role = "角色字数不能超过 12 个";
    }

    // 自定义类型
    if (form.type === "自定义" && !form.customType) {
      errors.customType = "请填写自定义类型";
    } else if (form.type === "自定义" && form.customType.length > 12) {
      errors.customType = "自定义类型字数不能超过 12 个";
    }

    // 数量
    if (!form.totalQuantity) {
      errors.totalQuantity = "请填写数量";
    } else if (Number(form.totalQuantity) <= 0) {
      errors.totalQuantity = "数量必须大于 0";
    }

    // 价格
    if (!form.price) {
      errors.price = "请填写价格";
    } else if (Number(form.price) <= 0) {
      errors.price = "价格必须大于 0";
    }

    // 购买记录
    if (!form.purchaseRecord) {
      errors.purchaseRecord = "请选择是否有购买记录";
    }

    // 备注
    if (form.remark && form.remark.length > 200) {
      errors.remark = "备注字数不能超过 200 个";
    }

    this.setData({ errors });

    if (Object.keys(errors).length > 0) {
      const firstError = Object.values(errors)[0];
      wx.showToast({ title: firstError, icon: "none" });
      return;
    }

    // 创建/更新商品
    this.setData({ submitting: true });
    wx.showLoading({
      title: "保存中",
      mask: true
    });
    try {
      const cloudImages = await ensureCloudImages(form.images, "products");
      
      const payload = {
        ownerUserId: current.userId,
        owner: current.nickname || current.account || "",
        role: form.role,
        series: form.series,
        ip: form.ip,
        type: form.type,
        customType: form.customType,
        totalQuantity: Number(form.totalQuantity),
        price: Number(form.price),
        quality: form.quality,
        purchaseRecord: form.purchaseRecord,
        status: form.status,
        remark: form.remark,
        images: cloudImages,
        links: []
      };

      if (this.data.mode === "edit") {
        await productsRepository.updateProduct(this.data.id, payload);
      } else {
        const newId = await productsRepository.buildNewProductId();
        await productsRepository.createProduct({ ...payload, id: newId });
      }

      wx.hideLoading();
      wx.showToast({
        title: this.data.mode === "edit" ? "保存成功" : "保存成功",
        icon: "success"
      });
      setTimeout(() => {
        if (options.fromBack) {
          this.doNavigateBack();
          return;
        }
        this.doNavigateBack();
      }, 500);
    } catch (error) {
      wx.hideLoading();
      wx.showToast({
        title: "保存失败，请重试",
        icon: "none"
      });
      this.setData({ submitting: false });
    }
  },

  goBack() {
    if (!this.hasUnsavedChanges()) {
      this.doNavigateBack();
      return;
    }

    wx.showModal({
      title: "内容已变更",
      content: "当前页面内容已修改，是否保存后返回？",
      confirmText: "保存",
      cancelText: "不保存",
      success: ({ confirm, cancel }) => {
        if (confirm) {
          this.handleSubmit({ fromBack: true });
          return;
        }
        if (cancel) {
          this.doNavigateBack();
        }
      }
    });
  }
});
