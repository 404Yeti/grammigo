/** Recording/transcription problems are system events, never grammar mistakes. */
export type VoiceIssue = "permission_denied" | "unsupported" | "no_speech" | "failed" | "timeout" | "offline";
