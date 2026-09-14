/**
 * Reading a place out of a search query. A provincial series has no
 * per-province title — one indicator is published for 31 places — so "guangdong
 * gdp" only works if the province is taken out of the query and used as the
 * region instead.
 */

import { test, expect } from "bun:test";
import { findPlaceInQuery, englishPlace } from "../shared/places.ts";

test("a province in an English query is read as a place, and the subject survives", () => {
  const found = findPlaceInQuery("guangdong gdp");
  expect(found?.place.en).toBe("Guangdong");
  expect(found?.kind).toBe("Province");
  expect(found?.rest).toBe("gdp");
});

test("the longest place name wins, so Inner Mongolia is not read as Mongolia", () => {
  const found = findPlaceInQuery("inner mongolia population");
  expect(found?.place.en).toBe("Inner Mongolia");
  expect(found?.rest).toBe("population");
});

test("a Chinese province name is read the same way", () => {
  const found = findPlaceInQuery("广东 地区生产总值");
  expect(found?.place.en).toBe("Guangdong");
  expect(found?.rest).toBe("地区生产总值");
});

test("a city is read as a city, so the search goes to the city tables", () => {
  const found = findPlaceInQuery("shenzhen house prices");
  expect(found?.place.en).toBe("Shenzhen");
  expect(found?.kind).toBe("City");
  expect(found?.rest).toBe("house prices");
});

test("a query that is only a place name keeps its text, so it still searches", () => {
  const found = findPlaceInQuery("Guangdong");
  expect(found?.place.en).toBe("Guangdong");
  expect(found?.rest).toBe("Guangdong");
});

test("a place name inside a longer word is not a place", () => {
  // "Hebei" inside a made-up token, and a subject with no place at all.
  expect(findPlaceInQuery("hebeing")).toBeUndefined();
  expect(findPlaceInQuery("unemployment rate")).toBeUndefined();
});

test("region codes and Chinese labels resolve to English names", () => {
  expect(englishPlace("440000000000", "广东省")).toBe("Guangdong");
  // City tables write 北京 where province tables write 北京市.
  expect(englishPlace("110000000000", "北京")).toBe("Beijing");
  expect(englishPlace("", "石家庄")).toBe("Shijiazhuang");
  expect(englishPlace("", "某个不存在的地方")).toBeUndefined();
});
