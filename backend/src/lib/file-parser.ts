// =============================================================================
// 文件解析工具（5d 阶段）
// -----------------------------------------------------------------------------
// 把上传的 TXT/MD/DOCX/PDF 文件统一解析为纯文本（写入 scripts.sourceContent）
// - txt：直接 UTF-8 解码
// - md：直接 UTF-8 解码（保留 Markdown 标记原样，由后续 LLM 分析阶段处理）
// - docx：mammoth.extractRawText（忽略格式，仅取文本）
// - pdf：pdf-parse v2（PDFParse 类 + getText）
// =============================================================================

import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

export type SupportedFileType = 'txt' | 'md' | 'docx' | 'pdf'

// 根据文件名扩展名检测类型（KISS：仅扩展名校验，不做 magic number）
export function detectFileType(filename: string): SupportedFileType | null {
  const ext = filename.toLowerCase().split('.').pop()
  if (ext === 'txt') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'docx') return 'docx'
  if (ext === 'pdf') return 'pdf'
  return null
}

// 解析 Buffer → 纯文本
export async function parseFileToText(
  buffer: Buffer,
  type: SupportedFileType,
): Promise<string> {
  switch (type) {
    case 'txt':
      return buffer.toString('utf-8')
    case 'md':
      // Markdown 按纯文本处理：保留 #、*、代码块等标记原样入库，由 LLM 分析阶段容错
      return buffer.toString('utf-8')
    case 'docx': {
      const result = await mammoth.extractRawText({ buffer })
      return result.value
    }
    case 'pdf': {
      // pdf-parse v2：PDFParse 类，构造时传 Uint8Array，再调 getText
      const parser = new PDFParse({ data: new Uint8Array(buffer) })
      try {
        const result = await parser.getText()
        return result.text
      } finally {
        await parser.destroy()
      }
    }
  }
}
