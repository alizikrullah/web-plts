import { expect, it } from "vitest"
import { liveFormat, parseNum } from "../../../shared/format"

// ketik satu per satu di posisi kursor, seperti user di HP
const type = (keys: string, dotIsDecimal: boolean) => {
  let value = "", caret = 0
  for (const k of keys) ({ value, caret } = liveFormat(value.slice(0, caret) + k + value.slice(caret), caret + 1, dotIsDecimal))
  return value
}

it("kolom ribuan: titik manual tetap ribuan, koma tetap desimal", () => {
  expect(type("1.500", false)).toBe("1.500")
  expect(type("5000000", false)).toBe("5.000.000")
  expect(parseNum(type("1.444,70", false))).toBe(1444.7)
})

it("kolom kecil: titik dari keypad HP jadi koma desimal", () => {
  expect(type("25.6", true)).toBe("25,6")
  expect(parseNum(type("0.5", true))).toBe(0.5)
})

it("parseNum membaca format Indonesia dan titik desimal", () => {
  expect(parseNum("1.500")).toBe(1500)
  expect(parseNum("25.6")).toBe(25.6)
  expect(parseNum("Rp 1.444,70")).toBe(1444.7)
  expect(parseNum("")).toBe(0)
})
