import fs from "fs";
import path from "path";
import Head from "next/head";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

export async function getStaticProps() {
  const filePath = path.join(process.cwd(), "docs", "用户手册.md");
  const content = fs.readFileSync(filePath, "utf-8");
  return { props: { content } };
}

export default function Docs({ content }) {
  return (
    <div className="docs-app">
      <Head>
        <title>使用文档 · Empirical Research Platform</title>
      </Head>
      <div className="docs-page">
        <div className="docs-header">
          <a href="/" className="back-link">← 返回平台</a>
          <span className="docs-jname">Empirical Research Platform</span>
        </div>
        <article className="docs-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </article>
      </div>

      <style jsx global>{`
        .docs-app { background: #f7f5f0; color: #1a1a1a; font-family: 'IBM Plex Sans', sans-serif; min-height: 100vh; }
        .docs-page { max-width: 860px; margin: 0 auto; padding: 48px 24px 96px; }
        .docs-header { border-top: 3px solid #1a1a1a; border-bottom: 1px solid #1a1a1a; padding: 14px 0 10px; margin-bottom: 36px; display: flex; justify-content: space-between; align-items: baseline; }
        .docs-jname { font-family: 'Playfair Display', serif; font-size: 13px; font-weight: 600; letter-spacing: 3px; text-transform: uppercase; color: #8a8078; }
        .back-link { font-family: 'IBM Plex Mono', monospace; font-size: 12px; color: #2c4a8a; text-decoration: none; }
        .back-link:hover { text-decoration: underline; }

        .docs-body h1 { font-family: 'Playfair Display', serif; font-size: 32px; margin: 0 0 16px; }
        .docs-body h2 { font-family: 'Playfair Display', serif; font-size: 22px; margin: 36px 0 14px; padding-bottom: 6px; border-bottom: 1px solid #ddd8cc; }
        .docs-body h3 { font-size: 17px; margin: 24px 0 10px; color: #2c4a8a; }
        .docs-body p { line-height: 1.8; margin: 12px 0; font-size: 14px; }
        .docs-body ul, .docs-body ol { margin: 12px 0; padding-left: 28px; line-height: 1.8; font-size: 14px; }
        .docs-body blockquote { margin: 16px 0; padding: 8px 16px; border-left: 3px solid #2c4a8a; background: #fff; color: #8a8078; font-size: 13px; }
        .docs-body code { font-family: 'IBM Plex Mono', monospace; background: #ece8df; padding: 2px 6px; border-radius: 4px; font-size: 12px; }
        .docs-body pre { background: #1a1a1a; color: #f7f5f0; padding: 14px 16px; border-radius: 6px; overflow-x: auto; margin: 16px 0; }
        .docs-body pre code { background: none; padding: 0; color: inherit; }
        .docs-body table { border-collapse: collapse; width: 100%; margin: 16px 0; font-size: 13px; }
        .docs-body th, .docs-body td { border: 1px solid #ddd8cc; padding: 8px 12px; text-align: left; }
        .docs-body th { background: #ece8df; font-weight: 600; }
        .docs-body a { color: #2c4a8a; }
        .docs-body hr { border: none; border-top: 1px solid #ddd8cc; margin: 32px 0; }
      `}</style>
    </div>
  );
}
