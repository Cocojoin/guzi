const productsRepository = require("../../../../utils/productsRepository");
const { addOperationLog, formatFailureContext } = require("../../../../utils/adminSettings");
const { buildProductCard, PLATFORM_OPTIONS } = require("../../../../utils/productPresentation");
const { getValidLinks, sanitizeLinks } = require("../../../../utils/productForm");

function createPlatformLinkRows(existingLinks) {
  const map = new Map((Array.isArray(existingLinks) ? existingLinks : []).map((item) => [item.platform, item.url]));
  return PLATFORM_OPTIONS.map((platform, index) => ({
    platform,
    platformIndex: index,
    url: map.get(platform) || ""
  }));
}

function decorateItems(items) {
  return items.map((item) => {
    const validLinks = getValidLinks(item.links);
    return {
      ...item,
      error: validLinks.length ? "" : "请填写至少 1 条合法链接"
    };
  });
}

Page({
  data: {
    ids: [],
    items: [],
    canSubmit: false,
    pendingCount: 0,
    submitHint: "请为每件商品至少填写 1 条合法链接后再上架"
  },

  async onLoad(options) {
    const ids = String(options.ids || "")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    try {
      const records = await productsRepository.getProductsByIds(ids);
      const items = records
        .filter(Boolean)
        .map((item) => {
          const card = buildProductCard(item);
          return {
            id: item.id,
            title: card.title,
            owner: item.owner,
            links: createPlatformLinkRows(item.links)
          };
        });

      this.setData({
        ids,
        items
      });
      this.syncItems(items);
    } catch (error) {
      wx.showToast({
        title: "商品加载失败",
        icon: "none"
      });
    }
  },

  syncItems(sourceItems) {
    const items = decorateItems(sourceItems);
    const pendingCount = items.filter((item) => item.error).length;

    this.setData({
      items,
      canSubmit: pendingCount === 0,
      pendingCount,
      submitHint: pendingCount === 0
        ? "链接已齐备，可以直接提交批量上架。"
        : `还有 ${pendingCount} 件商品未填写合法链接`
    });
  },

  updateItem(id, updater) {
    const items = this.data.items.map((item) => {
      if (item.id !== id) {
        return item;
      }
      return updater({ ...item, links: item.links.slice() });
    });
    this.syncItems(items);
  },

  onUrlInput(event) {
    const { id, index } = event.currentTarget.dataset;
    this.updateItem(id, (item) => {
      item.links[index] = {
        ...item.links[index],
        url: event.detail.value
      };
      return item;
    });
  },

  fillExampleLinks() {
    const items = this.data.items.map((item, idx) => {
      const links = createPlatformLinkRows([]);
      if (idx % 2 === 0) {
        links[0].url = `https://mobile.yangkeduo.com/mock/${item.id.toLowerCase()}`;
      } else {
        links[2].url = `https://www.xiaohongshu.com/mock/${item.id.toLowerCase()}`;
      }
      return {
        ...item,
        links
      };
    });
    this.syncItems(items);
  },

  async handleSubmit() {
    if (!this.data.canSubmit) {
      wx.showToast({
        title: "请为每件商品至少填写 1 条合法链接后再上架",
        icon: "none"
      });
      return;
    }

    try {
      await productsRepository.bulkUpdateProducts(
        this.data.items.map((item) => ({
          id: item.id,
          data: {
          status: "up",
          links: sanitizeLinks(item.links)
          }
        }))
      );
      await addOperationLog({
        title: "批量填写链接并上架",
        target: `${this.data.items.length} 件商品`,
        type: "商品",
        note: this.data.items.map((item) => item.id).slice(0, 5).join("、")
      });

      wx.showToast({
        title: "批量上架成功",
        icon: "success"
      });
      setTimeout(() => {
        wx.reLaunch({
          url: "/admin/pages/goods/list/list"
        });
      }, 500);
    } catch (error) {
      await addOperationLog({
        title: "批量填写链接并上架",
        target: `${this.data.items.length} 件商品`,
        type: "商品",
        note: formatFailureContext(error, this.data.items.map((item) => item.id).slice(0, 5).join("、")),
        success: false
      });
      wx.showToast({
        title: "批量上架失败",
        icon: "none"
      });
    }
  },

  goBack() {
    wx.navigateBack({
      fail: () => {
        wx.reLaunch({
          url: "/admin/pages/goods/list/list"
        });
      }
    });
  }
});
