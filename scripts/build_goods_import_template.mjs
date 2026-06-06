import fs from "node:fs/promises";
import path from "node:path";
import { SpreadsheetFile, Workbook } from "@oai/artifact-tool";

const outputDir = "/Users/youyue/Documents/谷子寄售/outputs/goods-template";
const outputPath = path.join(outputDir, "商品批量上传导入模板.xlsx");

const workbook = Workbook.create();

const template = workbook.worksheets.add("商品导入模板");
const guide = workbook.worksheets.add("填写说明");
const dict = workbook.worksheets.add("选项字典");

const headers = [
  "商品编号",
  "图片标识*",
  "IP*",
  "系列*",
  "角色*",
  "类型*",
  "自定义类型",
  "数量*",
  "价格*",
  "质量*",
  "购买记录*",
  "备注",
  "拼多多链接",
  "淘宝/天猫链接",
  "小红书链接"
];

function styleTitle(range) {
  range.format.fill = { color: "#B0DDFA" };
  range.format.font = { bold: true, color: "#1F3347", size: 16 };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
}

function styleHeader(range) {
  range.format.fill = { color: "#EAF7FF" };
  range.format.font = { bold: true, color: "#24435A" };
  range.format.horizontalAlignment = "center";
  range.format.verticalAlignment = "center";
  range.format.wrapText = true;
}

function styleNote(range) {
  range.format.fill = { color: "#FFF7E8" };
  range.format.font = { color: "#6B4F1D" };
  range.format.wrapText = true;
  range.format.verticalAlignment = "center";
}

function setWidths(sheet, widths) {
  widths.forEach((width, index) => {
    sheet.getRangeByIndexes(0, index, 1, 1).format.columnWidthPx = width;
  });
}

template.showGridLines = false;
template.getRange("A1:O1").merge();
template.getRange("A1:O1").values = [["商品批量上传导入模板"]];
styleTitle(template.getRange("A1:O1"));
template.getRange("A1:O1").format.rowHeightPx = 34;

template.getRange("A2:O2").merge();
template.getRange("A2:O2").values = [[
  "填写说明：带 * 为必填列；商品编号可留空由系统生成；图片文件需按“图片标识-序号”命名；任一平台链接合法则商品默认已上架，否则默认已下架。"
]];
styleNote(template.getRange("A2:O2"));
template.getRange("A2:O2").format.rowHeightPx = 42;

template.getRange("A4:O4").values = [headers];
styleHeader(template.getRange("A4:O4"));
template.getRange("A4:O4").format.rowHeightPx = 32;

const blankRows = Array.from({ length: 100 }, () => Array(headers.length).fill(""));
template.getRange("A5:O104").values = blankRows;
template.getRange("A5:O104").format.fill = { color: "#FFFFFF" };
template.getRange("A5:O104").format.wrapText = true;
template.getRange("A5:A104").format.numberFormat = [["@"]];
template.getRange("B5:G104").format.numberFormat = Array.from({ length: 100 }, () => ["@"]);
template.getRange("H5:H104").format.numberFormat = Array.from({ length: 100 }, () => ["0"]);
template.getRange("I5:I104").format.numberFormat = Array.from({ length: 100 }, () => ["0.00"]);
template.getRange("J5:O104").format.numberFormat = Array.from({ length: 100 }, () => Array(6).fill("@"));
setWidths(template, [98, 104, 120, 132, 120, 104, 118, 82, 86, 82, 96, 180, 220, 220, 220]);
template.freezePanes.freezeRows(4);

template.getRange("F5:F104").dataValidation = { rule: { type: "list", values: ["小卡", "吧唧", "镭射票", "自定义"] } };
template.getRange("J5:J104").dataValidation = { rule: { type: "list", values: ["有瑕", "无暇"] } };
template.getRange("K5:K104").dataValidation = { rule: { type: "list", values: ["有", "无"] } };
template.getRange("H5:H104").dataValidation = { rule: { type: "whole", operator: "greaterThan", formula1: 0 } };
template.getRange("I5:I104").dataValidation = { rule: { type: "decimal", operator: "greaterThan", formula1: 0 } };

guide.showGridLines = false;
guide.getRange("A1:E1").merge();
guide.getRange("A1:E1").values = [["商品批量上传模板填写说明"]];
styleTitle(guide.getRange("A1:E1"));
guide.getRange("A1:E1").format.rowHeightPx = 34;

const guideHeaders = ["列名", "是否必填", "填写规则", "示例", "导入处理"];
const guideRows = [
  ["商品编号", "否", "可留空；填写时需与系统编号格式一致，不能与已有商品重复", "A00128", "为空则系统生成；重复则该行失败"],
  ["图片标识", "是", "用于匹配图片文件；同一商品图片命名为 图片标识-序号.jpg/png/webp", "A00128", "至少匹配 1 张图片；序号最小为封面"],
  ["IP", "是", "1-12 字", "咒术回战", "超长或为空则该行失败"],
  ["系列", "是", "1-12 字", "剧场版闪卡", "超长或为空则该行失败"],
  ["角色", "是", "1-12 字", "乙骨忧太", "超长或为空则该行失败"],
  ["类型", "是", "小卡 / 吧唧 / 镭射票 / 自定义", "小卡", "不在选项内则该行失败"],
  ["自定义类型", "条件必填", "当类型为自定义时必填，1-12 字", "亚克力挂件", "类型非自定义时可留空"],
  ["数量", "是", "正整数，大于 0", "3", "非正整数则该行失败"],
  ["价格", "是", "大于 0，最多 2 位小数", "58.00", "格式错误则该行失败"],
  ["质量", "是", "有瑕 / 无暇", "无暇", "不在选项内则该行失败"],
  ["购买记录", "是", "有 / 无", "有", "不在选项内则该行失败"],
  ["备注", "否", "0-200 字", "边角轻微压痕", "超长则该行失败"],
  ["拼多多链接", "否", "必须以 http:// 或 https:// 开头，域名需为拼多多白名单", "https://mobile.yangkeduo.com/...", "非法链接跳过，不阻断整行"],
  ["淘宝/天猫链接", "否", "必须以 http:// 或 https:// 开头，域名需为淘宝/天猫白名单", "https://detail.tmall.com/...", "非法链接跳过，不阻断整行"],
  ["小红书链接", "否", "必须以 http:// 或 https:// 开头，域名需为小红书白名单", "https://www.xiaohongshu.com/...", "非法链接跳过，不阻断整行"]
];
guide.getRange("A3:E3").values = [guideHeaders];
guide.getRangeByIndexes(3, 0, guideRows.length, guideHeaders.length).values = guideRows;
styleHeader(guide.getRange("A3:E3"));
guide.getRange("A4:E18").format.wrapText = true;
guide.getRange("A4:E18").format.verticalAlignment = "top";
setWidths(guide, [132, 92, 300, 220, 260]);

guide.getRange("A20:E20").merge();
guide.getRange("A20:E20").values = [["示例行（请不要直接粘贴到导入页，实际导入时按真实商品填写）："]];
styleNote(guide.getRange("A20:E20"));
guide.getRange("A22:O22").values = [headers];
styleHeader(guide.getRange("A22:O22"));
guide.getRange("A23:O24").values = [
  ["", "A00128", "咒术回战", "剧场版闪卡", "乙骨忧太", "小卡", "", 2, 76, "无暇", "有", "未拆封", "", "https://detail.tmall.com/mock/a00128", ""],
  ["", "A00129", "夏目友人帐", "一番赏", "夏目贵志", "自定义", "亚克力挂件", 1, 46.5, "有瑕", "无", "边角轻微压痕", "https://mobile.yangkeduo.com/mock/a00129", "", ""]
];
guide.getRange("A22:O24").format.wrapText = true;

dict.showGridLines = false;
dict.getRange("A1:D1").merge();
dict.getRange("A1:D1").values = [["选项字典与链接域名白名单"]];
styleTitle(dict.getRange("A1:D1"));
dict.getRange("A3:D3").values = [["字段", "可选值 / 白名单", "说明", "是否本期生效"]];
styleHeader(dict.getRange("A3:D3"));
dict.getRange("A4:D13").values = [
  ["类型", "小卡", "常规小卡类商品", "是"],
  ["类型", "吧唧", "徽章 / 吧唧类商品", "是"],
  ["类型", "镭射票", "票根 / 镭射票类商品", "是"],
  ["类型", "自定义", "选择后需填写自定义类型", "是"],
  ["质量", "有瑕", "商品存在瑕疵", "是"],
  ["质量", "无暇", "商品无明显瑕疵", "是"],
  ["购买记录", "有", "有购买记录", "是"],
  ["购买记录", "无", "无购买记录", "是"],
  ["链接域名", "yangkeduo.com / pinduoduo.com", "拼多多", "是"],
  ["链接域名", "taobao.com / tmall.com", "淘宝 / 天猫", "是"]
];
dict.getRange("A14:D14").values = [["链接域名", "xiaohongshu.com / xhslink.com", "小红书", "是"]];
dict.getRange("A4:D14").format.wrapText = true;
setWidths(dict, [120, 260, 220, 110]);

const sheetsToRender = ["商品导入模板", "填写说明", "选项字典"];
for (const sheetName of sheetsToRender) {
  await workbook.render({ sheetName, autoCrop: "all", scale: 1, format: "png" });
}

const errors = await workbook.inspect({
  kind: "match",
  searchTerm: "#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A",
  options: { useRegex: true, maxResults: 50 },
  summary: "formula error scan"
});
console.log(errors.ndjson);

await fs.mkdir(outputDir, { recursive: true });
const output = await SpreadsheetFile.exportXlsx(workbook);
await output.save(outputPath);
console.log(outputPath);
