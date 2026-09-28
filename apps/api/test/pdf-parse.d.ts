declare module 'pdf-parse/lib/pdf-parse.js' {
  interface PageData {
    getTextContent(opts?: object): Promise<{ items: { str: string; transform: number[] }[] }>;
  }
  interface Result {
    numpages: number;
    text: string;
  }
  export default function pdf(data: Buffer, opts?: { pagerender?: (p: PageData) => Promise<string> }): Promise<Result>;
}
