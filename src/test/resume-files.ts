import { strToU8, zipSync } from "fflate";

// Small resume files for tests, built on the fly (E4-10).

/** A one-page PDF with the given lines of text and links behind them, with a correct cross-reference table. */
export function pdfWith(lines: string[], links: string[] = []): Uint8Array {
  const escape = (line: string) => line.replace(/[\\()]/g, (match) => `\\${match}`);
  const content = ["BT", "/F1 11 Tf", "14 TL", "50 780 Td", ...lines.map((line) => `(${escape(line)}) Tj T*`), "ET"].join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >>${links.length > 0 ? ` /Annots [${links.map((_, index) => `${index + 6} 0 R`).join(" ")}]` : ""} >>`,
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...links.map((link, index) => `<< /Type /Annot /Subtype /Link /Rect [50 ${760 - index * 14} 200 ${772 - index * 14}] /Border [0 0 0] /A << /S /URI /URI (${link}) >> >>`),
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = pdf.length;
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return strToU8(pdf);
}

/** A minimal Word document with one paragraph per line, and a linked paragraph for each link. */
export function docxWith(lines: string[], links: string[] = []): Uint8Array {
  const escape = (line: string) => line.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const body = lines.map((line) => `<w:p><w:r><w:t xml:space="preserve">${escape(line)}</w:t></w:r></w:p>`).join("");
  const linked = links
    .map((_, index) => `<w:p><w:hyperlink r:id="rLink${index}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:r><w:t>Link ${index}</w:t></w:r></w:hyperlink></w:p>`)
    .join("");
  const relations = links.map((link, index) => `<Relationship Id="rLink${index}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${escape(link)}" TargetMode="External"/>`).join("");
  return zipSync({
    "word/_rels/document.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}</Relationships>`),
    "[Content_Types].xml": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    "_rels/.rels": strToU8(
      '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    "word/document.xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}${linked}</w:body></w:document>`,
    ),
  });
}
