function isCloudFileId(path) {
  return typeof path === "string" && path.indexOf("cloud://") === 0;
}

function getExtname(path) {
  const match = String(path || "").match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  return match ? `.${match[1].toLowerCase()}` : ".jpg";
}

async function uploadImageToCloud(localPath, folder = "products") {
  if (!localPath) {
    return "";
  }
  if (isCloudFileId(localPath)) {
    return localPath;
  }

  const ext = getExtname(localPath);
  const cloudPath = `${folder}/${Date.now()}_${Math.random().toString(36).slice(2, 10)}${ext}`;
  const res = await wx.cloud.uploadFile({
    cloudPath,
    filePath: localPath
  });
  return res.fileID;
}

async function ensureCloudImages(paths, folder = "products", options = {}) {
  const list = Array.isArray(paths) ? paths : [];
  if (!list.length) {
    return [];
  }

  const result = new Array(list.length);
  const concurrency = 3;
  let cursor = 0;
  let completed = 0;
  const onProgress = typeof options.onProgress === "function" ? options.onProgress : null;

  async function worker() {
    while (cursor < list.length) {
      const index = cursor;
      cursor += 1;
      const fileId = await uploadImageToCloud(list[index], folder);
      result[index] = fileId || "";
      completed += 1;
      if (onProgress) {
        onProgress(completed, list.length);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrency, list.length); i += 1) {
    workers.push(worker());
  }
  await Promise.all(workers);

  // 保持索引对应关系，不过滤空值
  return result;
}

module.exports = {
  ensureCloudImages,
  isCloudFileId,
  uploadImageToCloud
};
