import { memo, useEffect, useState } from "react";
import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

import "./markdown.css";

interface ShikiHighlighter {
  codeToHtml(
    code: string,
    options: { lang: string; themes: { dark: string; light: string } },
  ): string;
}

let highlighterPromise: Promise<unknown> | null = null;

function getHighlighter(): Promise<ShikiHighlighter> {
  if (!highlighterPromise) {
    highlighterPromise = import("shiki/bundle/web").then((mod) =>
      mod.createHighlighter({
        themes: ["github-dark", "github-light"],
        langs: [
          "typescript",
          "javascript",
          "tsx",
          "jsx",
          "json",
          "html",
          "css",
          "bash",
          "shell",
          "python",
          "rust",
          "go",
          "sql",
          "yaml",
          "toml",
          "markdown",
          "diff",
        ],
      }),
    );
  }
  return highlighterPromise as Promise<ShikiHighlighter>;
}

function HighlightedCode({
  code,
  lang,
  isUser,
}: {
  code: string;
  lang: string;
  isUser: boolean;
}) {
  const [html, setHtml] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    getHighlighter()
      .then((hl) => {
        if (cancelled) return;
        try {
          const result = hl.codeToHtml(code, {
            lang,
            themes: { dark: "github-dark", light: "github-light" },
          });
          setHtml(result);
        } catch {
          // keep fallback
        }
      })
      .catch(() => {
        // keep fallback
      });

    return () => {
      cancelled = true;
    };
  }, [code, lang]);

  if (html) {
    return (
      <div
        className="shiki-wrapper"
        dangerouslySetInnerHTML={{ __html: html }}
        data-testid="md-shiki"
      />
    );
  }

  return (
    <pre
      className={cn(
        "overflow-x-auto rounded-md p-3 font-mono text-xs leading-relaxed",
        isUser
          ? "bg-primary-foreground/10 text-primary-foreground"
          : "bg-muted text-foreground",
      )}
      data-testid="md-code-fallback"
    >
      <code>{code}</code>
    </pre>
  );
}

function buildComponents(isUser: boolean): Components {
  return {
    code({ className, children, ...props }) {
      const match = /language-(\w+)/.exec(className || "");
      const codeString = String(children).replace(/\n$/, "");

      if (match) {
        return (
          <div className="relative my-2">
            <div
              className={cn(
                "rounded-t-md px-3 py-1 text-micro font-mono",
                isUser
                  ? "bg-primary-foreground/10 text-primary-foreground/70"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {match[1]}
            </div>
            <HighlightedCode
              code={codeString}
              lang={match[1] ?? "text"}
              isUser={isUser}
            />
          </div>
        );
      }

      const isBlock =
        typeof className === "string" || codeString.includes("\n");
      if (isBlock && codeString.includes("\n")) {
        return (
          <div className="relative my-2">
            <HighlightedCode code={codeString} lang="text" isUser={isUser} />
          </div>
        );
      }

      return (
        <code
          className={cn(
            "rounded px-1 py-0.5 font-mono text-sm",
            isUser ? "bg-primary-foreground/15" : "bg-muted text-foreground",
          )}
          {...props}
        >
          {children}
        </code>
      );
    },

    pre({ children }) {
      return <>{children}</>;
    },

    a({ href, children, ...props }) {
      return (
        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          className="underline underline-offset-2 hover:opacity-80"
          {...props}
        >
          {children}
        </a>
      );
    },

    table({ children, ...props }) {
      return (
        <div className="my-2 overflow-x-auto">
          <table className="min-w-full border-collapse text-xs" {...props}>
            {children}
          </table>
        </div>
      );
    },

    th({ children, ...props }) {
      return (
        <th
          className="bg-background border-b border-border px-3 py-1.5 text-left text-xs font-medium"
          {...props}
        >
          {children}
        </th>
      );
    },

    td({ children, ...props }) {
      return (
        <td className="border border-border px-3 py-1.5 text-xs" {...props}>
          {children}
        </td>
      );
    },

    blockquote({ children, ...props }) {
      return (
        <blockquote
          className={cn(
            "my-2 border-l-2 pl-3 italic",
            isUser
              ? "border-primary-foreground/30 text-primary-foreground/80"
              : "border-primary/50 text-muted-foreground",
          )}
          {...props}
        >
          {children}
        </blockquote>
      );
    },

    h1({ children, ...props }) {
      return (
        <h1 className="mt-3 mb-1.5 text-base font-semibold" {...props}>
          {children}
        </h1>
      );
    },

    h2({ children, ...props }) {
      return (
        <h2 className="mt-2.5 mb-1 text-sm font-semibold" {...props}>
          {children}
        </h2>
      );
    },

    h3({ children, ...props }) {
      return (
        <h3 className="mt-2 mb-1 text-sm font-medium" {...props}>
          {children}
        </h3>
      );
    },

    h4({ children, ...props }) {
      return (
        <h4 className="mt-1.5 mb-0.5 text-xs font-medium" {...props}>
          {children}
        </h4>
      );
    },

    h5({ children, ...props }) {
      return (
        <h5 className="mt-1.5 mb-0.5 text-xs font-medium" {...props}>
          {children}
        </h5>
      );
    },

    h6({ children, ...props }) {
      return (
        <h6 className="mt-1.5 mb-0.5 text-xs font-medium" {...props}>
          {children}
        </h6>
      );
    },

    ul({ children, ...props }) {
      return (
        <ul className="my-1 ml-4 list-disc space-y-0.5" {...props}>
          {children}
        </ul>
      );
    },

    ol({ children, ...props }) {
      return (
        <ol className="my-1 ml-4 list-decimal space-y-0.5" {...props}>
          {children}
        </ol>
      );
    },

    li({ children, ...props }) {
      return (
        <li className="text-sm leading-relaxed" {...props}>
          {children}
        </li>
      );
    },

    hr() {
      return <hr className="my-3 border-t border-border" />;
    },

    p({ children, ...props }) {
      return (
        <p className="my-1 leading-relaxed" {...props}>
          {children}
        </p>
      );
    },

    strong({ children, ...props }) {
      return (
        <strong className="font-semibold" {...props}>
          {children}
        </strong>
      );
    },

    img({ src, alt, ...props }) {
      return (
        <img
          src={src}
          alt={alt}
          className="my-2 max-w-full rounded-md"
          loading="lazy"
          {...props}
        />
      );
    },
  };
}

interface MarkdownContentProps {
  content: string;
  isUser: boolean;
  className?: string;
}

export const MarkdownContent = memo(function MarkdownContent({
  content,
  isUser,
  className,
}: MarkdownContentProps) {
  const components = buildComponents(isUser);

  return (
    <div
      className={cn(
        "markdown-content",
        isUser && "markdown-content-user",
        className,
      )}
      data-testid="markdown-content"
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
});
