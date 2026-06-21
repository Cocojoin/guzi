const productsRepository = require("../../../../utils/productsRepository");
const usersRepository = require("../../../../utils/usersRepository");
const { ensureCloudImages } = require("../../../../utils/cloudFile");
const { addOperationLog, formatFailureContext } = require("../../../../utils/adminSettings");
const { normalizeIpName } = require("../../../../utils/ipGroupsRepository");

function parseCsvLine(line) {
  const fields = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === "\"") {
      const next = line[index + 1];
      if (inQuotes && next === "\"") {
        current += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  fields.push(current.trim());
  return fields;
}

function toNumber(value, defaultValue) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : defaultValue;
}

function getBaseName(filePath) {
  const normalized = String(filePath || "").replace(/\\/g, "/");
  const parts = normalized.split("/");
  return String(parts[parts.length - 1] || "").trim();
}

function getNameWithoutExt(fileName) {
  return String(fileName || "").replace(/\.[^.]+$/, "");
}

function buildIndexedImageFile(filePath, index, sourceName) {
  const normalizedPath = String(filePath || "");
  const extMatch = normalizedPath.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = extMatch ? `.${extMatch[1].toLowerCase()}` : ".jpg";
  return {
    path: normalizedPath,
    name: `${index}${ext}`,
    sourceName: String(sourceName || "").trim()
  };
}

function addLookupKey(lookup, key, index) {
  const normalizedKey = String(key || "").trim().toLowerCase();
  if (!normalizedKey || Number.isInteger(lookup[normalizedKey])) {
    return;
  }
  lookup[normalizedKey] = index;
}

function resolveImageIndex(imageRef, imageLookup) {
  const lookupKey = String(imageRef || "").trim().toLowerCase();
  return lookupKey ? imageLookup[lookupKey] : undefined;
}

function parseSingleImageRef(value) {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  return text.toLowerCase();
}

function parseImageRefs(value) {
  const text = String(value || "").trim();
  if (!text) {
    return [];
  }

  const parts = text
    .split(/[\s,，/、|]+/)
    .map((item) => item.trim())
    .filter(Boolean);

  const refs = [];
  const seen = {};
  parts.forEach((part) => {
    const ref = parseSingleImageRef(part);
    if (!ref || seen[ref]) {
      return;
    }
    seen[ref] = true;
    refs.push(ref);
  });
  return refs;
}

function extractProductIdNumber(productId) {
  const value = Number(String(productId || "").replace(/\D/g, ""));
  return Number.isFinite(value) ? value : 0;
}

function normalizeHeader(headerRow) {
  return (Array.isArray(headerRow) ? headerRow : []).map((item) => String(item || "").trim());
}

function escapeCsvValue(value) {
  const text = String(value == null ? "" : value);
  if (!/[",\n]/.test(text)) {
    return text;
  }
  return `"${text.replace(/"/g, "\"\"")}"`;
}

function resolveColumnIndexes(headerRow) {
  const headers = normalizeHeader(headerRow);
  const indexOf = (name) => headers.indexOf(name);
  return {
    ip: indexOf("IP"),
    role: indexOf("角色"),
    series: indexOf("系列"),
    type: indexOf("类型"),
    quantity: indexOf("数量"),
    price: indexOf("价格"),
    quality: indexOf("质量"),
    purchaseRecord: indexOf("购买记录"),
    status: indexOf("状态"),
    imageNo: indexOf("图片"),
    remark: indexOf("备注")
  };
}

function getMissingColumns(indexes) {
  const columnNames = {
    ip: "IP",
    role: "角色",
    series: "系列",
    type: "类型",
    quantity: "数量",
    price: "价格",
    quality: "质量",
    purchaseRecord: "购买记录",
    status: "状态",
    imageNo: "图片"
  };
  
  const missing = [];
  for (const [key, name] of Object.entries(columnNames)) {
    if (!Number.isInteger(indexes[key]) || indexes[key] < 0) {
      missing.push(name);
    }
  }
  return missing;
}

function isColumnIndexesValid(indexes) {
  const required = ["ip", "role", "series", "type", "quantity", "price", "quality", "purchaseRecord", "status", "imageNo"];
  return required.every((key) => Number.isInteger(indexes[key]) && indexes[key] >= 0);
}

function decodeXmlText(text) {
  return String(text || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function columnToIndex(column) {
  let index = 0;
  for (let i = 0; i < column.length; i += 1) {
    index = index * 26 + (column.charCodeAt(i) - 64);
  }
  return index - 1;
}

function fsReadFile(fs, filePath, encoding) {
  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath,
      encoding,
      success: resolve,
      fail: reject
    });
  });
}

function fsUnzip(fs, zipFilePath, targetPath) {
  return new Promise((resolve, reject) => {
    fs.unzip({
      zipFilePath,
      targetPath,
      success: resolve,
      fail: reject
    });
  });
}

async function parseCsvFile(fs, filePath) {
  const res = await fsReadFile(fs, filePath, "utf8");
  const raw = String(res.data || "").replace(/^\ufeff/, "");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseCsvLine(line));
}

async function parseXlsxFile(fs, filePath) {
  const unzipPath = `${wx.env.USER_DATA_PATH}/xlsx_${Date.now()}`;
  await fsUnzip(fs, filePath, unzipPath);

  const sharedStringsPath = `${unzipPath}/xl/sharedStrings.xml`;
  const sheetPath = `${unzipPath}/xl/worksheets/sheet1.xml`;

  let sharedStringsXml = "";
  try {
    const ssRes = await fsReadFile(fs, sharedStringsPath, "utf8");
    sharedStringsXml = String(ssRes.data || "");
  } catch (error) {
    sharedStringsXml = "";
  }

  const sheetRes = await fsReadFile(fs, sheetPath, "utf8");
  const sheetXml = String(sheetRes.data || "");

  const sharedStrings = [];
  if (sharedStringsXml) {
    const siMatches = sharedStringsXml.match(/<si[\s\S]*?<\/si>/g) || [];
    siMatches.forEach((si) => {
      const tMatches = si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) || [];
      const value = tMatches
        .map((t) => decodeXmlText(t.replace(/<\/?t[^>]*>/g, "")))
        .join("");
      sharedStrings.push(value);
    });
  }

  const rows = [];
  const rowMatches = sheetXml.match(/<row[\s\S]*?<\/row>/g) || [];
  
  rowMatches.forEach((rowXml) => {
    const cols = [];
    let maxColIndex = -1;
    const cellMatches = rowXml.match(/<c[\s\S]*?<\/c>/g) || [];
    
    cellMatches.forEach((cellXml) => {
      const refMatch = cellXml.match(/r="([A-Z]+)(\d+)"/);
      if (!refMatch) {
        return;
      }
      
      const colIndex = columnToIndex(refMatch[1]);
      maxColIndex = Math.max(maxColIndex, colIndex);
      
      const typeMatch = cellXml.match(/t="([^"]+)"/);
      const cellType = typeMatch ? typeMatch[1] : "";

      let value = "";
      if (cellType === "s") {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        const stringIndex = vMatch ? Number(vMatch[1]) : -1;
        value = stringIndex >= 0 ? (sharedStrings[stringIndex] || "") : "";
      } else if (cellType === "inlineStr") {
        const tMatch = cellXml.match(/<t[^>]*>([\s\S]*?)<\/t>/);
        value = tMatch ? decodeXmlText(tMatch[1]) : "";
      } else {
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/);
        value = vMatch ? decodeXmlText(vMatch[1]) : "";
      }

      cols[colIndex] = String(value || "").trim();
    });

    // 确保数组是连续的，没有空索引
    const normalizedCols = [];
    for (let i = 0; i <= maxColIndex; i++) {
      normalizedCols[i] = cols[i] || "";
    }
    
    rows.push(normalizedCols);
  });

  return rows.filter((row) => row.some((cell) => String(cell || "").trim()));
}

async function parseXlsXmlFile(fs, filePath) {
  const res = await fsReadFile(fs, filePath, "utf8");
  const xml = String(res.data || "").replace(/^\ufeff/, "");
  const tableMatch = xml.match(/<Table[\s\S]*?>([\s\S]*?)<\/Table>/i);
  if (!tableMatch) {
    return [];
  }

  const rows = [];
  const rowMatches = tableMatch[1].match(/<Row\b[\s\S]*?<\/Row>/gi) || [];
  rowMatches.forEach((rowXml) => {
    const cols = [];
    let currentIndex = 0;
    const cellMatches = rowXml.match(/<Cell\b[\s\S]*?<\/Cell>/gi) || [];

    cellMatches.forEach((cellXml) => {
      const indexMatch = cellXml.match(/\bss:Index="(\d+)"/i);
      if (indexMatch) {
        currentIndex = Math.max(0, Number(indexMatch[1]) - 1);
      }

      const dataMatch = cellXml.match(/<Data\b[^>]*>([\s\S]*?)<\/Data>/i);
      const value = dataMatch ? decodeXmlText(dataMatch[1]).replace(/<[^>]+>/g, "").trim() : "";
      cols[currentIndex] = value;
      currentIndex += 1;
    });

    rows.push(cols.map((item) => item || ""));
  });

  return rows.filter((row) => row.some((cell) => String(cell || "").trim()));
}

function buildImageLookup(imageFiles) {
  const lookup = {};
  
  console.log("buildImageLookup - 输入文件:", imageFiles);
  
  (Array.isArray(imageFiles) ? imageFiles : []).forEach((item, index) => {
    const fileName = String(item && item.name ? item.name : "").trim();
    const sourceName = getBaseName(item && item.sourceName ? item.sourceName : (item && item.path ? item.path : ""));
    const sourceBaseName = sourceName.toLowerCase();

    console.log(`  第${index + 1}张图 - 序号名: ${fileName}, 原始名: ${sourceName}`);

    // 只按原始文件名匹配，要求 Excel 中填写的图片字段与上传文件名一致
    if (sourceBaseName) {
      addLookupKey(lookup, sourceBaseName, index);
      console.log(`    添加: ${sourceBaseName} -> ${index}`);
    }
  });
  
  console.log("buildImageLookup - 最终查找表:", lookup);
  return lookup;
}

Page({
  data: {
    form: {
      imageFiles: [],
      imagePaths: [],
      owner: "",
      fileName: "",
      filePath: ""
    },
    errors: {},
    ownerIndex: 0,
    ownerOptions: [],
    ownerUserMap: {},
    ownerPickerOptions: ["请选择寄售用户"],
    submitting: false
  },

  async onLoad() {
    try {
      const consignmentUsers = await usersRepository.listConsignmentUsers();
      console.log("加载到的寄售用户列表：", consignmentUsers);
      
      const ownerOptions = Array.from(new Set(consignmentUsers.map((item) => item.nickname).filter(Boolean)));
      const ownerUserMap = {};
      consignmentUsers.forEach((item) => {
        const nickname = String(item.nickname || "").trim();
        if (nickname) ownerUserMap[nickname] = item._id;
      });
      
      console.log("处理后的寄售用户选项：", ownerOptions);
      console.log("用户映射：", ownerUserMap);
      
      this.setData({
        ownerOptions,
        ownerUserMap,
        ownerPickerOptions: ["请选择寄售用户"].concat(ownerOptions)
      });
    } catch (error) {
      console.error("加载寄售用户失败：", error);
      wx.showToast({
        title: "寄售用户加载失败",
        icon: "none"
      });
    }
  },

  onOwnerChange(event) {
    const ownerIndex = Number(event.detail.value);
    const owner = ownerIndex > 0 ? this.data.ownerPickerOptions[ownerIndex] : "";
    this.setData({
      ownerIndex,
      "form.owner": owner,
      "errors.owner": ""
    });
  },

  choosePhoto() {
    const appendFiles = (tempFiles, useOriginalName) => {
      const valid = [];
      const validFiles = [];
      let rejected = 0;

      (tempFiles || []).forEach((file) => {
        if (file.size && file.size > 5 * 1024 * 1024) {
          rejected += 1;
          return;
        }

        const filePath = String(file.path || file.tempFilePath || "");
        if (!filePath) {
          return;
        }

        const existingCount = this.data.form.imageFiles.length + validFiles.length + 1;
        const sourceName = useOriginalName
          ? String(file.name || getBaseName(filePath) || "").trim()
          : getBaseName(filePath);

        valid.push(filePath);
        validFiles.push(buildIndexedImageFile(filePath, existingCount, sourceName));
      });

      console.log("有效的图片文件:", validFiles.map((f) => ({
        indexName: f.name,
        sourceName: f.sourceName
      })));

      if (rejected) {
        wx.showToast({
          title: `已过滤 ${rejected} 张超过 5M 的图片`,
          icon: "none"
        });
      }

      this.setData({
        "form.imageFiles": this.data.form.imageFiles.concat(validFiles),
        "form.imagePaths": this.data.form.imagePaths.concat(valid),
        "errors.images": ""
      });
    };

    wx.chooseMessageFile({
      count: 100,
      type: "image",
      success: (res) => {
        console.log("chooseMessageFile 选择的文件:", res.tempFiles);
        appendFiles(res.tempFiles, true);
      },
      fail: (err) => {
        console.warn("chooseMessageFile 选择图片失败，回退 chooseMedia:", err);
        if (String(err.errMsg || "").indexOf("cancel") !== -1) {
          return;
        }

        wx.chooseMedia({
          count: 999,
          mediaType: ["image"],
          sizeType: ["compressed", "original"],
          sourceType: ["album", "camera"],
          success: (res) => {
            console.log("chooseMedia 选择的文件:", res.tempFiles);
            appendFiles(res.tempFiles, false);
          }
        });
      }
    });
  },

  chooseFile() {
    wx.chooseMessageFile({
      count: 1,
      type: "file",
      extension: [".csv", ".xlsx", ".xls"],
      success: (res) => {
        const file = (res.tempFiles || [])[0];
        if (!file) {
          return;
        }
        this.setData({
          "form.fileName": file.name,
          "form.filePath": file.path,
          "errors.file": ""
        });
      },
      fail: (err) => {
        if (String(err.errMsg || "").indexOf("cancel") === -1) {
          wx.showToast({
            title: "请选择 .csv / .xlsx / .xls 文件",
            icon: "none"
          });
        }
      }
    });
  },

  clearFile() {
    this.setData({
      "form.fileName": "",
      "form.filePath": ""
    });
  },

  downloadTemplate() {
    const templateRows = [
      [
        "IP",
        "角色",
        "系列",
        "类型",
        "数量",
        "价格",
        "质量",
        "购买记录",
        "状态",
        "图片",
        "备注"
      ],
      [
        "崩坏星穹铁道",
        "流萤",
        "星旅票",
        "镭射票",
        "2",
        "68",
        "无暇",
        "有",
        "已下架",
        "1.png,2.png",
        "由批量上传创建"
      ]
    ];
    const content = `\ufeff${templateRows.map((row) => row.map((cell) => escapeCsvValue(cell)).join(",")).join("\n")}`;
    const filePath = `${wx.env.USER_DATA_PATH}/商品批量上传模板.csv`;
    wx.showLoading({ title: "生成中", mask: true });
    const fs = wx.getFileSystemManager();
    fs.writeFile({
      filePath,
      data: content,
      encoding: "utf8",
      success: () => {
        wx.hideLoading();
        wx.showToast({
          title: "模板已生成",
          icon: "success"
        });

        wx.openDocument({
          filePath,
          fileType: "csv",
          showMenu: true,
          fail: () => {
            wx.showModal({
              title: "模板已保存",
              content: `当前设备无法直接预览 CSV。\n文件已保存到：${filePath}`,
              showCancel: false
            });
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({
          title: "模板生成失败",
          icon: "none"
        });
      }
    });
  },

  async handleSubmit() {
    if (this.data.submitting) {
      return;
    }

    const errors = {};
    if (!this.data.form.imagePaths.length) {
      errors.images = "请上传商品图片";
    }
    if (!this.data.form.owner) {
      errors.owner = "请选择寄售用户";
    } else if (!this.data.ownerOptions.includes(this.data.form.owner)) {
      errors.owner = "请选择有效寄售用户";
    }
    if (!this.data.form.fileName || !this.data.form.filePath) {
      errors.file = "请上传商品表格文件";
    }

    this.setData({ errors });
    if (Object.keys(errors).length) {
      wx.showToast({
        title: Object.values(errors)[0],
        icon: "none"
      });
      return;
    }

    const filePath = this.data.form.filePath;
    const lowerPath = String(filePath || "").toLowerCase();
    if (!/\.(csv|xlsx|xls)$/i.test(lowerPath)) {
      wx.showToast({
        title: "仅支持 .csv / .xlsx / .xls 文件",
        icon: "none"
      });
      return;
    }

    const fs = wx.getFileSystemManager();
    this.setData({ submitting: true });
    wx.showLoading({
      title: "上传中",
      mask: true
    });
    try {
      let tableRows = [];
      if (lowerPath.endsWith(".csv")) {
        tableRows = await parseCsvFile(fs, filePath);
      } else if (lowerPath.endsWith(".xlsx")) {
        tableRows = await parseXlsxFile(fs, filePath);
      } else if (lowerPath.endsWith(".xls")) {
        tableRows = await parseXlsXmlFile(fs, filePath);
      } else {
        return;
      }

      console.log("解析后的表格行数:", tableRows.length);
      console.log("表头行:", tableRows[0]);

      if (tableRows.length <= 1) {
        wx.showToast({
          title: "表格无有效数据",
          icon: "none"
        });
        return;
      }

      const columnIndexes = resolveColumnIndexes(tableRows[0]);
      console.log("列索引:", columnIndexes);
      
      if (!isColumnIndexesValid(columnIndexes)) {
        const missing = getMissingColumns(columnIndexes);
        wx.showToast({
          title: `缺少必要列：${missing.join("、")}`,
          icon: "none",
          duration: 3000
        });
        return;
      }

      const imagePaths = this.data.form.imagePaths;
      const imageFiles = this.data.form.imageFiles;
      console.log("已上传的图片文件:", imageFiles.map(f => f.name));
      
      if (!imageFiles.length) {
        wx.showToast({
          title: "请先上传商品图片",
          icon: "none"
        });
        return;
      }
      
      const imageLookup = buildImageLookup(imageFiles);
      console.log("图片查找表:", imageLookup);
      
      // 检查是否有有效的图片映射
      const lookupKeys = Object.keys(imageLookup);
      if (lookupKeys.length === 0) {
        wx.showToast({
          title: "图片文件名解析失败",
          icon: "none"
        });
        return;
      }
      
      const cloudImagePaths = await ensureCloudImages(imagePaths, "products");
      console.log("云存储图片路径:", cloudImagePaths);
      
      // 检查是否有上传失败的图片
      const failedUploads = cloudImagePaths.map((path, index) => ({ path, index })).filter(item => !item.path);
      if (failedUploads.length > 0) {
        wx.showModal({
          title: "图片上传失败",
          content: `有 ${failedUploads.length} 张图片上传失败，请检查网络后重试。`,
          showCancel: false
        });
        return;
      }
      
      const selectedOwner = this.data.form.owner;
      let createdCount = 0;
      const invalidImageRows = [];
      const existingProducts = await productsRepository.getAllProducts();
      let nextIdNumber = existingProducts.reduce((max, item) => Math.max(max, extractProductIdNumber(item.id)), 0) + 1;
      const rows = tableRows.slice(1);
      const pendingProducts = [];

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
        const cols = rows[rowIndex];
        const ip = String(cols[columnIndexes.ip] || "").trim();
        const role = String(cols[columnIndexes.role] || "").trim();
        const series = String(cols[columnIndexes.series] || "").trim();
        const type = String(cols[columnIndexes.type] || "小卡").trim() || "小卡";
        const quantity = toNumber(cols[columnIndexes.quantity], 1);
        const price = toNumber(cols[columnIndexes.price], 0);
        const quality = String(cols[columnIndexes.quality] || "").trim() === "有瑕" ? "flaw" : "clean";
        const purchaseRecord = String(cols[columnIndexes.purchaseRecord] || "").trim() === "有" ? "有" : "无";
        const status = String(cols[columnIndexes.status] || "").trim() === "已上架" ? "up" : "down";
        const imageRefs = parseImageRefs(cols[columnIndexes.imageNo]);
        const remark = String(cols[columnIndexes.remark] || "").trim();

        console.log(`第${rowIndex + 2}行 - 图片引用:`, imageRefs);

        if (!ip || !role || !series || price <= 0) {
          continue;
        }

        if (!imageRefs.length) {
          invalidImageRows.push(rowIndex + 2);
          continue;
        }

        const missingImages = [];
        const images = imageRefs
          .map((imageRef) => {
            const lookupKey = String(imageRef || "").toLowerCase();
            const imageIndex = resolveImageIndex(imageRef, imageLookup);
            console.log(`  查找图片 "${lookupKey}": 索引 = ${imageIndex}`);
            
            if (!Number.isInteger(imageIndex) || imageIndex < 0 || imageIndex >= cloudImagePaths.length) {
              console.log(`  ❌ 图片 "${imageRef}" 未找到`);
              missingImages.push(imageRef);
              return "";
            }
            console.log(`  ✅ 找到图片:`, cloudImagePaths[imageIndex]);
            return cloudImagePaths[imageIndex] || "";
          })
          .filter(Boolean);

        if (images.length !== imageRefs.length) {
          console.log(`第${rowIndex + 2}行图片不匹配: 期望${imageRefs.length}张, 实际${images.length}张`);
          invalidImageRows.push({
            row: rowIndex + 2,
            missing: missingImages
          });
          continue;
        }

        pendingProducts.push({
          ownerUserId: this.data.ownerUserMap[selectedOwner] || "",
          owner: selectedOwner,
          ip,
          role,
          series,
          type,
          customType: "",
          totalQuantity: Math.max(1, Math.floor(quantity)),
          price,
          quality,
          purchaseRecord,
          status,
          remark: remark || "由批量上传创建。",
          images,
          links: []
        });
      }

      if (invalidImageRows.length) {
        const firstError = invalidImageRows[0];
        const rowNum = typeof firstError === 'object' ? firstError.row : firstError;
        const missing = typeof firstError === 'object' ? firstError.missing : [];
        const missingStr = missing.length ? `（${missing.join(", ")}）` : "";
        
        wx.showModal({
          title: "图片匹配失败",
          content: `第${rowNum}行图片未找到${missingStr}。\n\nExcel 图片字段必须与上传图片的文件名完全一致。`,
          showCancel: false
        });
        return;
      }

      for (let index = 0; index < pendingProducts.length; index += 1) {
        const id = `A${String(nextIdNumber).padStart(5, "0")}`;
        nextIdNumber += 1;
        await productsRepository.createProduct({
          id,
          ...pendingProducts[index]
        });

        createdCount += 1;
      }

      if (!createdCount) {
        wx.showToast({
          title: "未导入成功，请检查模板数据",
          icon: "none"
        });
        return;
      }

      await addOperationLog({
        title: "批量导入商品",
        target: `${createdCount} 件商品`,
        type: "商品",
        note: `${selectedOwner} · ${this.data.form.fileName || "批量文件"}`
      });
      const importedIps = [...new Set(
        pendingProducts
          .map((item) => normalizeIpName(item.ip))
          .filter(Boolean)
      )];
      if (importedIps.length) {
        await addOperationLog({
          title: "批量导入自动同步 IP",
          target: `${importedIps.length} 个 IP`,
          type: "IP管理",
          note: importedIps.join("、")
        });
      }
      wx.showToast({
        title: `导入成功 ${createdCount} 条`,
        icon: "success"
      });
      wx.hideLoading();
      setTimeout(() => {
        wx.reLaunch({
          url: "/admin/pages/goods/list/list"
        });
      }, 500);
    } catch (error) {
      await addOperationLog({
        title: "批量导入商品",
        target: this.data.form.fileName || "批量文件",
        type: "商品",
        note: formatFailureContext(error, this.data.form.owner || "未选寄售人"),
        success: false
      });
      wx.showToast({
        title: String(error && error.errMsg ? error.errMsg : "导入失败，请检查数据后重试").slice(0, 30),
        icon: "none"
      });
    } finally {
      wx.hideLoading();
      this.setData({ submitting: false });
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
