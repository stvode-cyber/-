import Header from '../components/Header'

/**
 * 隐私政策
 * - 合规用途，纯文本静态页面
 * - 注册流程中要求用户阅读并勾选同意
 * - 与现有的 PrivacyPage（隐私控制面板 P3）区分开
 */
export default function PrivacyPolicyPage() {
  return (
    <div className="app-shell">
      <Header title="隐私政策" />
      <div className="px-4 py-5 max-w-2xl mx-auto space-y-5 text-sm leading-relaxed text-gray-700">
        <section className="card">
          <p className="text-xs text-gray-400 mb-2">最后更新：2026 年 9 月</p>
          <p className="text-gray-600">
            「绿角犀 AI 助理系统」（以下简称"本应用"）非常重视您的个人信息和隐私安全。
            本隐私政策将向您说明我们如何收集、使用、存储和保护您的个人信息，
            以及您对此享有哪些权利。
          </p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">一、我们收集的信息</h3>
          <p className="font-medium text-gray-700">1.1 您主动提供的信息</p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>注册时的用户名、密码（加密存储）、手机号</li>
            <li>个人资料（头像、昵称、AI 语气偏好等）</li>
            <li>您在应用中创建的所有数据：记账、任务、日程、便签、对话记录等</li>
          </ul>
          <p className="font-medium text-gray-700 mt-2">1.2 自动收集的信息</p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>设备基础信息（设备型号、操作系统版本）</li>
            <li>应用内操作日志（用于问题排查与服务优化）</li>
          </ul>
          <p className="font-medium text-gray-700 mt-2">1.3 我们<span className="font-semibold">不会</span>收集的信息</p>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>通讯录、短信、通话记录（应用内无相关权限申请）</li>
            <li>GPS 精确位置（天气功能仅使用大致城市，不记录位置轨迹）</li>
            <li>相册/照片（您主动上传的头像和图片仅存储在本地或您指定的云端目录）</li>
          </ul>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">二、信息如何存储</h3>
          <p>
            2.1 <span className="font-medium">默认本地优先</span>：未启用 AI 云端激活的用户，
            全部核心数据（账号信息、对话记录、便签、账目等）仅存储在您当前使用的设备本地，
            不会上传至任何服务器。您完全掌握自己的数据。
          </p>
          <p>
            2.2 <span className="font-medium">可选云端同步</span>：若您启用了 AI 云端激活（多设备账号），
            您的账号信息和部分对话会通过加密通道同步至服务器。所有通信均采用 HTTPS/TLS 加密传输，
            数据库中不保存您的原始密码（仅保存 bcrypt 哈希值）。
          </p>
          <p>
            2.3 <span className="font-medium">录音数据</span>：您录制的语音备忘录在本地处理后，
            原始录音文件不会上传，仅转写文本和提取的摘要会被保存。
          </p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">三、信息如何使用</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>为您提供应用内各项功能服务（任务提醒、记账、AI 对话等）</li>
            <li>AI 助理个性化：根据您的对话和使用习惯，让 AI 回复更贴合您的风格（可在设置中关闭）</li>
            <li>问题排查：当应用出现异常时，操作日志帮助定位问题</li>
            <li>服务优化：匿名统计用于改进产品功能</li>
          </ul>
          <p className="text-gray-600">
            <span className="font-medium">我们不会</span>将您的个人信息用于：精准投放广告、出售给第三方、
            或任何与提供服务无关的用途。
          </p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">四、信息共享与第三方</h3>
          <p>
            4.1 本应用 <span className="font-semibold">不会</span>向任何第三方共享、出售或租赁您的个人信息。
          </p>
          <p>
            4.2 AI 功能依赖第三方大语言模型 API。调用 AI 时，您发送的对话内容会被转发至模型服务商，
            但我们<span className="font-semibold">不会</span>同时发送您的账号标识、密码、手机号等敏感信息。
            模型服务商的隐私政策请参见其官方文档。
          </p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">五、数据安全</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li>密码仅以 bcrypt 加盐哈希形式存储，无法反推原始密码</li>
            <li>云端通信全部使用 HTTPS/TLS 加密</li>
            <li>应用内提供"隐私与理解"设置页，您可随时调整 AI 理解管线的四档模式</li>
            <li>应用内支持一键导出全部对话记忆（Markdown/JSON），导出文件受设备本地安全机制保护</li>
          </ul>
          <p className="text-gray-600">
            尽管我们采取了合理的安全措施，但互联网传输和电子存储无法做到绝对安全。
            如发生信息安全事件，我们将依法及时通知您。
          </p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">六、您的权利</h3>
          <ul className="list-disc pl-5 space-y-1 text-gray-600">
            <li><span className="font-medium">访问与修改</span>：您可随时在应用内查看和修改个人资料</li>
            <li><span className="font-medium">删除</span>：您可在"隐私与理解"中删除 AI 理解产生的记忆条目</li>
            <li><span className="font-medium">导出</span>：您可一键导出全部对话记忆</li>
            <li><span className="font-medium">注销账户</span>：注销后您的所有数据将被永久删除</li>
            <li><span className="font-medium">关闭 AI 理解</span>：在隐私设置中切换至"关闭"模式即可停止 AI 记录</li>
          </ul>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">七、儿童保护</h3>
          <p>
            本应用的服务面向全年龄段用户。我们不专门收集未满 14 岁未成年人的个人信息。
            若您是未成年人，请在监护人的指导下使用本应用。
          </p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">八、政策更新</h3>
          <p>
            我们可能不时更新本隐私政策。更新后的政策将在应用内发布，
            并标注新的生效日期。继续使用本应用即视为同意更新后的政策。
          </p>
        </section>

        <section className="card space-y-2">
          <h3 className="font-semibold text-gray-800">九、联系我们</h3>
          <p>
            如对本隐私政策或您的个人信息处理有任何疑问、意见或建议，
            可通过应用内"设置 — 关于"中提供的联系方式与我们取得联系。
          </p>
        </section>

        <p className="text-center text-xs text-gray-400 pt-2">— 绿角犀 AI 助理团队 —</p>
      </div>
    </div>
  )
}
