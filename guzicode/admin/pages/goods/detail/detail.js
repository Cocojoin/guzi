const productsRepository = require("../../../../utils/productsRepository");
const { buildProductCard } = require("../../../../utils/productPresentation");
const usersRepository = require("../../../../utils/usersRepository");
const { isCloudFileId } = require("../../../../utils/cloudFile");
const { addOperationLog, formatFailureContext } = require("../../../../utils/adminSettings");
const { formatRatePercent, getUserRateFraction } = require("../../../../utils/consignmentRate");

Page({
  data: {
    id: "",
    product: null,
    productView: null,
    typeLabel: "周边商品",
    purchaseRecordLabel: "无购买记录",
    ownerCommissionRateText: "-",
    logs: [],
    showImageViewer: false,
    imageViewerIndex: 0,
    isDownloadingImage: false,
    showStatusSheet: false,
    statusTarget: "sold",
    statusQuantity: 1,
    maxStatusQuantity: 1,
    statusNote: ""
  },

  onLoad(options) {
    this.setData({
      id: options.id || ""
    });
  },

  async onShow() {
    await this.loadProduct();
  },

  async loadProduct() {
    try {
      const product = await productsRepository.getProductById(this.data.id);
      if (!product) {
        wx.showToast({
          title: "商品不存在或已删除",
          icon: "none"
        });
        setTimeout(() => {
          wx.reLaunch({
            url: "/admin/pages/goods/list/list"
          });
        }, 600);
        return;
      }

      const productView = buildProductCard(product);
      const ownerCommissionRateText = await this.getOwnerCommissionRateText(product);
      this.setData({
        product,
        productView,
        typeLabel: product.type === "自定义" ? (product.customType || "自定义") : (product.type || "周边商品"),
        purchaseRecordLabel: product.purchaseRecord === "有" ? "有购买记录" : "无购买记录",
        ownerCommissionRateText,
        logs: product.logs || []
      });
    } catch (error) {
      wx.showToast({
        title: "商品加载失败",
        icon: "none"
      });
    }
  },

  async getOwnerCommissionRateText(product) {
    try {
      const consignmentUsers = await usersRepository.listConsignmentUsers();
      const ownerId = String(product.ownerUserId || "").trim();
      const ownerName = String(product.owner || "").trim();

      let ownerUser = null;
      if (ownerId) {
        ownerUser = consignmentUsers.find((item) => String(item._id || "").trim() === ownerId) || null;
      }
      if (!ownerUser && ownerName) {
        ownerUser = consignmentUsers.find((item) => String(item.nickname || "").trim() === ownerName) || null;
      }
      if (!ownerUser) {
        return "-";
      }

      const rateFraction = getUserRateFraction(ownerUser);
      if (!Number.isFinite(rateFraction)) {
        return "-";
      }
      return formatRatePercent(rateFraction);
    } catch (error) {
      return "-";
    }
  },

  previewImage(event) {
    const { index } = event.currentTarget.dataset;
    this.setData({
      showImageViewer: true,
      imageViewerIndex: Number(index) || 0
    });
  },

  closeImageViewer() {
    this.setData({
      showImageViewer: false
    });
  },

  noop() {},

  onViewerChange(event) {
    const current = Number(event.detail.current || 0);
    this.setData({
      imageViewerIndex: current
    });
  },

  async downloadCurrentImage() {
    const images = this.data.product && Array.isArray(this.data.product.images) ? this.data.product.images : [];
    const currentImage = images[this.data.imageViewerIndex];
    if (!currentImage || this.data.isDownloadingImage) {
      return;
    }

    this.setData({ isDownloadingImage: true });
    wx.showLoading({
      title: "下载中",
      mask: true
    });

    try {
      await this.ensureAlbumPermission();
      const filePath = await this.downloadImageToLocal(currentImage);
      await this.saveImageToAlbum(filePath);
      wx.hideLoading();
      wx.showToast({
        title: "图片已保存",
        icon: "success"
      });
    } catch (error) {
      wx.hideLoading();
      if (error && error.message) {
        wx.showToast({
          title: error.message,
          icon: "none"
        });
      } else {
        wx.showToast({
          title: "下载失败，请重试",
          icon: "none"
        });
      }
    } finally {
      this.setData({ isDownloadingImage: false });
    }
  },

  ensureAlbumPermission() {
    return new Promise((resolve, reject) => {
      wx.getSetting({
        success: (settingRes) => {
          const scopeKey = "scope.writePhotosAlbum";
          const authState = settingRes.authSetting ? settingRes.authSetting[scopeKey] : undefined;

          if (authState === true || authState === undefined) {
            resolve();
            return;
          }

          wx.showModal({
            title: "需要相册权限",
            content: "保存图片到本地需要开启相册权限。",
            success: ({ confirm }) => {
              if (!confirm) {
                reject(new Error("已取消下载"));
                return;
              }

              wx.openSetting({
                success: (openRes) => {
                  if (openRes.authSetting && openRes.authSetting[scopeKey]) {
                    resolve();
                  } else {
                    reject(new Error("未开启相册权限"));
                  }
                },
                fail: () => reject(new Error("无法打开权限设置"))
              });
            },
            fail: () => reject(new Error("权限校验失败"))
          });
        },
        fail: () => reject(new Error("权限校验失败"))
      });
    });
  },

  downloadImageToLocal(imageUrl) {
    if (isCloudFileId(imageUrl)) {
      return wx.cloud.downloadFile({
        fileID: imageUrl
      }).then((res) => {
        if (!res.tempFilePath) {
          throw new Error("云图片下载失败");
        }
        return res.tempFilePath;
      });
    }

    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: imageUrl,
        success: (res) => {
          if (res.statusCode >= 200 && res.statusCode < 300 && res.tempFilePath) {
            resolve(res.tempFilePath);
            return;
          }
          reject(new Error("图片下载失败"));
        },
        fail: () => reject(new Error("图片下载失败"))
      });
    });
  },

  saveImageToAlbum(filePath) {
    return new Promise((resolve, reject) => {
      wx.saveImageToPhotosAlbum({
        filePath,
        success: resolve,
        fail: (error) => {
          if (error && /auth deny|auth denied/i.test(String(error.errMsg || ""))) {
            reject(new Error("未开启相册权限"));
            return;
          }
          reject(new Error("保存图片失败"));
        }
      });
    });
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: "/admin/pages/goods/list/list"
        });
      }
    });
  },

  goEdit() {
    wx.navigateTo({
      url: `/admin/pages/goods/edit/edit?id=${this.data.id}`
    });
  },

  copyLink(event) {
    const { url } = event.currentTarget.dataset;
    wx.setClipboardData({
      data: url
    });
  },

  handleDelete() {
    if (this.data.productView.displayStatus === "sold") {
      wx.showToast({
        title: "已售出商品不能删除",
        icon: "none"
      });
      return;
    }

    wx.showModal({
      title: "确认删除",
      content: "删除后不可恢复，确认删除该商品吗？",
      success: async ({ confirm }) => {
        if (!confirm) {
          return;
        }

        try {
          await productsRepository.deleteProducts([this.data.id]);
          await addOperationLog({
            title: "删除商品",
            target: this.data.id,
            type: "商品",
            note: this.data.productView ? `${this.data.productView.role || ""} ${this.data.productView.series || ""}`.trim() : ""
          });
          wx.showToast({
            title: "删除成功",
            icon: "success"
          });
          setTimeout(() => {
            wx.reLaunch({
              url: "/admin/pages/goods/list/list"
            });
          }, 500);
        } catch (error) {
          await addOperationLog({
            title: "删除商品",
            target: this.data.id,
            type: "商品",
            note: formatFailureContext(error),
            success: false
          });
          wx.showToast({
            title: "删除失败，请重试",
            icon: "none"
          });
        }
      }
    });
  },

  openStatusSheet() {
    if (this.data.productView.displayStatus === "sold") {
      wx.showModal({
        title: "恢复上架",
        content: "确认将该商品从已售出恢复为已上架吗？",
      success: async ({ confirm }) => {
          if (!confirm) {
            return;
          }

          try {
            await productsRepository.restoreSoldProduct(this.data.id);
            await addOperationLog({
              title: "恢复商品上架",
              target: this.data.id,
              type: "商品",
              note: "从已售出恢复为已上架"
            });
            wx.showToast({
              title: "商品已恢复为已上架",
              icon: "success"
            });
            await this.loadProduct();
          } catch (error) {
            await addOperationLog({
              title: "恢复商品上架",
              target: this.data.id,
              type: "商品",
              note: formatFailureContext(error),
              success: false
            });
            wx.showToast({
              title: "操作失败，请重试",
              icon: "none"
            });
          }
        }
      });
      return;
    }

    const statusTarget = this.data.productView.displayStatus === "down" ? "up" : "sold";
    this.setStatusState(statusTarget, 1, true);
  },

  closeStatusSheet() {
    this.setData({
      showStatusSheet: false
    });
  },

  chooseStatus(event) {
    const { status } = event.currentTarget.dataset;
    this.setStatusState(status, 1, true);
  },

  getMaxStatusQuantity(status) {
    return status === "sold" ? Math.max(1, this.data.productView.remainingCount) : 1;
  },

  buildStatusNote(status, quantity) {
    if (status === "sold") {
      return `确认后将从剩余可售扣减 ${quantity} 件并累加到「已售出」。扣到 0 时整件商品自动显示为「已售出」。`;
    }

    if (status === "up") {
      return "切换为已上架后，商品会在商品列表立即可见。";
    }

    return "切换为已下架后，商品会立即从可售状态移除，但不会影响历史售出数量。";
  },

  setStatusState(status, quantity, showStatusSheet) {
    const maxStatusQuantity = this.getMaxStatusQuantity(status);
    const nextQuantity = Math.min(Math.max(1, quantity), maxStatusQuantity);

    this.setData({
      showStatusSheet,
      statusTarget: status,
      statusQuantity: nextQuantity,
      maxStatusQuantity,
      statusNote: this.buildStatusNote(status, nextQuantity)
    });
  },

  increaseStatusQuantity() {
    if (this.data.statusQuantity >= this.data.maxStatusQuantity) {
      return;
    }

    this.setStatusState(this.data.statusTarget, this.data.statusQuantity + 1, true);
  },

  decreaseStatusQuantity() {
    if (this.data.statusQuantity <= 1) {
      return;
    }

    this.setStatusState(this.data.statusTarget, this.data.statusQuantity - 1, true);
  },

  async submitStatusChange() {
    const { productView, statusTarget, statusQuantity } = this.data;

    if (statusTarget === productView.displayStatus && statusTarget !== "sold") {
      wx.showToast({
        title: "当前已经是该状态",
        icon: "none"
      });
      return;
    }

    if (statusTarget === "sold") {
      try {
        const ownerUser = await usersRepository.getUserById(String(this.data.product && this.data.product.ownerUserId || "").trim());
        const rateFraction = getUserRateFraction(ownerUser);
        await productsRepository.recordProductSale(this.data.id, statusQuantity, rateFraction);
        await addOperationLog({
          title: "标记商品售出",
          target: this.data.id,
          type: "商品",
          note: `售出 ${statusQuantity} 件`
        });

        wx.showToast({
          title: statusQuantity === productView.remainingCount ? "该商品已全部售出" : "状态修改成功",
          icon: "success"
        });
        this.closeStatusSheet();
        await this.loadProduct();
      } catch (error) {
        await addOperationLog({
          title: "标记商品售出",
          target: this.data.id,
          type: "商品",
          note: formatFailureContext(error, `售出 ${statusQuantity} 件`),
          success: false
        });
        wx.showToast({
          title: "状态修改失败",
          icon: "none"
        });
      }
      return;
    }

    try {
      await productsRepository.updateProduct(this.data.id, {
        status: statusTarget
      });
      await addOperationLog({
        title: statusTarget === "up" ? "商品上架" : "商品下架",
        target: this.data.id,
        type: "商品",
        note: `状态改为 ${statusTarget === "up" ? "已上架" : "已下架"}`
      });
      wx.showToast({
        title: "状态修改成功",
        icon: "success"
      });
      this.closeStatusSheet();
      await this.loadProduct();
    } catch (error) {
      await addOperationLog({
        title: statusTarget === "up" ? "商品上架" : "商品下架",
        target: this.data.id,
        type: "商品",
        note: formatFailureContext(error),
        success: false
      });
      wx.showToast({
        title: "状态修改失败",
        icon: "none"
      });
    }
  }
});
