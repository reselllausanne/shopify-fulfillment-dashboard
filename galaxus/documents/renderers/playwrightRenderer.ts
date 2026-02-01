import { chromium } from "playwright";

type RenderOptions = {
  html: string;
  format?: "A4" | "A6";
  showPageNumbers?: boolean;
};

export async function renderPdfFromHtml(options: RenderOptions): Promise<Buffer> {
  const browser = await chromium.launch({
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setContent(options.html, { waitUntil: "networkidle" });
    await page.emulateMediaType("print");

    const footerTemplate = options.showPageNumbers
      ? `
        <div style="font-size:9px;width:100%;text-align:right;padding:0 12mm;">
          Page <span class="pageNumber"></span> / <span class="totalPages"></span>
        </div>
      `
      : "<div></div>";

    const pdfBuffer = await page.pdf({
      format: options.format ?? "A4",
      printBackground: true,
      displayHeaderFooter: options.showPageNumbers ?? false,
      headerTemplate: "<div></div>",
      footerTemplate,
      margin: {
        top: "14mm",
        bottom: options.showPageNumbers ? "16mm" : "14mm",
        left: "12mm",
        right: "12mm",
      },
    });

    return Buffer.from(pdfBuffer);
  } finally {
    await browser.close();
  }
}
