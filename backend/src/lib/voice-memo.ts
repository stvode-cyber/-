/**
 * 录音直达纪要 - AI 转写与提取（DG-10）
 *
 * 本模块当前为 MVP 阶段的 mock 实现：
 * - transcribeAudio：未接入真实 STT 服务，返回提示性占位文本
 * - extractMemo：基于关键词规则从转写文本中提取待办与纪要摘要
 *
 * 后续可接入真实大模型 / STT 服务：
 * - transcribeAudio → 调用 OpenAI Whisper / 阿里云录音文件识别 / 腾讯云 ASR
 * - extractMemo → 调用 LLM（GPT-4 / Claude / 文心一言）做对话式摘要提取
 *
 * 接口约定（不变）：
 * - transcribeAudio(memoId, userId, audioData, audioFormat) → Promise<string>
 * - extractMemo(transcript) → Promise<{ todoItems: string[]; summary: string }>
 */

/**
 * 转写音频为文本
 *
 * MVP 实现：
 * - 不真实转写音频内容（无 STT 服务接入）
 * - 返回提示性文本，说明这是 mock 输出
 * - 模拟 500-1500ms 网络延迟，便于前端展示 loading 状态
 *
 * 真实接入时：
 * 1. 将 audioData base64 解码为二进制
 * 2. 调用 STT 服务 API（Whisper / 阿里云 ASR / 腾讯云 ASR）
 * 3. 解析返回结果，提取 text 字段
 * 4. 错误处理：服务不可用 / 配额超限 / 音频格式不支持
 *
 * @param _memoId    录音 ID（用于日志追踪，未来可关联到任务）
 * @param _userId    用户 ID
 * @param _audioData base64 音频数据
 * @param audioFormat 音频 MIME 类型
 */
export async function transcribeAudio(
  _memoId: string,
  _userId: string,
  _audioData: string,
  audioFormat: string,
): Promise<string> {
  // 模拟网络延迟
  await sleep(500 + Math.random() * 1000)

  // MVP 占位：返回提示性文本，便于前端流程联调
  // 真实接入后此处会返回 STT 服务的转写结果
  return `[录音转写占位] 当前为 MVP 阶段，未接入真实语音转写服务。
音频格式：${audioFormat}
时长信息请见录音纪要详情。

如需接入真实转写能力，请在 src/lib/voice-memo.ts 中替换 transcribeAudio 实现，
可选方案：
- OpenAI Whisper API
- 阿里云录音文件识别
- 腾讯云语音识别

你可以通过 PATCH /voice-memos/:id/extract 传入自定义 transcript 来体验后续待办提取流程。`
}

/**
 * 从转写文本中提取待办与纪要摘要
 *
 * 规则：
 * 1. 待办提取：匹配「需要」「记得」「要做」「明天」「下周」「打电话」等关键词的句子
 * 2. 摘要生成：取前 3 句话作为纪要核心，附上待办总数提示
 * 3. 去重与截断：避免重复待办，单条待办不超过 50 字
 *
 * @param transcript 转写文本
 */
export async function extractMemo(transcript: string): Promise<{
  todoItems: string[]
  summary: string
}> {
  // 模拟 LLM 推理延迟
  await sleep(200 + Math.random() * 500)

  if (!transcript || transcript.trim().length === 0) {
    return {
      todoItems: [],
      summary: '转写文本为空，无法提取纪要。',
    }
  }

  // 按标点切分句子（句号 / 问号 / 感叹号 / 分号 / 换行）
  const sentences = transcript
    .split(/[。！？；\n.!?;]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 2)

  // 待办触发关键词
  const todoKeywords = /(需要|记得|要做|得去|别忘了|提醒我|明天|下周|今天|马上|赶紧|电话|联系|发送|提交|完成|处理|安排|确认|检查|准备|整理|汇报)/

  const seen = new Set<string>()
  const todoItems: string[] = []
  for (const s of sentences) {
    // 匹配待办关键词且未重复
    if (todoKeywords.test(s) && !seen.has(s)) {
      seen.add(s)
      // 截断超长句子，保留前 50 字
      todoItems.push(s.length > 50 ? s.slice(0, 50) + '…' : s)
    }
    // 上限 10 条，避免提取过多
    if (todoItems.length >= 10) break
  }

  // 摘要：取前 3 句作为核心 + 待办统计
  const core = sentences.slice(0, 3).join('。')
  const summaryParts: string[] = []
  if (core) summaryParts.push(core)
  if (todoItems.length > 0) {
    summaryParts.push(`本次纪要共识别 ${todoItems.length} 项待办事项`)
  } else {
    summaryParts.push('未识别到明确的待办事项')
  }
  const summary = summaryParts.join('。') + '。'

  return { todoItems, summary }
}

/** 工具：sleep */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
