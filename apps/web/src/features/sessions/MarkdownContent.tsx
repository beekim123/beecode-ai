import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface MarkdownContentProps {
  text: string;
}

const remarkPlugins = [remarkGfm];

const markdownComponents: Components = {
  a({ children, href }) {
    const opensNewWindow = href?.startsWith("https://") || href?.startsWith("http://");
    return (
      <a
        href={href}
        rel={opensNewWindow ? "noopener noreferrer" : undefined}
        target={opensNewWindow ? "_blank" : undefined}
      >
        {children}
      </a>
    );
  },
  table({ children }) {
    return <div className="markdown-table-scroll"><table>{children}</table></div>;
  },
};

export function MarkdownContent({ text }: MarkdownContentProps): React.JSX.Element {
  return (
    <div className="markdown-content">
      <Markdown components={markdownComponents} remarkPlugins={remarkPlugins} skipHtml>
        {text}
      </Markdown>
    </div>
  );
}
