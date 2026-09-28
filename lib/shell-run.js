// dsh-tailscale-console — shell 服务调用适配（DSH 0.1.7 契约）
//
// DSH 0.1.7 重做 shell 执行契约：resolve(request) 与 execute(spec) 保留，
// run(spec) 移除；结果改经 handle.result() 获取，形状
// {exitCode, signal, timedOut, aborted, timeoutMs, stdout:{text,truncated,…}, stderr:{…}}。
// 本模块集中封装新契约，返回形状与 0.1.5 时代保持一致
// （exitCode/timedOut/stdout/stderr），供 /tsctl/api 各路由复用；
// 新增 truncated 透传供调试长输出截断。
//
// 超时语义：resolve 默认 onExpiry:"kill"，超时后 result() 以 timedOut:true 落定；
// 基础设施失败（spawn 失败等）由 result() reject，此处兜底为 exitCode:-1，
// 与 0.1.5 时代 run 闭包的 catch 行为一致。

export async function execViaShell({ shell, policy, command, timeoutMs }) {
  try {
    const spec = shell.resolve({
      command,
      timeoutMs: timeoutMs || 20000,
      ...(policy !== undefined ? { sandboxPolicy: policy } : {}),
    })
    const proc = await shell.execute(spec)
    const res = await proc.result()
    return {
      exitCode: res.exitCode,
      timedOut: !!res.timedOut,
      stdout: (res.stdout && res.stdout.text) || "",
      stderr: (res.stderr && res.stderr.text) || "",
      ...((res.stdout && res.stdout.truncated) || (res.stderr && res.stderr.truncated) ? { truncated: true } : {}),
    }
  } catch (err) {
    return { exitCode: -1, timedOut: false, stdout: "", stderr: String((err && err.message) || err) }
  }
}
