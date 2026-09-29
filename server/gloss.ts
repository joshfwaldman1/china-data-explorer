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
  "万千升": "10,000 kilolitres", "亿米": "100 million metres", "万米": "10,000 metres", "万千瓦": "10,000 kW", "万载重吨": "10,000 deadweight tonnes", "千瓦": "kW",
  "上年同期=100": "index, prior-year period = 100", "上年同月=100": "index, prior-year month = 100", "上月=100": "index, prior month = 100",
  "上年=100": "index, prior year = 100", "上年同季=100": "index, prior-year quarter = 100", "2015年=100": "index, 2015 = 100", "2020年=100": "index, 2020 = 100",
  "件": "pieces", "项": "items", "百万美元": "million USD", "所": "institutions", "人年": "person-years", "万人次": "10,000 person-times", "千公顷": "1,000 hectares", "1/10万": "per 100,000", "篇": "papers", "万人年": "10,000 person-years", "种": "kinds", "日": "days", "千人次": "1,000 person-times", "米": "metres", "次": "times", "万个": "10,000 units", "公斤/公顷": "kg per hectare", "亿千瓦小时": "100 million kWh", "千克": "kg", "公里": "km", "万场次": "10,000 performances", "时": "hours", "起": "cases", "千场次": "1,000 performances", "件/套": "pieces or sets", "公斤": "kg", "万张": "10,000 sheets", "部": "units", "万册": "10,000 volumes", "亿吨": "100 million tonnes", "张": "sheets", "元/公斤": "yuan per kg", "批": "batches", "万盒": "10,000 boxes", "亿印张": "100 million printed sheets", "万公顷": "10,000 hectares", "座": "units", "亿册": "100 million volumes", "上年价格=100": "index, prior-year prices = 100", "元/人": "yuan per person", "亿人次": "100 million person-times", "万头": "10,000 head", "元/户": "yuan per household", "人次": "person-times", "处": "sites", "集": "episodes", "万分钟": "10,000 minutes", "公斤/人": "kg per person", "份": "copies", "家": "firms", "人口抽样调查": "population sample survey", "起/万人": "cases per 10,000 people", "公顷": "hectares", "万册、份": "10,000 volumes or copies", "套": "sets", "千美元": "thousand USD", "万份": "10,000 copies", "教师人数=1": "per teacher", "1978年=100": "index, 1978 = 100", "盒、张": "boxes or sheets", "亿条": "100 million messages", "万笔": "10,000 transactions", "架": "aircraft", "万部": "10,000 units", "万套": "10,000 sets", "万只": "10,000 head", "万件、套": "10,000 pieces or sets", "亿人": "100 million persons", "万千米": "10,000 km", "千米": "km",
};

/** Token dictionary for the fallback segmentation. Longest match wins. */
const TOKENS: [string, string][] = [
  // The three-economies table writes its measure into the title ("增长速度 (同比)"), where the measure suffixes above do not reach.
  ["消费者价格涨跌幅", "consumer price change"], ["涨跌幅", "change"], ["增长速度", "growth rate"], ["同比", "year on year"], ["环比", "month on month"],
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
  ["劳动力", "labor force"], ["就业人员", "employed persons"], ["人口", "population"], ["出生率", "birth rate"], ["死亡率", "death rate"], ["城镇化率", "urbanisation rate"],
  ["主营业务收入", "main business revenue"], ["资产", "assets"], ["负债", "liabilities"], ["应收账款", "accounts receivable"], ["产成品", "finished goods"],
  ["总额", "total"], ["总量", "total"], ["总值", "gross value"], ["数", "number"], ["量", "volume"], ["额", "value"], ["率", "rate"], ["指数", "index"], ["不变价", "constant prices"], ["现价", "current prices"],
  ["月度", "monthly"], ["季度", "quarterly"], ["年度", "annual"], ["分类", "by category"], ["分行业", "by industry"], ["主要", "major"], ["产品", "products"], ["商品", "goods"], ["新增", "new"], ["余额", "balance"],
  // Added 17 September 2026 for the annual and regional datasets' titles (see gloss-coverage.test.ts).
  ["大中型", "large and medium-sized"],
  ["中型", "medium-sized"],
  ["小型", "small"],
  ["微型", "micro"],
  ["大型", "large"],
  ["的比重", "share"],
  ["比重", "share"],
  ["专用设备", "special-purpose equipment"],
  ["通用设备", "general-purpose equipment"],
  ["口径", "scope"],
  ["占全部", "share of all"],
  ["占总", "share of total"],
  ["收入", "revenue"],
  ["管理", "management"],
  ["发明专利申请", "invention patent applications"],
  ["有效发明专利", "valid invention patents"],
  ["实用新型专利申请", "utility model patent applications"],
  ["外观设计专利申请", "design patent applications"],
  ["专利申请", "patent applications"],
  ["专利", "patents"],
  ["受理", "accepted"],
  ["授权", "granted"],
  ["研究与试验发展人员全时当量", "R&D personnel, full-time equivalent"],
  ["研究人员全时当量", "researchers, full-time equivalent"],
  ["研究与试验发展经费支出", "R&D expenditure"],
  ["研究与试验发展项目经费", "R&D project expenditure"],
  ["研究与试验发展项目", "R&D projects"],
  ["研究与试验发展机构", "R&D institutions"],
  ["研究与试验发展经费", "R&D expenditure"],
  ["研究与试验发展人员", "R&D personnel"],
  ["研究与试验发展", "R&D"],
  ["全时当量", "full-time equivalent"],
  ["实现产品创新的", "with product innovation"],
  ["实现工艺创新的", "with process innovation"],
  ["实现组织创新的", "with organisational innovation"],
  ["实现营销创新的", "with marketing innovation"],
  ["实现创新的", "innovating"],
  ["或工艺创新活动的", "or process innovation activity"],
  ["或营销创新活动的", "or marketing innovation activity"],
  ["创新活动的", "with innovation activity"],
  ["创新活动", "innovation activity"],
  ["实现组织", "with organisational"],
  ["实现", "achieved"],
  ["组织创新", "organisational innovation"],
  ["工艺创新", "process innovation"],
  ["营销创新", "marketing innovation"],
  ["产品创新", "product innovation"],
  ["创新", "innovation"],
  ["纺织服装、鞋、帽", "textiles, apparel, footwear and hats"],
  ["纺织服装", "textiles and apparel"],
  ["有组织", "organised"],
  ["小计", "subtotal"],
  ["合计", "total"],
  ["总计", "total"],
  ["外商及港澳台商投资", "foreign and HK/Macao/Taiwan-invested"],
  ["港澳台商投资", "HK/Macao/Taiwan-invested"],
  ["港澳台", "HK/Macao/Taiwan"],
  ["外商投资", "foreign-invested"],
  ["内资", "domestic-funded"],
  ["项目", "projects"],
  ["经费支出", "expenditure"],
  ["经费", "funds"],
  ["不含农户", "excluding rural households"],
  ["机构", "institutions"],
  ["课题", "research topics"],
  ["开发新", "developing new"],
  ["位次", "rank"],
  ["死亡人数", "deaths"],
  ["发病人数", "cases"],
  ["发病率", "incidence rate"],
  ["病死率", "case fatality rate"],
  ["艾滋病", "HIV/AIDS"],
  ["单位", "units"],
  ["港口", "port"],
  ["码头长度", "quay length"],
  ["泊位", "berths"],
  ["万吨级", "10,000-tonne class"],
  ["生产用", "productive"],
  ["非生产用", "non-productive"],
  ["比上年增长", "growth over previous year"],
  ["国外", "foreign"],
  ["医药", "pharmaceuticals"],
  ["营业", "operating"],
  ["亏损", "losses"],
  ["监督检查批次合格", "inspection batches passed"],
  ["监督检查有不合格", "inspection batches with failures"],
  ["监督检验", "supervisory inspection"],
  ["监督检查", "supervisory inspection"],
  ["所占比例", "share"],
  ["科协", "science and technology associations"],
  ["学会", "learned societies"],
  ["通信设备", "communications equipment"],
  ["中等职业学校", "secondary vocational schools"],
  ["非金融", "non-financial"],
  ["文化", "culture"],
  ["仪器仪表", "instruments and meters"],
  ["流动", "current"],
  ["固定", "fixed"],
  ["年末从业人员", "employees at year-end"],
  ["从业人员", "employees"],
  ["电视剧", "TV drama"],
  ["电视节目", "TV programmes"],
  ["动画电视", "TV animation"],
  ["纪录片", "documentaries"],
  ["税金及附加", "taxes and surcharges"],
  ["电子及通信设备", "electronic and communications equipment"],
  ["电子计算机及办公设备", "computers and office equipment"],
  ["电子计算机外部设备", "computer peripherals"],
  ["电子计算机整机", "complete computers"],
  ["电子器件", "electronic devices"],
  ["电子元件", "electronic components"],
  ["广播电视设备", "broadcasting equipment"],
  ["应交增值税", "VAT payable"],
  ["本年应交增值税", "VAT payable this year"],
  ["航空航天器", "aerospace vehicles"],
  ["化学药品制造", "chemical pharmaceuticals manufacturing"],
  ["家用视听设备", "household audio-visual equipment"],
  ["雷达及配套设备", "radar and ancillary equipment"],
  ["生物、生化制品的制造", "biological and biochemical products manufacturing"],
  ["生化制品的制造", "biochemical products manufacturing"],
  ["生物", "biological"],
  ["医疗器械及仪器仪表", "medical devices and instruments"],
  ["医疗仪器设备及器械", "medical instruments and devices"],
  ["中成药制造", "Chinese patent medicine manufacturing"],
  ["其他电子设备制造", "other electronic equipment manufacturing"],
  ["租赁和商务", "leasing and business services"],
  ["冶炼及压延", "smelting and rolling"],
  ["冶炼和压延", "smelting and rolling"],
  ["交货值", "delivery value"],
  ["开发项目", "development projects"],
  ["开发经费", "development funds"],
  ["矿采选业", "mining and dressing"],
  ["地方", "local"],
  ["毛皮", "fur"],
  ["家具", "furniture"],
  ["成人文化技术培训学校", "adult cultural and technical training schools"],
  ["竹、藤、棕、草制品业", "bamboo, rattan, palm and straw products"],
  ["草制品业", "straw products"],
  ["电力", "electricity"],
  ["木材", "timber"],
  ["其他", "other"],
  ["直辖市", "municipality"],
  ["化学纤维", "chemical fibres"],
  ["农副", "agricultural and sideline"],
  ["皮革", "leather"],
  ["累计折旧", "accumulated depreciation"],
  ["所有者权益合计", "total owners' equity"],
  ["所有者权益", "owners' equity"],
  ["实收资本", "paid-in capital"],
  ["费用", "expenses"],
  ["应付账款", "accounts payable"],
  ["财务费用", "financial expenses"],
  ["存货", "inventories"],
  ["管理费用", "administrative expenses"],
  ["销售费用", "selling expenses"],
  ["人民检察院批捕", "arrests approved by procuratorates"],
  ["人民检察院", "people's procuratorates"],
  ["人民法院", "people's courts"],
  ["政府资金支出", "government-funded expenditure"],
  ["政府资金", "government funds"],
  ["集体资本金", "collective capital"],
  ["外商资本金", "foreign capital"],
  ["法人资本金", "corporate capital"],
  ["国家资本金", "state capital"],
  ["个人资本金", "individual capital"],
  ["饮料", "beverages"],
  ["利息支出", "interest expense"],
  ["应交所得税", "income tax payable"],
  ["主营业务成本", "cost of main business"],
  ["台商投资", "Taiwan-invested"],
  ["执行", "executed"],
  ["电气机械及器材", "electrical machinery and equipment"],
  ["限额以上", "above designated size"],
  ["万元以上", "above 10,000 yuan"],
  ["万人", "10,000 persons"],
  ["人员", "personnel"],
  ["数量", "number"],
  ["个数", "number"],
  ["人次", "person-times"],
  ["场次", "performances"],
  ["公顷", "hectares"],
  ["公里", "km"],
  ["千克", "kg"],
  ["公斤", "kg"],
  ["分钟", "minutes"],
  ["美元", "USD"],
  ["美国", "United States"],
  ["欧盟", "European Union"],
  ["欧元区", "Euro area"],
  ["日本", "Japan"],
  ["德国", "Germany"],
  ["法国", "France"],
  ["英国", "United Kingdom"],
  ["意大利", "Italy"],
  ["加拿大", "Canada"],
  ["澳大利亚", "Australia"],
  ["韩国", "South Korea"],
  ["俄罗斯", "Russia"],
  ["俄罗斯联邦", "Russia"],
  ["印度", "India"],
  ["巴西", "Brazil"],
  ["南非", "South Africa"],
  ["印度尼西亚", "Indonesia"],
  ["墨西哥", "Mexico"],
  ["土耳其", "Turkey"],
  ["沙特阿拉伯", "Saudi Arabia"],
  ["阿根廷", "Argentina"],
  ["中国", "China"],
  ["新加坡", "Singapore"],
  ["马来西亚", "Malaysia"],
  ["泰国", "Thailand"],
  ["越南", "Vietnam"],
  ["菲律宾", "Philippines"],
  ["荷兰", "Netherlands"],
  ["西班牙", "Spain"],
  ["瑞士", "Switzerland"],
  ["瑞典", "Sweden"],
  ["波兰", "Poland"],
  ["埃及", "Egypt"],
  ["尼日利亚", "Nigeria"],
  ["巴基斯坦", "Pakistan"],
  ["伊朗", "Iran"],
  ["以色列", "Israel"],
  ["新西兰", "New Zealand"],
  ["挪威", "Norway"],
  ["丹麦", "Denmark"],
  ["芬兰", "Finland"],
  ["比利时", "Belgium"],
  ["奥地利", "Austria"],
  ["爱尔兰", "Ireland"],
  ["葡萄牙", "Portugal"],
  ["希腊", "Greece"],
  ["捷克", "Czechia"],
  ["匈牙利", "Hungary"],
  ["智利", "Chile"],
  ["哥伦比亚", "Colombia"],
  ["秘鲁", "Peru"],
  ["委内瑞拉", "Venezuela"],
  ["乌克兰", "Ukraine"],
  ["哈萨克斯坦", "Kazakhstan"],
  ["蒙古", "Mongolia"],
  ["朝鲜", "North Korea"],
  ["孟加拉国", "Bangladesh"],
  ["斯里兰卡", "Sri Lanka"],
  ["缅甸", "Myanmar"],
  ["柬埔寨", "Cambodia"],
  ["文莱", "Brunei"],
  ["老挝", "Laos"],
  ["尼泊尔", "Nepal"],
  ["阿联酋", "United Arab Emirates"],
  ["卡塔尔", "Qatar"],
  ["科威特", "Kuwait"],
  ["伊拉克", "Iraq"],
  ["阿尔及利亚", "Algeria"],
  ["摩洛哥", "Morocco"],
  ["肯尼亚", "Kenya"],
  ["埃塞俄比亚", "Ethiopia"],
  ["加纳", "Ghana"],
  ["坦桑尼亚", "Tanzania"],
  ["罗马尼亚", "Romania"],
  ["保加利亚", "Bulgaria"],
  ["斯洛伐克", "Slovakia"],
  ["斯洛文尼亚", "Slovenia"],
  ["克罗地亚", "Croatia"],
  ["立陶宛", "Lithuania"],
  ["拉脱维亚", "Latvia"],
  ["爱沙尼亚", "Estonia"],
  ["卢森堡", "Luxembourg"],
  ["冰岛", "Iceland"],
  ["古巴", "Cuba"],
  ["乌拉圭", "Uruguay"],
  ["玻利维亚", "Bolivia"],
  ["厄瓜多尔", "Ecuador"],
  ["巴拉圭", "Paraguay"],
  ["世界", "World"],
  ["中国香港", "Hong Kong"],
  ["中国澳门", "Macao"],
  ["中国台湾", "Taiwan"],
  ["香港", "Hong Kong"],
  ["澳门", "Macao"],
  ["台湾", "Taiwan"],
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
  return segmentGlossDetailed(base).text;
}

/** The segmentation, and whether any of it had to be romanised because the dictionary could not render it. */
function segmentGlossDetailed(base: string): { text: string; romanised: boolean } {
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
  // What the dictionary cannot render is romanised rather than left in
  // Chinese, so an English title never carries characters a reader of
  // English cannot read; the Chinese title beside it stays authoritative.
  const romanised = out.some((piece) => /[\u4e00-\u9fff]/.test(piece));
  return { text: out.map((piece) => (/[\u4e00-\u9fff]/.test(piece) ? romanise(piece) : piece)).join(" ").replace(/\s+,/g, ",").replace(/\s+/g, " ").trim(), romanised };
}

/** "日照" -> "Rizhao": pinyin without tones, capitalised, digits and Latin kept. */
function romanise(text: string): string {
  return text.replace(/[\u4e00-\u9fff]+/g, (run) => { const py = toPinyin(run).replace(/\s+/g, ""); return py.charAt(0).toUpperCase() + py.slice(1); });
}

/** The English gloss for a title, or "" when nothing at all could be rendered. */
export function glossTitle(name: string): string {
  return glossTitleDetailed(name).text;
}

/**
 * The gloss, and whether it is fit to be a title. A gloss that had to
 * romanise part of the name ("Guojishichang energy price index" for
 * 国际市场能源价格指数) is not English a reader can use: it still helps search,
 * where pinyin is a way in, but as a title the Chinese name is better.
 */
export function glossTitleDetailed(name: string): { text: string; romanised: boolean } {
  const parts = splitTitle(name);
  const known = table ?? {};
  const translated = known[parts.base];
  const segmented = translated ? null : segmentGlossDetailed(parts.base);
  const romanised = segmented?.romanised ?? false;
  const glossed = normalizeIndexPrefix(translated ?? segmented?.text ?? "");
  // A few national-accounts glosses carry the base inside their text, "(same period last year=100)";
  // the base belongs last, in the site's own words, derived from the title when the unit field has none.
  const baseEn = glossed.replace(/\s*\([^()]*=\s*100\)\s*/, " ").replace(/\s+,/g, ",").trim();
  if (!baseEn) return { text: "", romanised };
  const measureEn = MEASURES.find(([zh]) => zh === parts.measure)?.[1] ?? "";
  // The base comes from the unit, else from the name when the gloss or the Chinese base concept names one.
  const base = baseOf(parts.unit) || (/=\s*100/.test(glossed) || /=\s*100/.test(parts.base) ? baseOf(name) : "");
  const head = [baseEn, measureEn, base].filter(Boolean).join(", ");
  return { text: head.charAt(0).toUpperCase() + head.slice(1), romanised };
}

/**
 * The gloss table names index components both ways, "PPI, food" and
 * "PPI: clothing"; the colon form is the convention, so the comma form is
 * folded into it here rather than by hand across 155 table entries.
 */
export function normalizeIndexPrefix(title: string): string {
  const abbreviations: Record<string, string> = { "producer price index": "PPI", "consumer price index": "CPI", "retail price index": "RPI" };
  let out = title;
  // The suffix form, "Non-metallic mineral products: producer price index", folds to "PPI: non-metallic
  // mineral products"; the urban and rural variants keep their word in front.
  const suffix = out.match(/^(.+?):\s*((?:urban |rural )?)(producer price index|consumer price index|retail price index)\s*$/i);
  if (suffix) {
    const scope = suffix[2] ?? "", index = suffix[3] ?? "", component = suffix[1] ?? "";
    out = `${scope ? `${scope.charAt(0).toUpperCase()}${scope.slice(1).toLowerCase()}` : ""}${abbreviations[index.toLowerCase()] ?? index}: ${component}`;
  }
  out = out
    .replace(/^(CPI|PPI|RPI|PMI),\s+/, "$1: ")
    // The spelled-out forms fold the same way when a component follows: "Producer price index for tea",
    // "Producer price index, electricity supply" and "Urban retail price index: clothing" read "PPI: tea",
    // "PPI: electricity supply", "Urban RPI: clothing". A bare "Consumer price index" is the headline and stays.
    .replace(/^((?:Urban |Rural )?)Producer price index(?:\s+for|\s+of|,|:)\s+(?=\S)/i, "$1PPI: ")
    .replace(/^((?:Urban |Rural )?)Consumer price index(?:\s+for|\s+of|,|:)\s+(?=\S)/i, "$1CPI: ")
    .replace(/^((?:Urban |Rural )?)Retail price index(?:\s+for|\s+of|,|:)\s+(?=\S)/i, "$1RPI: ");
  // What follows the colon reads in lowercase, whether the prefix is an index ("CPI: transport and
  // communication") or an industry ("Leather, fur, feather (down) and related products: value added"):
  // the gloss table capitalised a few hundred industry measures. A proper adjective or an acronym keeps
  // its case.
  return out.replace(/^([^:]+: )([A-Z])([a-z]+)\b/, (whole, prefix: string, first: string, rest: string) =>
    `${first}${rest}` === "Chinese" ? whole : `${prefix}${first.toLowerCase()}${rest}`);
}

/**
 * Year ranges in the site's own words. The translated category labels wrote
 * "(–2023)" and "(2024–)" with an en dash, where the rest of the catalog reads
 * "(to 2018)" and "(2018-present)"; a dash between numbers reads as a hyphen,
 * "0.2-0.5 kg".
 */
export function plainRanges(text: string): string {
  return text
    .replace(/\(\s*[–—]\s*(\d{4})\s*\)/g, "(to $1)")
    .replace(/\(\s*(\d{4})\s*[–—]\s*\)/g, "($1-present)")
    .replace(/(\d)\s*[–—]\s*(?=\d)/g, "$1-");
}

/** An index title's base period, "(上月=100)", is part of what the series is, so it stays in the English title. */
function baseOf(unit: string): string {
  if (!/=\s*100/.test(unit)) return "";
  // A fixed base year says which: "(2010=100)" reads "2010 = 100", not "base period = 100".
  const year = unit.match(/(\d{4})\s*=\s*100/);
  if (year) return `${year[1]} = 100`;
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
