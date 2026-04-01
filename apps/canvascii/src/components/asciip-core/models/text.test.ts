import { describe, expect, it } from "vitest";
import {
  applyIndentationOnTab,
  applyListContinuationOnEnter,
  toggleCheckboxAtIndex,
} from "./text";

describe("applyListContinuationOnEnter", () => {
  it("continues checkbox list items without dropping the checkbox marker", () => {
    const input = "[ ] first";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("[ ] first\n[ ] ");
  });

  it("continues dashed checkbox list items as checkbox list items", () => {
    const input = "- [x] done";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("- [x] done\n- [ ] ");
  });

  it("normalizes [] into [ ] when continuing a checkbox list", () => {
    const input = "[] todo";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("[ ] todo\n[ ] ");
  });

  it("exits list mode when enter is pressed on an empty bullet item", () => {
    const input = "- item\n- ";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("- item\n");
  });

  it("exits checklist mode when enter is pressed on an empty checkbox item", () => {
    const input = "[ ] task\n[ ] ";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("[ ] task\n");
  });

  it("continues nested dashed bullet items with indentation intact", () => {
    const input = "  - child";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("  - child\n  - ");
  });

  it("continues star bullet items with indentation intact", () => {
    const input = "    * item";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("    * item\n    * ");
  });

  it("continues alphabetic ordered lists", () => {
    const input = "a. first";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("a. first\nb. ");
  });

  it("continues nested alphabetic ordered lists", () => {
    const input = "  a. child";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("  a. child\n  b. ");
  });

  it("continues a top-level ordered list after nested ordered children", () => {
    const input = "1. this\n  a. this\n2. ";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("1. this\n  a. this\n");
  });

  it("continues roman numeral ordered lists", () => {
    const input = "i. first";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("i. first\nii. ");
  });

  it("continues uppercase roman numeral ordered lists", () => {
    const input = "I. first";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("I. first\nII. ");
  });

  it("renumbers following alphabetic ordered list items after inserting a new item", () => {
    const input = "a. first\nb. second";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("a. first\nb. second\nc. ");
  });

  it("exits alphabetic list mode on an empty item", () => {
    const input = "a. first\nb. ";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("a. first\n");
  });

  it("exits roman numeral list mode on an empty item and renumbers followers", () => {
    const input = "i. first\nii. \niii. third";
    const result = applyListContinuationOnEnter(input, "i. first\nii. ".length, "i. first\nii. ".length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("i. first\nii. third");
  });
});

describe("toggleCheckboxAtIndex", () => {
  it("toggles a plain checkbox when clicking inside the brackets", () => {
    expect(toggleCheckboxAtIndex("[ ] task", 1)).toBe("[x] task");
    expect(toggleCheckboxAtIndex("[x] task", 1)).toBe("[ ] task");
  });

  it("normalizes [] before toggling dashed checkboxes", () => {
    expect(toggleCheckboxAtIndex("- [] task", 3)).toBe("- [x] task");
  });
});

describe("applyIndentationOnTab", () => {
  it("inserts spaces at the caret when there is no selection", () => {
    const result = applyIndentationOnTab("Hello", 2, 2);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("He  llo");
    expect(result.nextSelectionStart).toBe(4);
    expect(result.nextSelectionEnd).toBe(4);
  });

  it("indents every selected line", () => {
    const input = "alpha\nbeta";
    const result = applyIndentationOnTab(input, 0, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("  alpha\n  beta");
    expect(result.nextSelectionStart).toBe(2);
    expect(result.nextSelectionEnd).toBe(input.length + 4);
  });

  it("outdents every selected line up to two spaces", () => {
    const input = "  alpha\n  beta";
    const result = applyIndentationOnTab(input, 2, input.length, {
      outdent: true,
    });

    expect(result.handled).toBe(true);
    expect(result.value).toBe("alpha\nbeta");
    expect(result.nextSelectionStart).toBe(0);
    expect(result.nextSelectionEnd).toBe(input.length - 4);
  });

  it("outdents the current line without losing focus when there is no removable indent", () => {
    const input = "alpha";
    const result = applyIndentationOnTab(input, 3, 3, {
      outdent: true,
    });

    expect(result.handled).toBe(true);
    expect(result.value).toBe(input);
    expect(result.nextSelectionStart).toBe(3);
    expect(result.nextSelectionEnd).toBe(3);
  });

  it("indents a bullet line structurally when tab is pressed inside the item text", () => {
    const input = "- item";
    const result = applyIndentationOnTab(input, 4, 4);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("  - item");
    expect(result.nextSelectionStart).toBe(6);
    expect(result.nextSelectionEnd).toBe(6);
  });

  it("outdents a nested bullet line structurally when shift-tab is pressed inside the item text", () => {
    const input = "  - item";
    const result = applyIndentationOnTab(input, 6, 6, {
      outdent: true,
    });

    expect(result.handled).toBe(true);
    expect(result.value).toBe("- item");
    expect(result.nextSelectionStart).toBe(4);
    expect(result.nextSelectionEnd).toBe(4);
  });

  it("does not insert extra spaces before a bullet marker when tabbing repeatedly", () => {
    const first = applyIndentationOnTab("- item", 4, 4);
    const second = applyIndentationOnTab(first.value, first.nextSelectionStart, first.nextSelectionEnd);

    expect(first.value).toBe("  - item");
    expect(second.value).toBe("  - item");
    expect(second.value.startsWith("  -")).toBe(true);
    expect(second.value.startsWith("   -")).toBe(false);
  });

  it("keeps checkbox state when structurally indenting a checkbox list item", () => {
    const input = "- [x] done";
    const result = applyIndentationOnTab(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("  - [x] done");
  });

  it("indents an empty continuation bullet under the previous sibling", () => {
    const input = "- item\n- ";
    const result = applyIndentationOnTab(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("- item\n  - ");
    expect(result.nextSelectionStart).toBe(input.length + 2);
    expect(result.nextSelectionEnd).toBe(input.length + 2);
  });

  it("allows indenting a leaf bullet item once at the root level", () => {
    const input = "- item";
    const result = applyIndentationOnTab(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("  - item");
  });

  it("converts a nested numeric ordered item into alphabetic numbering", () => {
    const input = "1. this\n1. ";
    const result = applyIndentationOnTab(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("1. this\n  a. ");
  });

  it("continues top-level ordered numbering after nested ordered children", () => {
    const input = "1. this\n  a. this\n1. ";
    const result = applyListContinuationOnEnter(input, input.length, input.length);

    expect(result.handled).toBe(true);
    expect(result.value).toBe("1. this\n  a. this\n");
  });

  it("creates the next top-level ordered item after a nested ordered child", () => {
    const input = "1. this\n  a. this";
    const result = applyListContinuationOnEnter(input, input.length, input.length);
    const nested = applyListContinuationOnEnter(
      result.value,
      result.nextSelectionStart,
      result.nextSelectionStart
    );

    expect(result.handled).toBe(true);
    expect(result.value).toBe("1. this\n  a. this\n  b. ");
    expect(nested.handled).toBe(true);
    expect(nested.value).toBe("1. this\n  a. this\n2. ");
  });
});
