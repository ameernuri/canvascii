import { describe, expect, it } from "vitest";
import {
  getRectangleBorderLabelCellValueMap,
  getRectangleLabelCellValueMap,
} from "./rectangleText";
import type { Rectangle } from "./shapes";

describe("getRectangleLabelCellValueMap", () => {
  it("renders rectangle body text inside the box body", () => {
    const rectangle: Rectangle = {
      type: "RECTANGLE",
      tl: { r: 2, c: 4 },
      br: { r: 8, c: 20 },
      labelLines: ["label here"],
    };

    const map = getRectangleLabelCellValueMap(rectangle, ["label here"], {
      alignH: "LEFT",
      alignV: "TOP",
      overflow: "TRUNCATE",
      padding: 1,
    });

    expect(map[4]?.[6]).toBe("l");
    expect(map[4]?.[15]).toBe("e");
  });

  it("renders a separate border label on the top edge", () => {
    const rectangle: Rectangle = {
      type: "RECTANGLE",
      tl: { r: 2, c: 4 },
      br: { r: 8, c: 20 },
      label: "label here",
    };

    const map = getRectangleBorderLabelCellValueMap(rectangle, rectangle.label);

    expect(map[2]?.[6]).toBe("l");
    expect(map[2]?.[15]).toBe("e");
  });
});
