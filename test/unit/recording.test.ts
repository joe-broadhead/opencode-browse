// Recording readiness: ffmpeg for agent-opened tabs, the toolbar-click backend for a lent tab, a row and one next step.
import { afterAll, describe, expect, test } from "bun:test"
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { realpathSync } from "node:fs"
import { detectRecording, findFfmpeg, formatRecording, parseFfmpegVersion, recordingNextStep } from "../../src/recording.js"
import { buildStatus } from "../../src/status.js"

const root = realpathSync(mkdtempSync(join(realpathSync("/tmp"), "browse-recording-")))
afterAll(() => rmSync(root, { recursive: true, force: true }))

const host = { version: "2.2.5", range: ">=2.2.3 <2.3.0", tested: true }
const rules = { access: "all" as const, scoped: false, readOnly: false }
const binary = { path: "/opt/browse", version: "0.0.15", source: "package" as const, verified: true, tested: true, supported: true, pinned: true, platform: "darwin-arm64" }

describe("ffmpeg detection", () => {
  test("finds the first executable on PATH, and reads its version", async () => {
    const dir = join(root, "bin")
    mkdirSync(dir, { recursive: true })
    const ffmpeg = join(dir, "ffmpeg")
    writeFileSync(ffmpeg, '#!/bin/sh\necho "ffmpeg version 7.1.1 Copyright (c) 2000-2024"\n')
    chmodSync(ffmpeg, 0o755)
    expect(findFfmpeg({ PATH: dir })).toBe(ffmpeg)
    const readiness = await detectRecording({ PATH: dir })
    expect(readiness.ffmpeg).toEqual({ found: true, path: ffmpeg, version: "7.1.1" })
    expect(readiness.toolbar).toEqual({ ready: true })
    expect(recordingNextStep(readiness)).toBeUndefined()
  })

  test("a missing ffmpeg is a state with one next step, not an error", async () => {
    const readiness = await detectRecording({ PATH: join(root, "empty") })
    expect(readiness.ffmpeg.found).toBe(false)
    expect(recordingNextStep(readiness)).toContain("brew install ffmpeg")
    expect(recordingNextStep(readiness)).toContain("toolbar button")
  })

  test("parses the version line and ignores a binary that is not executable", () => {
    expect(parseFfmpegVersion("ffmpeg version 6.0-static")).toBe("6.0-static")
    expect(parseFfmpegVersion("nonsense")).toBeUndefined()
    expect(findFfmpeg({ PATH: root })).toBeUndefined()
  })
})

describe("the status and the doctor", () => {
  const base = { host, rules, mode: "real" as const, binary, server: { status: "connected" as const }, tools: ["status"], relay: { running: true, version: "0.0.15", stale: false }, extension: { connected: true, version: "0.0.15", pairingState: "paired", compatible: true, nextStep: null } }

  test("a missing ffmpeg is a row and the one next step", () => {
    const status = buildStatus({ ...base, recording: { ffmpeg: { found: false, path: null, version: null }, toolbar: { ready: true } } })
    expect(status.recording?.ffmpeg.found).toBe(false)
    expect(status.nextStep).toContain("brew install ffmpeg")
    expect(formatRecording(status.recording)).toBe("agent tabs: ffmpeg missing · lent tabs: toolbar-click backend")
  })

  test("a found ffmpeg is a row and needs nothing", () => {
    const status = buildStatus({ ...base, recording: { ffmpeg: { found: true, path: "/opt/homebrew/bin/ffmpeg", version: "7.1.1" }, toolbar: { ready: true } } })
    expect(status.nextStep).toBe("Nothing to do.")
    expect(formatRecording(status.recording)).toContain("ffmpeg 7.1.1")
  })
})
