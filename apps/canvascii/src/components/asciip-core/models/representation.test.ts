import { describe, expect, it } from "vitest";
import { defaultStyle } from "./style";
import { getStyledShapeRepresentation } from "./representation";

describe("getStyledShapeRepresentation", () => {
  it("renders block-border rectangles with inward-facing half-block borders", () => {
    const repr = getStyledShapeRepresentation(
      {
        type: "RECTANGLE",
        tl: { r: 2, c: 4 },
        br: { r: 4, c: 7 },
      },
      "UNICODE",
      defaultStyle(),
      {
        rectangleBorder: "BLOCK",
        rectangleFill: "NONE",
      },
    );

    expect(repr[2]?.[4]).toBe("▗");
    expect(repr[2]?.[5]).toBe("▄");
    expect(repr[2]?.[7]).toBe("▖");
    expect(repr[3]?.[4]).toBe("▐");
    expect(repr[3]?.[7]).toBe("▌");
    expect(repr[4]?.[4]).toBe("▝");
    expect(repr[4]?.[5]).toBe("▀");
    expect(repr[4]?.[7]).toBe("▘");
  });
});
