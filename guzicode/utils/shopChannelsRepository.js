const dataAccessService = require("./dataAccessService");

const COLLECTION_NAME = "shop_channels";
const STORAGE_KEY = "adminShopChannelsLocal";
const SERVICE_SETTING_STORAGE_KEY = "adminShopContactSettingLocal";
const SERVICE_SETTING_DOC_ID = "shop_contact_service";

const PLATFORM_DEFINITIONS = [
  { key: "taobao", label: "淘宝", shortLabel: "淘", subtitle: "淘宝/天猫", accentClass: "shop-platform--taobao" },
  { key: "pdd", label: "拼多多", shortLabel: "拼", subtitle: "拼多多", accentClass: "shop-platform--pdd" },
  { key: "xhs", label: "小红书", shortLabel: "书", subtitle: "小红书", accentClass: "shop-platform--xhs" },
  { key: "xianyu", label: "闲鱼", shortLabel: "闲", subtitle: "闲鱼", accentClass: "shop-platform--xianyu" },
  { key: "weidian", label: "微店", shortLabel: "微", subtitle: "微店", accentClass: "shop-platform--weidian" },
  { key: "douyin", label: "抖音", shortLabel: "抖", subtitle: "抖音", accentClass: "shop-platform--douyin" },
  { key: "wechat", label: "微信", shortLabel: "信", subtitle: "微信", accentClass: "shop-platform--wechat" },
  { key: "official", label: "官方", shortLabel: "官", subtitle: "官方", accentClass: "shop-platform--official" }
];

const DEFAULT_CHANNELS = [
  createDefaultChannel("taobao", "谷圈星社官方店", "谷圈星社官方店", true, 0),
  createDefaultChannel("pdd", "谷圈星社官方店", "谷圈星社官方店", true, 1),
  createDefaultChannel("xhs", "星社の谷子铺", "ququan_xs", true, 2),
  createDefaultChannel("xianyu", "星社闲置小铺", "guquan-2nd", false, 3)
];

function createDefaultChannel(platformKey, storeName, keyword, enabled, sortIndex) {
  return {
    id: `shop_${platformKey}`,
    platformKey,
    storeName,
    searchKeyword: keyword,
    enabled: enabled !== false,
    showInDetail: enabled !== false,
    sortIndex: Number(sortIndex || 0),
    createdAt: new Date("2026-06-19T00:00:00.000Z").toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function clone(items) {
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

function getPlatformMeta(platformKey) {
  return PLATFORM_DEFINITIONS.find((item) => item.key === platformKey) || PLATFORM_DEFINITIONS[0];
}

function safeList(items) {
  const source = Array.isArray(items) ? items : DEFAULT_CHANNELS;
  return clone(source)
    .filter((item) => item && item.id !== SERVICE_SETTING_DOC_ID)
    .map(normalizeChannel)
    .sort((left, right) => Number(left.sortIndex || 0) - Number(right.sortIndex || 0));
}

function getLocalChannels() {
  return safeList(wx.getStorageSync(STORAGE_KEY) || []);
}

function saveLocalChannels(items) {
  wx.setStorageSync(STORAGE_KEY, safeList(items));
}

function normalizeChannel(item = {}) {
  const meta = getPlatformMeta(item.platformKey);
  return {
    id: String(item.id || `shop_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
    platformKey: meta.key,
    platformLabel: meta.label,
    platformSubtitle: meta.subtitle,
    platformShortLabel: meta.shortLabel,
    accentClass: meta.accentClass,
    storeName: String(item.storeName || "").trim(),
    searchKeyword: String(item.searchKeyword || item.storeName || "").trim(),
    enabled: item.enabled !== false,
    showInDetail: item.showInDetail !== false,
    sortIndex: Number.isFinite(Number(item.sortIndex)) ? Number(item.sortIndex) : 0,
    createdAt: String(item.createdAt || new Date().toISOString()),
    updatedAt: String(item.updatedAt || new Date().toISOString()),
    _id: item._id || ""
  };
}

async function listShopChannels() {
  try {
    const cloudItems = await dataAccessService.fetchAll(COLLECTION_NAME, {
      orderByField: "sortIndex",
      orderByDirection: "asc"
    });
    const normalized = safeList(cloudItems);
    saveLocalChannels(normalized);
    return normalized;
  } catch (error) {
    return getLocalChannels();
  }
}

async function getShopChannelById(id) {
  const list = await listShopChannels();
  return list.find((item) => item.id === String(id || "").trim()) || null;
}

async function saveShopChannel(input = {}) {
  const list = await listShopChannels();
  const now = new Date().toISOString();
  const normalized = normalizeChannel({
    ...input,
    updatedAt: now,
    createdAt: input.createdAt || now,
    searchKeyword: input.searchKeyword || input.storeName
  });
  const currentIndex = list.findIndex((item) => item.id === normalized.id);
  const nextList = list.slice();

  if (currentIndex >= 0) {
    nextList.splice(currentIndex, 1, {
      ...nextList[currentIndex],
      ...normalized
    });
  } else {
    nextList.push({
      ...normalized,
      sortIndex: nextList.length
    });
  }

  const sorted = nextList.map((item, index) => normalizeChannel({
    ...item,
    sortIndex: index,
    updatedAt: item.id === normalized.id ? now : item.updatedAt
  }));

  saveLocalChannels(sorted);
  await syncChannelsToCloud(sorted);
  return sorted.find((item) => item.id === normalized.id) || normalized;
}

async function deleteShopChannel(id) {
  const normalizedId = String(id || "").trim();
  const list = await listShopChannels();
  const nextList = list
    .filter((item) => item.id !== normalizedId)
    .map((item, index) => normalizeChannel({
      ...item,
      sortIndex: index
    }));
  saveLocalChannels(nextList);
  await syncChannelsToCloud(nextList);
  return nextList;
}

async function reorderShopChannels(ids = []) {
  const list = await listShopChannels();
  const channelMap = new Map(list.map((item) => [item.id, item]));
  const ordered = ids
    .map((id) => channelMap.get(String(id || "").trim()))
    .filter(Boolean);
  list.forEach((item) => {
    if (!ordered.find((current) => current.id === item.id)) {
      ordered.push(item);
    }
  });
  const nextList = ordered.map((item, index) => normalizeChannel({
    ...item,
    sortIndex: index
  }));
  saveLocalChannels(nextList);
  await syncChannelsToCloud(nextList);
  return nextList;
}

async function getVisibleShopChannels() {
  const list = await listShopChannels();
  return list.filter((item) => item.enabled && item.showInDetail && item.storeName);
}

function normalizeContactServiceSetting(input = {}) {
  return {
    id: SERVICE_SETTING_DOC_ID,
    enabled: input.enabled !== false,
    createdAt: String(input.createdAt || new Date().toISOString()),
    updatedAt: String(input.updatedAt || new Date().toISOString())
  };
}

function getLocalContactServiceSetting() {
  const saved = wx.getStorageSync(SERVICE_SETTING_STORAGE_KEY) || {};
  return normalizeContactServiceSetting(saved);
}

function saveLocalContactServiceSetting(setting) {
  wx.setStorageSync(SERVICE_SETTING_STORAGE_KEY, normalizeContactServiceSetting(setting));
}

async function getContactServiceSetting() {
  try {
    const cloudItems = await dataAccessService.fetchAll(COLLECTION_NAME);
    const cloudItem = (cloudItems || []).find((item) => String(item.id || "") === SERVICE_SETTING_DOC_ID);
    if (cloudItem) {
      const normalized = normalizeContactServiceSetting(cloudItem);
      saveLocalContactServiceSetting(normalized);
      return normalized;
    }
  } catch (error) {
    return getLocalContactServiceSetting();
  }
  return getLocalContactServiceSetting();
}

async function saveContactServiceSetting(enabled) {
  const current = await getContactServiceSetting();
  const next = normalizeContactServiceSetting({
    ...current,
    enabled: enabled !== false,
    updatedAt: new Date().toISOString()
  });
  saveLocalContactServiceSetting(next);
  try {
    const cloudItems = await dataAccessService.fetchAll(COLLECTION_NAME);
    const cloudItem = (cloudItems || []).find((item) => String(item.id || "") === SERVICE_SETTING_DOC_ID);
    const payload = {
      id: SERVICE_SETTING_DOC_ID,
      kind: "contact_service_setting",
      enabled: next.enabled,
      createdAt: next.createdAt,
      updatedAt: next.updatedAt
    };
    if (cloudItem && cloudItem._id) {
      await dataAccessService.updateDocById(COLLECTION_NAME, cloudItem._id, payload);
    } else {
      await dataAccessService.addDoc(COLLECTION_NAME, payload);
    }
  } catch (error) {
    return next;
  }
  return next;
}

async function syncChannelsToCloud(items) {
  const localItems = safeList(items);
  try {
    const cloudItems = await dataAccessService.fetchAll(COLLECTION_NAME);
    const cloudMap = new Map(cloudItems.map((item) => [String(item.id || ""), item]));

    for (let index = 0; index < localItems.length; index += 1) {
      const item = localItems[index];
      const cloudItem = cloudMap.get(item.id);
      const payload = {
        id: item.id,
        platformKey: item.platformKey,
        storeName: item.storeName,
        searchKeyword: item.searchKeyword,
        enabled: item.enabled,
        showInDetail: item.showInDetail,
        sortIndex: item.sortIndex,
        createdAt: item.createdAt,
        updatedAt: item.updatedAt
      };
      if (cloudItem && cloudItem._id) {
        await dataAccessService.updateDocById(COLLECTION_NAME, cloudItem._id, payload);
      } else {
        await dataAccessService.addDoc(COLLECTION_NAME, payload);
      }
    }

    for (let index = 0; index < cloudItems.length; index += 1) {
      const cloudItem = cloudItems[index];
      const exists = localItems.find((item) => item.id === cloudItem.id);
      if (!exists && cloudItem._id) {
        await dataAccessService.removeDocById(COLLECTION_NAME, cloudItem._id);
      }
    }
  } catch (error) {
    return localItems;
  }
  return localItems;
}

module.exports = {
  DEFAULT_CHANNELS,
  PLATFORM_DEFINITIONS,
  deleteShopChannel,
  getContactServiceSetting,
  getPlatformMeta,
  getShopChannelById,
  getVisibleShopChannels,
  listShopChannels,
  normalizeChannel,
  reorderShopChannels,
  saveContactServiceSetting,
  saveShopChannel
};
