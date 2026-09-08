/**
 * English for NBS series titles.
 *
 * NBS titles are compositional: a base concept, a measure suffix, and a unit
 * in parentheses — 粗钢产量累计增长 (%) is [crude steel output][YTD growth][%].
 * The measures and units are closed sets, so most of every title can be
 * rendered deterministically. The base concepts (6,564 across the catalog)
 * come from a translation table produced once by scripts/translate-catalog.ts;
 * where the table has no entry, a token dictionary does longest-match
 * segmentation and leaves what it cannot render in Chinese.
 *
 * The Chinese title stays authoritative everywhere; this is a gloss.
 */

import { resolve } from "node:path";
import { pinyin } from "pinyin-pro";

const GLOSS_PATH = resolve(import.meta.dir, "../catalog/gloss-en.json");

/** Measure suffixes, longest first so 累计增长 wins over 增长. */
export const MEASURES: [string, string][] = [
  ["累计增长", "year-to-date growth, %"],
  ["累计同比", "year-to-date growth, %"],
  ["同比增长", "growth from a year ago, %"],
  ["环比增长", "growth from the prior period, %"],
  ["当期同比", "growth from a year ago, %"],
  ["增长速度", "growth rate, %"],
  ["累计值", "year to date"],
  ["当期值", "current period"],
  ["当季值", "quarterly value"],
  ["当月值", "monthly value"],
  ["_累计", "year to date"],
  ["_当期", "current period"],
  ["_同比", "growth from a year ago, %"],
  ["增速", "growth rate, %"],
];

export const UNITS: Record<string, string> = {
  "亿元": "100 million yuan", "万元": "10,000 yuan", "元": "yuan", "亿美元": "100 million US dollars", "万美元": "10,000 US dollars",
  "万吨": "10,000 tonnes", "吨": "tonnes", "万吨标准煤": "10,000 t of standard coal", "亿千瓦时": "100 million kWh", "万千瓦时": "10,000 kWh",
  "万人": "10,000 persons", "人": "persons", "万辆": "10,000 vehicles", "辆": "vehicles", "万台": "10,000 units", "台": "units",
  "万平方米": "10,000 m²", "亿件": "100 million pieces", "万件": "10,000 pieces", "万户": "10,000 households", "户": "households",
  "个": "count", "%": "%", "无": "ratio", "百分点": "percentage points", "天": "days", "小时": "hours", "万公里": "10,000 km",
  "亿吨公里": "100 million tonne-km", "亿人公里": "100 million passenger-km", "万立方米": "10,000 m³", "亿立方米": "100 million m³",
  "万千升": "10,000 kilolitres", "亿米": "100 million metres", "万米": "10,000 metres", "万千瓦": "10,000 kW", "千瓦": "kW",
  "上年同期=100": "index, prior-year period = 100", "上年同月=100": "index, prior-year month = 100", "上月=100": "index, prior month = 100",
  "上年=100": "index, prior year = 100", "上年同季=100": "index, prior-year quarter = 100", "2015年=100": "index, 2015 = 100", "2020年=100": "index, 2020 = 100",
};

/** Token dictionary for the fallback segmentation. Longest match wins. */
const TOKENS: [string, string][] = [
  ["国内生产总值", "GDP"], ["地区生产总值", "regional GDP"], ["居民消费价格", "consumer prices"], ["工业生产者出厂价格", "producer prices (factory gate)"],
  ["工业生产者购进价格", "producer purchase prices"], ["商品零售价格", "retail prices"], ["固定资产投资", "fixed-asset investment"], ["房地产开发投资", "real estate development investment"],
  ["社会消费品零售总额", "retail sales of consumer goods"], ["规模以上工业", "industry above designated size"], ["规模以上", "above designated size"],
  ["工业增加值", "industrial value added"], ["增加值", "value added"], ["城镇调查失业率", "surveyed urban unemployment rate"], ["失业率", "unemployment rate"],
  ["采购经理指数", "purchasing managers' index"], ["价格指数", "price index"], ["景气指数", "climate index"], ["信心指数", "confidence index"],
  ["新能源汽车", "new energy vehicles"], ["工业机器人", "industrial robots"], ["集成电路", "integrated circuits"], ["移动通信手持机", "mobile phones"], ["微型计算机设备", "microcomputers"],
  ["粗钢", "crude steel"], ["钢材", "steel products"], ["生铁", "pig iron"], ["原煤", "raw coal"], ["原油", "crude oil"], ["天然气", "natural gas"], ["发电量", "electricity generation"],
  ["用电量", "electricity consumption"], ["水泥", "cement"], ["平板玻璃", "flat glass"], ["化肥", "chemical fertilizer"], ["乙烯", "ethylene"], ["十种有色金属", "ten non-ferrous metals"],
  ["电解铝", "electrolytic aluminium"], ["汽车", "automobiles"], ["轿车", "passenger cars"], ["白酒", "baijiu"], ["啤酒", "beer"], ["卷烟", "cigarettes"], ["布", "cloth"], ["纱", "yarn"],
  ["房地产", "real estate"], ["商品房", "commercial housing"], ["住宅", "residential"], ["办公楼", "office buildings"], ["商业营业用房", "commercial premises"],
  ["销售面积", "floor space sold"], ["销售额", "sales value"], ["施工面积", "floor space under construction"], ["新开工面积", "floor space started"], ["竣工面积", "floor space completed"],
  ["面积", "floor space"], ["产量", "output"], ["产值", "output value"], ["销量", "sales volume"], ["销售", "sales"], ["库存", "inventories"], ["出口", "exports"], ["进口", "imports"],
  ["进出口", "imports and exports"], ["外商直接投资", "foreign direct investment"], ["实际使用外资", "FDI actually utilised"], ["货运量", "freight volume"], ["客运量", "passenger volume"],
  ["货物周转量", "freight turnover"], ["旅客周转量", "passenger turnover"], ["港口货物吞吐量", "port cargo throughput"], ["邮政业务", "postal services"], ["电信业务", "telecom services"],
  ["快递业务量", "express deliveries"], ["移动电话用户", "mobile phone subscribers"], ["互联网宽带接入用户", "broadband subscribers"],
  ["财政收入", "fiscal revenue"], ["财政支出", "fiscal expenditure"], ["税收收入", "tax revenue"], ["一般公共预算", "general public budget"], ["货币供应量", "money supply"],
  ["人民币贷款", "yuan loans"], ["人民币存款", "yuan deposits"], ["社会融资规模", "aggregate financing"], ["外汇储备", "foreign exchange reserves"],
  ["城镇居民", "urban residents"], ["农村居民", "rural residents"], ["全国居民", "all residents"], ["人均可支配收入", "per capita disposable income"], ["人均消费支出", "per capita consumption expenditure"],
  ["可支配收入", "disposable income"], ["消费支出", "consumption expenditure"], ["人均", "per capita"], ["居民", "residents"], ["城镇", "urban"], ["农村", "rural"],
  ["工业企业", "industrial enterprises"], ["企业", "enterprises"], ["利润总额", "total profits"], ["营业收入", "operating revenue"], ["营业成本", "operating costs"], ["利润", "profits"],
  ["国有控股", "state-controlled"], ["私营", "private"], ["外商及港澳台投资", "foreign and HK/Macao/Taiwan invested"], ["股份制", "joint-stock"],
  ["制造业", "manufacturing"], ["采矿业", "mining"], ["电力、热力、燃气及水生产和供应业", "utilities"], ["建筑业", "construction"], ["批发和零售业", "wholesale and retail"], ["批发", "wholesale"], ["零售", "retail"],
  ["餐饮", "catering"], ["住宿", "accommodation"], ["交通运输", "transport"], ["仓储", "warehousing"], ["金融业", "financial sector"], ["服务业", "services"], ["第一产业", "primary industry"],
  ["第二产业", "secondary industry"], ["第三产业", "tertiary industry"], ["农林牧渔业", "agriculture, forestry, fishing"], ["农业", "agriculture"], ["工业", "industry"],
  ["食品", "food"], ["烟酒", "tobacco and alcohol"], ["衣着", "clothing"], ["居住", "housing"], ["生活用品及服务", "household goods and services"], ["交通和通信", "transport and communication"],
  ["教育文化和娱乐", "education, culture and recreation"], ["医疗保健", "healthcare"], ["其他用品和服务", "other goods and services"], ["猪肉", "pork"], ["鲜菜", "fresh vegetables"], ["鲜果", "fresh fruit"],
  ["粮食", "grain"], ["食用油", "edible oil"], ["能源", "energy"], ["非食品", "non-food"], ["核心", "core"], ["消费品", "consumer goods"], ["生产资料", "means of production"], ["生活资料", "means of subsistence"],
  ["采掘", "mining"], ["原材料", "raw materials"], ["加工", "processing"], ["黑色金属", "ferrous metals"], ["有色金属", "non-ferrous metals"], ["化学原料", "chemical raw materials"], ["石油", "petroleum"], ["煤炭", "coal"],
  ["民间", "private"], ["基础设施", "infrastructure"], ["高技术产业", "high-tech industries"], ["东部地区", "eastern region"], ["中部地区", "central region"], ["西部地区", "western region"], ["东北地区", "northeastern region"],
  ["全国", "national"], ["31个大城市", "31 major cities"], ["16—24岁", "aged 16-24"], ["16-24岁", "aged 16-24"], ["25—29岁", "aged 25-29"], ["30—59岁", "aged 30-59"], ["本地户籍", "local hukou"], ["外来户籍", "migrant hukou"],
  ["劳动力", "labour force"], ["就业人员", "employed persons"], ["人口", "population"], ["出生率", "birth rate"], ["死亡率", "death rate"], ["城镇化率", "urbanisation rate"],
  ["主营业务收入", "main business revenue"], ["资产", "assets"], ["负债", "liabilities"], ["应收账款", "accounts receivable"], ["产成品", "finished goods"],
  ["总额", "total"], ["总量", "total"], ["总值", "gross value"], ["数", "number"], ["量", "volume"], ["额", "value"], ["率", "rate"], ["指数", "index"], ["不变价", "constant prices"], ["现价", "current prices"],
  ["月度", "monthly"], ["季度", "quarterly"], ["年度", "annual"], ["分类", "by category"], ["分行业", "by industry"], ["主要", "major"], ["产品", "products"], ["商品", "goods"], ["新增", "new"], ["余额", "balance"],
];
const SORTED_TOKENS = [...TOKENS].sort((a, b) => b[0].length - a[0].length);

let table: Record<string, string> | null = null;
async function loadTable(): Promise<Record<string, string>> {
  if (table) return table;
  try {
    const raw: unknown = await Bun.file(GLOSS_PATH).json();
    const out: Record<string, string> = {};
    if (typeof raw === "object" && raw !== null) {
      for (const [key, value] of Object.entries(raw)) if (typeof value === "string") out[key] = value;
    }
    table = out;
  } catch {
    table = {};
  }
  return table;
}
/** Synchronous access for callers that have already awaited `warmGloss()`. */
export async function warmGloss(): Promise<number> { return Object.keys(await loadTable()).length; }

export interface TitleParts { base: string; measure: string; unit: string; }

/** Split a title into base concept, measure suffix, and unit. */
export function splitTitle(name: string): TitleParts {
  let unit = "";
  let rest = name.replace(/\s*[（(]([^)）]*)[)）]\s*$/, (_, found: string) => { unit = found.trim(); return ""; }).trim();
  let measure = "";
  for (const [zh] of MEASURES) {
    if (rest.endsWith(zh)) { measure = zh; rest = rest.slice(0, -zh.length); break; }
  }
  return { base: rest.replace(/[\s_·]+$/, "").trim(), measure, unit };
}

/** Longest-match segmentation over the token dictionary. */
export function segmentGloss(base: string): string {
  const out: string[] = [];
  let index = 0;
  let pending = "";
  while (index < base.length) {
    let hit: [string, string] | undefined;
    for (const token of SORTED_TOKENS) { if (base.startsWith(token[0], index)) { hit = token; break; } }
    if (hit) {
      if (pending) { out.push(pending); pending = ""; }
      out.push(hit[1]);
      index += hit[0].length;
    } else {
      const char = base[index] ?? "";
      if (/[\s,，、_·()（）]/.test(char)) { if (pending) { out.push(pending); pending = ""; } if (char === "，" || char === ",") out.push(","); }
      else pending += char;
      index += 1;
    }
  }
  if (pending) out.push(pending);
  return out.join(" ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim();
}

/** The English gloss for a title, or "" when nothing at all could be rendered. */
export function glossTitle(name: string): string {
  const parts = splitTitle(name);
  const known = table ?? {};
  const baseEn = known[parts.base] ?? segmentGloss(parts.base);
  if (!baseEn) return "";
  const measureEn = MEASURES.find(([zh]) => zh === parts.measure)?.[1] ?? "";
  const base = baseOf(parts.unit);
  const head = [baseEn, measureEn, base].filter(Boolean).join(", ");
  return head.charAt(0).toUpperCase() + head.slice(1);
}

/** An index title's base period, "(上月=100)", is part of what the series is, so it stays in the English title. */
function baseOf(unit: string): string {
  if (!/=\s*100/.test(unit)) return "";
  if (/上年同月/.test(unit)) return "same month a year earlier = 100";
  if (/上年同期/.test(unit)) return "same period a year earlier = 100";
  if (/上月/.test(unit)) return "previous month = 100";
  if (/上年/.test(unit)) return "previous year = 100";
  return "base period = 100";
}

/** Toneless pinyin with spaces, for search: 失业率 → "shi ye lv". */
export function toPinyin(text: string): string {
  try {
    return pinyin(text, { toneType: "none", type: "array", nonZh: "consecutive", v: true }).join(" ").toLowerCase();
  } catch {
    return "";
  }
}

/** Distinct base concepts across a set of titles — the translation script's input. */
export function baseConcepts(names: string[]): string[] {
  return [...new Set(names.map((name) => splitTitle(name).base).filter(Boolean))];
}
