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

        <div className="docs-contact">
          <div className="contact-qr-box">
            <img
              src="/contact-qr.png"
              alt="联系方式二维码"
              className="contact-qr-img"
              onError={(e) => {
                e.currentTarget.style.display = "none";
                e.currentTarget.nextSibling.style.display = "flex";
              }}
            />
            <div className="contact-qr-placeholder">二维码占位</div>
          </div>
          <div className="contact-text">
            <h3>扫码联系作者</h3>
            <p>使用中遇到问题或有功能建议，欢迎扫码反馈交流。</p>
            <p className="contact-hint">将真实二维码图片命名为 <code>contact-qr.png</code> 放入项目 <code>public/</code> 目录，即可替换此处的占位图。</p>
          </div>
        </div>
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

        .docs-contact { margin-top: 48px; padding-top: 28px; border-top: 1px solid #ddd8cc; display: flex; align-items: center; gap: 24px; }
        .contact-qr-box { width: 120px; height: 120px; flex-shrink: 0; border: 1px dashed #c8c1b4; border-radius: 8px; background: #fff; display: flex; align-items: center; justify-content: center; overflow: hidden; }
        .contact-qr-img { width: 100%; height: 100%; object-fit: contain; }
        .contact-qr-placeholder { display: none; width: 100%; height: 100%; align-items: center; justify-content: center; color: #b8b0a2; font-size: 12px; font-family: 'IBM Plex Mono', monospace; text-align: center; }
        .contact-text h3 { font-size: 16px; margin: 0 0 8px; color: #2c4a8a; }
        .contact-text p { margin: 4px 0; font-size: 13px; line-height: 1.7; color: #4a443c; }
        .contact-text .contact-hint { font-size: 12px; color: #8a8078; }
        .contact-text code { font-family: 'IBM Plex Mono', monospace; background: #ece8df; padding: 2px 6px; border-radius: 4px; font-size: 11px; }
      `}</style>
    </div>
  );
}
