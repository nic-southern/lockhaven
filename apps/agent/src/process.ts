import { spawn } from "node:child_process"

export async function runCommand(
  file: string,
  args: readonly string[],
  timeoutMs = 8_000
) {
  return new Promise<{ code: number; stdout: string; stderr: string }>(
    (resolve) => {
      const child = spawn(file, [...args], {
        shell: false,
        windowsHide: true,
      })
      let stdout = ""
      let stderr = ""
      const timer = setTimeout(() => {
        child.kill("SIGKILL")
      }, timeoutMs)
      child.stdout?.setEncoding("utf8")
      child.stderr?.setEncoding("utf8")
      child.stdout?.on("data", (chunk: string) => {
        stdout += chunk
      })
      child.stderr?.on("data", (chunk: string) => {
        stderr += chunk
      })
      child.on("error", () => {
        clearTimeout(timer)
        resolve({ code: 127, stdout, stderr })
      })
      child.on("close", (code) => {
        clearTimeout(timer)
        resolve({ code: code ?? 1, stdout, stderr })
      })
    }
  )
}
