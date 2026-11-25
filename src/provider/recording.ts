// Recording readiness: browse records an agent-opened tab through CDP, which needs ffmpeg on PATH; a tab the user lent
// records through tab-capture, started by the toolbar button, and needs nothing. Status and the doctor say which is
// available and how to get the other, so a recording does not fail only at the moment it is asked for.
import { execFile } from "node:child_process"
import { accessSync, constants, existsSync, statSync } from "node:fs"
import { delimiter, join } from "node:path"

export interface RecordingReadiness {
  /** Agent-opened tabs: the CDP recorder writes through ffmpeg. */
  readonly ffmpeg: { readonly found: boolean; readonly path: string | null; readonly version: string | null }
  /** A tab the user lent: the extension's tab-capture recorder. */
  readonly toolbar: { readonly ready: true }
}

/** The first `ffmpeg` on PATH that is an executable file. No shell. */
export function findFfmpeg(env: NodeJS.ProcessEnv = process.env): string | undefined {
  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (directory === "") continue
    for (const name of process.platform === "win32" ? ["ffmpeg.exe"] : ["ffmpeg"]) {
      const candidate = join(directory, name)
      try {
        if (existsSync(candidate) && statSync(candidate).isFile()) {
          accessSync(candidate, constants.X_OK)
          return candidate
        }
      } catch {
        // Not executable, or gone between the check and the access: try the next.
      }
    }
  }
  return undefined
}

/** `ffmpeg version 7.1.1 Copyright …` -> `7.1.1`. */
export function parseFfmpegVersion(output: string): string | undefined {
  return /ffmpeg version\s+([0-9][^\s]*)/i.exec(output)?.[1]
}

function probeFfmpeg(path: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    execFile(path, ["-version"], { timeout: 5_000, maxBuffer: 1 << 20 }, (error, stdout) => {
      resolve(error ? undefined : parseFfmpegVersion(String(stdout ?? "")))
    })
  })
}

/** What recording can do right now. A missing ffmpeg never throws; it is a state with a next step. */
export async function detectRecording(env: NodeJS.ProcessEnv = process.env): Promise<RecordingReadiness> {
  const path = findFfmpeg(env)
  const version = path === undefined ? undefined : await probeFfmpeg(path)
  return { ffmpeg: { found: path !== undefined, path: path ?? null, version: version ?? null }, toolbar: { ready: true } }
}

/** One sentence for the row. */
export function formatRecording(recording: RecordingReadiness | undefined): string {
  if (recording === undefined) return "checking"
  const { ffmpeg, toolbar } = recording
  const agent = ffmpeg.found
    ? `agent tabs: ffmpeg ${ffmpeg.version ?? "found"}${ffmpeg.path ? ` (${ffmpeg.path})` : ""}`
    : "agent tabs: ffmpeg missing"
  return `${agent} · lent tabs: toolbar-click backend${toolbar.ready ? "" : " unavailable"}`
}

/** The one next step while a recorder backend is missing, or undefined when both work. */
export function recordingNextStep(recording: RecordingReadiness | undefined): string | undefined {
  if (recording === undefined || recording.ffmpeg.found) return undefined
  return "Install ffmpeg to record agent-opened tabs (`brew install ffmpeg` on macOS, or your package manager's ffmpeg), or click the browse toolbar button on a tab and record that."
}
