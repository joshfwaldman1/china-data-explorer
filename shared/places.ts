/**
 * Place names, shared by the server and the browser.
 *
 * The bureau labels a region in Chinese and identifies it by a GB/T 2260 code
 * padded to twelve digits. The site shows an English name where one exists, so
 * the mapping has to be in one file rather than repeated in the tile map, the
 * region picker and the download. Nothing here imports anything: the browser
 * bundle and the server both read it.
 */

export interface Place {
  /** NBS `das` code, twelve digits. Empty for a place NBS identifies another way. */
  code: string;
  zh: string;
  en: string;
  /** Short form for the tile map. */
  abbr?: string;
}

/** The 31 mainland province-level divisions NBS publishes regional data for. */
export const PROVINCE_PLACES: Place[] = [
  { code: "230000000000", zh: "黑龙江", en: "Heilongjiang", abbr: "HLJ" },
  { code: "650000000000", zh: "新疆", en: "Xinjiang", abbr: "XJ" },
  { code: "150000000000", zh: "内蒙古", en: "Inner Mongolia", abbr: "NMG" },
  { code: "220000000000", zh: "吉林", en: "Jilin", abbr: "JL" },
  { code: "620000000000", zh: "甘肃", en: "Gansu", abbr: "GS" },
  { code: "640000000000", zh: "宁夏", en: "Ningxia", abbr: "NX" },
  { code: "110000000000", zh: "北京", en: "Beijing", abbr: "BJ" },
  { code: "120000000000", zh: "天津", en: "Tianjin", abbr: "TJ" },
  { code: "210000000000", zh: "辽宁", en: "Liaoning", abbr: "LN" },
  { code: "630000000000", zh: "青海", en: "Qinghai", abbr: "QH" },
  { code: "610000000000", zh: "陕西", en: "Shaanxi", abbr: "SAX" },
  { code: "140000000000", zh: "山西", en: "Shanxi", abbr: "SX" },
  { code: "130000000000", zh: "河北", en: "Hebei", abbr: "HEB" },
  { code: "370000000000", zh: "山东", en: "Shandong", abbr: "SD" },
  { code: "540000000000", zh: "西藏", en: "Tibet", abbr: "XZ" },
  { code: "510000000000", zh: "四川", en: "Sichuan", abbr: "SC" },
  { code: "410000000000", zh: "河南", en: "Henan", abbr: "HEN" },
  { code: "320000000000", zh: "江苏", en: "Jiangsu", abbr: "JS" },
  { code: "310000000000", zh: "上海", en: "Shanghai", abbr: "SH" },
  { code: "500000000000", zh: "重庆", en: "Chongqing", abbr: "CQ" },
  { code: "420000000000", zh: "湖北", en: "Hubei", abbr: "HUB" },
  { code: "340000000000", zh: "安徽", en: "Anhui", abbr: "AH" },
  { code: "330000000000", zh: "浙江", en: "Zhejiang", abbr: "ZJ" },
  { code: "530000000000", zh: "云南", en: "Yunnan", abbr: "YN" },
  { code: "520000000000", zh: "贵州", en: "Guizhou", abbr: "GZ" },
  { code: "430000000000", zh: "湖南", en: "Hunan", abbr: "HUN" },
  { code: "360000000000", zh: "江西", en: "Jiangxi", abbr: "JX" },
  { code: "350000000000", zh: "福建", en: "Fujian", abbr: "FJ" },
  { code: "450000000000", zh: "广西", en: "Guangxi", abbr: "GX" },
  { code: "440000000000", zh: "广东", en: "Guangdong", abbr: "GD" },
  { code: "460000000000", zh: "海南", en: "Hainan", abbr: "HI" },
];

/**
 * The large and medium cities in the bureau's monthly price surveys. Keyed by
 * the Chinese name because the city tables identify a city by name, and the
 * curated house-price series identifies it by slug.
 */
export const CITY_PLACES: Place[] = [
  { code: "540100000000", zh: "拉萨", en: "Lhasa" },
  { code: "", zh: "北京", en: "Beijing" },
  { code: "", zh: "天津", en: "Tianjin" },
  { code: "", zh: "石家庄", en: "Shijiazhuang" },
  { code: "", zh: "太原", en: "Taiyuan" },
  { code: "", zh: "呼和浩特", en: "Hohhot" },
  { code: "", zh: "沈阳", en: "Shenyang" },
  { code: "", zh: "大连", en: "Dalian" },
  { code: "", zh: "长春", en: "Changchun" },
  { code: "", zh: "哈尔滨", en: "Harbin" },
  { code: "", zh: "上海", en: "Shanghai" },
  { code: "", zh: "南京", en: "Nanjing" },
  { code: "", zh: "杭州", en: "Hangzhou" },
  { code: "", zh: "宁波", en: "Ningbo" },
  { code: "", zh: "合肥", en: "Hefei" },
  { code: "", zh: "福州", en: "Fuzhou" },
  { code: "", zh: "厦门", en: "Xiamen" },
  { code: "", zh: "南昌", en: "Nanchang" },
  { code: "", zh: "济南", en: "Jinan" },
  { code: "", zh: "青岛", en: "Qingdao" },
  { code: "", zh: "郑州", en: "Zhengzhou" },
  { code: "", zh: "武汉", en: "Wuhan" },
  { code: "", zh: "长沙", en: "Changsha" },
  { code: "", zh: "广州", en: "Guangzhou" },
  { code: "", zh: "深圳", en: "Shenzhen" },
  { code: "", zh: "南宁", en: "Nanning" },
  { code: "", zh: "海口", en: "Haikou" },
  { code: "", zh: "重庆", en: "Chongqing" },
  { code: "", zh: "成都", en: "Chengdu" },
  { code: "", zh: "贵阳", en: "Guiyang" },
  { code: "", zh: "昆明", en: "Kunming" },
  { code: "", zh: "西安", en: "Xi'an" },
  { code: "", zh: "兰州", en: "Lanzhou" },
  { code: "", zh: "西宁", en: "Xining" },
  { code: "", zh: "银川", en: "Yinchuan" },
  { code: "", zh: "乌鲁木齐", en: "Urumqi" },
  { code: "", zh: "唐山", en: "Tangshan" },
  { code: "", zh: "秦皇岛", en: "Qinhuangdao" },
  { code: "", zh: "包头", en: "Baotou" },
  { code: "", zh: "丹东", en: "Dandong" },
  { code: "", zh: "锦州", en: "Jinzhou" },
  { code: "", zh: "吉林", en: "Jilin" },
  { code: "", zh: "牡丹江", en: "Mudanjiang" },
  { code: "", zh: "无锡", en: "Wuxi" },
  { code: "", zh: "扬州", en: "Yangzhou" },
  { code: "", zh: "徐州", en: "Xuzhou" },
  { code: "", zh: "温州", en: "Wenzhou" },
  { code: "", zh: "金华", en: "Jinhua" },
  { code: "", zh: "蚌埠", en: "Bengbu" },
  { code: "", zh: "安庆", en: "Anqing" },
  { code: "", zh: "泉州", en: "Quanzhou" },
  { code: "", zh: "九江", en: "Jiujiang" },
  { code: "", zh: "赣州", en: "Ganzhou" },
  { code: "", zh: "烟台", en: "Yantai" },
  { code: "", zh: "济宁", en: "Jining" },
  { code: "", zh: "洛阳", en: "Luoyang" },
  { code: "", zh: "平顶山", en: "Pingdingshan" },
  { code: "", zh: "宜昌", en: "Yichang" },
  { code: "", zh: "襄阳", en: "Xiangyang" },
  { code: "", zh: "岳阳", en: "Yueyang" },
  { code: "", zh: "常德", en: "Changde" },
  { code: "", zh: "惠州", en: "Huizhou" },
  { code: "", zh: "湛江", en: "Zhanjiang" },
  { code: "", zh: "韶关", en: "Shaoguan" },
  { code: "", zh: "桂林", en: "Guilin" },
  { code: "", zh: "北海", en: "Beihai" },
  { code: "", zh: "三亚", en: "Sanya" },
  { code: "", zh: "泸州", en: "Luzhou" },
  { code: "", zh: "南充", en: "Nanchong" },
  { code: "", zh: "遵义", en: "Zunyi" },
  { code: "", zh: "大理", en: "Dali" },
];

/** Hong Kong, Macao and Taiwan, as NBS names them in its regional tables. */
export const HMT_PLACES: Place[] = [
  { code: "810000000000", zh: "香港特别行政区", en: "Hong Kong" },
  { code: "820000000000", zh: "澳门特别行政区", en: "Macao" },
  { code: "710000000000", zh: "台湾省", en: "Taiwan" },
  { code: "", zh: "中国香港", en: "Hong Kong" },
  { code: "", zh: "中国澳门", en: "Macao" },
  { code: "", zh: "中国台湾", en: "Taiwan" },
];

/**
 * Countries and economies of the bureau's international tables, by the names
 * the portal uses. These carry no NBS code, so they are matched by name.
 */
export const COUNTRY_PLACES: Place[] = [
  { code: "", zh: "美国", en: "United States" },
  { code: "", zh: "欧盟", en: "European Union" },
  { code: "", zh: "欧元区", en: "Euro area" },
  { code: "", zh: "日本", en: "Japan" },
  { code: "", zh: "德国", en: "Germany" },
  { code: "", zh: "法国", en: "France" },
  { code: "", zh: "英国", en: "United Kingdom" },
  { code: "", zh: "意大利", en: "Italy" },
  { code: "", zh: "加拿大", en: "Canada" },
  { code: "", zh: "澳大利亚", en: "Australia" },
  { code: "", zh: "韩国", en: "South Korea" },
  { code: "", zh: "俄罗斯", en: "Russia" },
  { code: "", zh: "俄罗斯联邦", en: "Russia" },
  { code: "", zh: "印度", en: "India" },
  { code: "", zh: "巴西", en: "Brazil" },
  { code: "", zh: "南非", en: "South Africa" },
  { code: "", zh: "印度尼西亚", en: "Indonesia" },
  { code: "", zh: "墨西哥", en: "Mexico" },
  { code: "", zh: "土耳其", en: "Turkey" },
  { code: "", zh: "沙特阿拉伯", en: "Saudi Arabia" },
  { code: "", zh: "阿根廷", en: "Argentina" },
  { code: "", zh: "中国", en: "China" },
  { code: "", zh: "新加坡", en: "Singapore" },
  { code: "", zh: "马来西亚", en: "Malaysia" },
  { code: "", zh: "泰国", en: "Thailand" },
  { code: "", zh: "越南", en: "Vietnam" },
  { code: "", zh: "菲律宾", en: "Philippines" },
  { code: "", zh: "荷兰", en: "Netherlands" },
  { code: "", zh: "西班牙", en: "Spain" },
  { code: "", zh: "瑞士", en: "Switzerland" },
  { code: "", zh: "瑞典", en: "Sweden" },
  { code: "", zh: "波兰", en: "Poland" },
  { code: "", zh: "埃及", en: "Egypt" },
  { code: "", zh: "尼日利亚", en: "Nigeria" },
  { code: "", zh: "巴基斯坦", en: "Pakistan" },
  { code: "", zh: "伊朗", en: "Iran" },
  { code: "", zh: "以色列", en: "Israel" },
  { code: "", zh: "新西兰", en: "New Zealand" },
  { code: "", zh: "挪威", en: "Norway" },
  { code: "", zh: "丹麦", en: "Denmark" },
  { code: "", zh: "芬兰", en: "Finland" },
  { code: "", zh: "比利时", en: "Belgium" },
  { code: "", zh: "奥地利", en: "Austria" },
  { code: "", zh: "爱尔兰", en: "Ireland" },
  { code: "", zh: "葡萄牙", en: "Portugal" },
  { code: "", zh: "希腊", en: "Greece" },
  { code: "", zh: "捷克", en: "Czechia" },
  { code: "", zh: "匈牙利", en: "Hungary" },
  { code: "", zh: "智利", en: "Chile" },
  { code: "", zh: "哥伦比亚", en: "Colombia" },
  { code: "", zh: "秘鲁", en: "Peru" },
  { code: "", zh: "委内瑞拉", en: "Venezuela" },
  { code: "", zh: "乌克兰", en: "Ukraine" },
  { code: "", zh: "哈萨克斯坦", en: "Kazakhstan" },
  { code: "", zh: "蒙古", en: "Mongolia" },
  { code: "", zh: "朝鲜", en: "North Korea" },
  { code: "", zh: "孟加拉国", en: "Bangladesh" },
  { code: "", zh: "斯里兰卡", en: "Sri Lanka" },
  { code: "", zh: "缅甸", en: "Myanmar" },
  { code: "", zh: "柬埔寨", en: "Cambodia" },
  { code: "", zh: "文莱", en: "Brunei" },
  { code: "", zh: "老挝", en: "Laos" },
  { code: "", zh: "尼泊尔", en: "Nepal" },
  { code: "", zh: "阿联酋", en: "United Arab Emirates" },
  { code: "", zh: "卡塔尔", en: "Qatar" },
  { code: "", zh: "科威特", en: "Kuwait" },
  { code: "", zh: "伊拉克", en: "Iraq" },
  { code: "", zh: "阿尔及利亚", en: "Algeria" },
  { code: "", zh: "摩洛哥", en: "Morocco" },
  { code: "", zh: "肯尼亚", en: "Kenya" },
  { code: "", zh: "埃塞俄比亚", en: "Ethiopia" },
  { code: "", zh: "加纳", en: "Ghana" },
  { code: "", zh: "坦桑尼亚", en: "Tanzania" },
  { code: "", zh: "罗马尼亚", en: "Romania" },
  { code: "", zh: "保加利亚", en: "Bulgaria" },
  { code: "", zh: "斯洛伐克", en: "Slovakia" },
  { code: "", zh: "斯洛文尼亚", en: "Slovenia" },
  { code: "", zh: "克罗地亚", en: "Croatia" },
  { code: "", zh: "立陶宛", en: "Lithuania" },
  { code: "", zh: "拉脱维亚", en: "Latvia" },
  { code: "", zh: "爱沙尼亚", en: "Estonia" },
  { code: "", zh: "卢森堡", en: "Luxembourg" },
  { code: "", zh: "冰岛", en: "Iceland" },
  { code: "", zh: "古巴", en: "Cuba" },
  { code: "", zh: "乌拉圭", en: "Uruguay" },
  { code: "", zh: "玻利维亚", en: "Bolivia" },
  { code: "", zh: "厄瓜多尔", en: "Ecuador" },
  { code: "", zh: "巴拉圭", en: "Paraguay" },
  { code: "", zh: "世界", en: "World" },
  { code: "", zh: "中国香港", en: "Hong Kong" },
  { code: "", zh: "中国澳门", en: "Macao" },
  { code: "", zh: "中国台湾", en: "Taiwan" },
  { code: "", zh: "香港", en: "Hong Kong" },
  { code: "", zh: "澳门", en: "Macao" },
  { code: "", zh: "台湾", en: "Taiwan" },
];

const byCode = new Map<string, Place>();
const byName = new Map<string, Place>();
for (const place of [...PROVINCE_PLACES, ...CITY_PLACES, ...HMT_PLACES, ...COUNTRY_PLACES]) {
  if (place.code && !byCode.has(place.code)) byCode.set(place.code, place);
  if (!byName.has(place.zh)) byName.set(place.zh, place);
}

/**
 * The English name for one NBS region, by its code or its Chinese label.
 *
 * City tables write a city as 北京 where the province tables write 北京市, so
 * a name is tried both as given and without the administrative suffix.
 */
export function englishPlace(code: string, zh: string): string | undefined {
  const known = (code && byCode.get(code)) || byName.get(zh) || byName.get(zh.replace(/[市省]$/, ""));
  return known?.en;
}

/**
 * The place a search query names, if it names one: "guangdong gdp" is a query
 * about Guangdong, "shenzhen house prices" one about Shenzhen. Returns the
 * place and the query with that name taken out, so the rest can be searched as
 * an ordinary subject.
 *
 * English names match on a word boundary and Chinese names anywhere, which is
 * how the rest of the site's search treats the two scripts. The longest name
 * wins, so "inner mongolia" is not read as a query about Mongolia, and a query
 * that is nothing but a place name keeps its text: someone typing "Guangdong"
 * alone wants the province's series, not everything.
 */
export function findPlaceInQuery(query: string): { place: Place; kind: "Province" | "City"; rest: string } | undefined {
  const text = query.toLowerCase();
  let best: { place: Place; kind: "Province" | "City"; rest: string; length: number } | undefined;
  const consider = (place: Place, kind: "Province" | "City", index: number, length: number) => {
    if (best && best.length >= length) return;
    const rest = `${query.slice(0, index)} ${query.slice(index + length)}`.replace(/\s+/g, " ").trim();
    best = { place, kind, rest: rest || query, length };
  };
  for (const [places, kind] of [[PROVINCE_PLACES, "Province"], [CITY_PLACES, "City"]] as const) {
    for (const place of places) {
      const english = place.en.toLowerCase();
      const at = text.indexOf(english);
      const before = at <= 0 ? "" : text[at - 1] ?? "";
      const after = at < 0 ? "" : text[at + english.length] ?? "";
      if (at >= 0 && !/[a-z]/.test(before) && !/[a-z]/.test(after)) consider(place, kind, at, english.length);
      const chinese = query.indexOf(place.zh);
      if (chinese >= 0) consider(place, kind, chinese, place.zh.length);
    }
  }
  return best ? { place: best.place, kind: best.kind, rest: best.rest } : undefined;
}

/**
 * A query that asks for a geography rather than a place: "population by
 * province", "city house prices", "provincial gdp". The bureau publishes these
 * as whole datasets, so the phrase is a filter, not a subject — searched as a
 * subject it matches nothing, because no title contains the words "by
 * province".
 *
 * Returns the geography and the query with the phrase removed. A query that is
 * nothing but the phrase keeps its text, so "by province" alone still searches.
 */
const GEOGRAPHY_PHRASES: { phrase: string; geography: "Province" | "City" }[] = [
  { phrase: "by province", geography: "Province" },
  { phrase: "by provinces", geography: "Province" },
  { phrase: "per province", geography: "Province" },
  { phrase: "by region", geography: "Province" },
  { phrase: "provincial", geography: "Province" },
  { phrase: "分省", geography: "Province" },
  { phrase: "各省", geography: "Province" },
  { phrase: "by city", geography: "City" },
  { phrase: "by cities", geography: "City" },
  { phrase: "per city", geography: "City" },
  { phrase: "分城市", geography: "City" },
  { phrase: "各城市", geography: "City" },
];

export function findGeographyInQuery(query: string): { geography: "Province" | "City"; rest: string } | undefined {
  const lower = query.toLowerCase();
  for (const { phrase, geography } of GEOGRAPHY_PHRASES) {
    const at = lower.indexOf(phrase);
    if (at < 0) continue;
    const before = at === 0 ? "" : lower[at - 1] ?? "";
    const after = lower[at + phrase.length] ?? "";
    // A word boundary for the English phrases; the Chinese ones need none.
    if (/[a-z]/.test(before) || /[a-z]/.test(after)) continue;
    const rest = `${query.slice(0, at)} ${query.slice(at + phrase.length)}`.replace(/\s+/g, " ").trim();
    return { geography, rest: rest || query };
  }
  return undefined;
}
