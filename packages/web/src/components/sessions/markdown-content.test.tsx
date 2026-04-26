import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { MarkdownContent } from "./markdown-content";

describe("MarkdownContent", () => {
  it("renders plain paragraphs", () => {
    render(<MarkdownContent content="hello world" isUser={false} />);
    expect(screen.getByTestId("markdown-content").textContent).toContain(
      "hello world",
    );
  });

  it("renders fenced code block via fallback (shiki async)", () => {
    render(
      <MarkdownContent content={"```ts\nconst x = 1;\n```"} isUser={false} />,
    );
    const fallback = screen.getByTestId("md-code-fallback");
    expect(fallback.textContent).toContain("const x = 1;");
  });

  it("renders fenced code block without language", () => {
    render(
      <MarkdownContent content={"```\nhello\nworld\n```"} isUser={false} />,
    );
    expect(screen.getByTestId("md-code-fallback").textContent).toContain(
      "hello",
    );
  });

  it("renders inline code with muted styling for assistant", () => {
    render(<MarkdownContent content={"use `npm` here"} isUser={false} />);
    const root = screen.getByTestId("markdown-content");
    const code = root.querySelector("code");
    expect(code?.textContent).toBe("npm");
    expect(code?.className).toContain("bg-muted");
  });

  it("renders inline code with primary-foreground styling for user", () => {
    render(<MarkdownContent content={"use `npm` here"} isUser={true} />);
    const code = screen.getByTestId("markdown-content").querySelector("code");
    expect(code?.className).toContain("bg-primary-foreground/15");
  });

  it("applies markdown-content-user wrapper class for user", () => {
    render(<MarkdownContent content="x" isUser={true} />);
    expect(screen.getByTestId("markdown-content").className).toContain(
      "markdown-content-user",
    );
  });

  it("renders external links with target=_blank", () => {
    render(
      <MarkdownContent content="[hi](https://example.com)" isUser={false} />,
    );
    const a = screen
      .getByTestId("markdown-content")
      .querySelector("a") as HTMLAnchorElement;
    expect(a.getAttribute("target")).toBe("_blank");
    expect(a.getAttribute("rel")).toBe("noopener noreferrer");
    expect(a.getAttribute("href")).toBe("https://example.com");
  });

  it("renders gfm tables", () => {
    const md = "| a | b |\n|---|---|\n| 1 | 2 |";
    render(<MarkdownContent content={md} isUser={false} />);
    const root = screen.getByTestId("markdown-content");
    expect(root.querySelectorAll("th").length).toBe(2);
    expect(root.querySelectorAll("td").length).toBe(2);
  });

  it("renders headings, lists, blockquote, hr, strong, img", () => {
    const md =
      "# H1\n## H2\n### H3\n#### H4\n##### H5\n###### H6\n\n- a\n- b\n\n1. one\n2. two\n\n> quote\n\n---\n\n**bold**\n\n![alt](https://example.com/i.png)";
    render(<MarkdownContent content={md} isUser={false} />);
    const root = screen.getByTestId("markdown-content");
    expect(root.querySelector("h1")?.textContent).toBe("H1");
    expect(root.querySelector("h6")?.textContent).toBe("H6");
    expect(root.querySelectorAll("ul li").length).toBe(2);
    expect(root.querySelectorAll("ol li").length).toBe(2);
    expect(root.querySelector("blockquote")?.textContent).toContain("quote");
    expect(root.querySelector("hr")).toBeTruthy();
    expect(root.querySelector("strong")?.textContent).toBe("bold");
    const img = root.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("https://example.com/i.png");
    expect(img.getAttribute("alt")).toBe("alt");
  });
});
