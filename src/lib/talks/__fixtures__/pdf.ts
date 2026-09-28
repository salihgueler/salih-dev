/**
 * Small, deterministic PDF byte fixtures for parser integration tests.
 *
 * These fixtures stay in the test source tree and are materialized only inside
 * temporary directories. They are not talk content and are never copied into
 * the public slide directory.
 */

const encoder = new TextEncoder();

type PdfObject = Readonly<{
  number: number;
  body: string;
}>;

function byteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function buildPdf(
  pageCount: number,
  options: Readonly<{ encrypted?: boolean }> = {},
): Uint8Array {
  const pageNumbers = Array.from(
    { length: pageCount },
    (_, index) => index + 3,
  );
  const objects: PdfObject[] = [
    { number: 1, body: "<< /Type /Catalog /Pages 2 0 R >>" },
    {
      number: 2,
      body: `<< /Type /Pages /Kids [${pageNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pageCount} >>`,
    },
    ...pageNumbers.map((number) => ({
      number,
      body: "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << >> >>",
    })),
  ];

  let trailerEntries = "/Root 1 0 R";

  if (options.encrypted === true) {
    const encryptionObjectNumber = objects.length + 1;
    objects.push({
      number: encryptionObjectNumber,
      body: "<< /Filter /Standard /V 1 /R 2 /Length 40 /O <0000000000000000000000000000000000000000000000000000000000000000> /U <1111111111111111111111111111111111111111111111111111111111111111> /P -4 >>",
    });
    trailerEntries +=
      ` /Encrypt ${encryptionObjectNumber} 0 R` +
      " /ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]";
  }

  let source = "%PDF-1.4\n";
  const offsets = new Map<number, number>();

  for (const object of objects) {
    offsets.set(object.number, byteLength(source));
    source += `${object.number} 0 obj\n${object.body}\nendobj\n`;
  }

  const xrefOffset = byteLength(source);
  source += `xref\n0 ${objects.length + 1}\n`;
  source += "0000000000 65535 f \n";

  for (let number = 1; number <= objects.length; number += 1) {
    const offset = offsets.get(number);
    if (offset === undefined) {
      throw new Error(`PDF fixture object ${number} has no byte offset`);
    }
    source += `${String(offset).padStart(10, "0")} 00000 n \n`;
  }

  source +=
    `trailer\n<< /Size ${objects.length + 1} ${trailerEntries} >>\n` +
    `startxref\n${xrefOffset}\n%%EOF\n`;

  return encoder.encode(source);
}

export const PDF_TEST_FIXTURES = Object.freeze({
  get singlePage(): Uint8Array {
    return buildPdf(1);
  },
  get multiPage(): Uint8Array {
    return buildPdf(2);
  },
  get zeroByte(): Uint8Array {
    return new Uint8Array();
  },
  get wrongSignature(): Uint8Array {
    return encoder.encode("This is not a PDF document.");
  },
  get truncated(): Uint8Array {
    return encoder.encode(
      "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages",
    );
  },
  get encryptedUnreadable(): Uint8Array {
    return buildPdf(1, { encrypted: true });
  },
  get zeroPage(): Uint8Array {
    return buildPdf(0);
  },
});
