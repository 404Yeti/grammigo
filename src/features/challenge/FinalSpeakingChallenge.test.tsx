import "@/tests/mocks";
import { beforeEach, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SessionScreen } from "@/features/practice/SessionScreen";
import { getSnapshot, updateState } from "@/lib/storage/store";
import { resetApp, lesson, router } from "@/tests/helpers";
import { createSession } from "@/features/practice/session";
import { updateChallenge, saveChallengeFeedback } from "./actions";
import { getScopeRevision, setStorageScope } from "@/lib/scope/storage-scope";

const api = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/features/ai/client", () => ({ fetchAiStatus: async () => ({ available: false }), requestWritingFeedback: async () => null, requestSpeakingFeedback: api.request, requestTranscription: async () => null }));

beforeEach(() => { resetApp(); api.request.mockReset(); api.request.mockResolvedValue(null); router.push.mockClear(); });
function seed() {
  const session = createSession(lesson, "final", 1);
  session.currentIndex = session.records.length - 1;
  session.phase = "feedback";
  session.records = session.records.map(r => ({ ...r, resolution: "needs_review" }));
  updateState(s => ({ ...s, sessions: [session], activeSessionId: session.id }));
}
async function enter() {
  seed(); render(<SessionScreen lessonId={lesson.id} />);
  await userEvent.click(await screen.findByRole("button", { name: "Finish lesson" }));
  expect(screen.getByText("Final speaking challenge")).toBeInTheDocument();
}
it("adds a resumable step before success and permits explicit skip without changing exercises", async () => {
  await enter();
  expect(getSnapshot().sessions[0].status).toBe("in_progress");
  expect(router.push).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: "Type instead" }));
  await userEvent.type(screen.getByLabelText("Your answer"), "I have visited Hanoi. I went yesterday.");
  expect(getSnapshot().sessions[0].speakingChallenge?.draft).toContain("Hanoi");
  await userEvent.click(screen.getByRole("button", { name: "Skip speaking and finish lesson" }));
  expect(getSnapshot().sessions[0].speakingChallenge?.status).toBe("skipped");
  expect(getSnapshot().sessions[0].status).toBe("completed");
  expect(router.push).toHaveBeenCalledWith(expect.stringContaining("/complete?session=final"));
});
it("saves unverified responses through provider failure and permits exactly one guided retry", async () => {
  await enter();
  await userEvent.click(screen.getByRole("button", { name: "Type instead" }));
  await userEvent.type(screen.getByLabelText("Your answer"), "I visited Hanoi yesterday.");
  await userEvent.click(screen.getByRole("button", { name: "Check my response" }));
  expect(await screen.findByText("Not verified")).toBeInTheDocument();
  expect(getSnapshot().sessions[0].speakingChallenge?.attempts).toHaveLength(1);
  await userEvent.click(screen.getByRole("button", { name: "Try one guided correction" }));
  await userEvent.type(screen.getByLabelText("Your answer"), " I have visited Hanoi twice.");
  await userEvent.click(screen.getByRole("button", { name: "Check my response" }));
  expect(getSnapshot().sessions[0].speakingChallenge?.attempts).toHaveLength(2);
  expect(screen.queryByRole("button", { name: "Try one guided correction" })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Finish lesson" }));
  expect(getSnapshot().sessions[0].status).toBe("completed");
});
it("rejects stale feedback callbacks even after switching away and back", () => {
  seed(); const revision = getScopeRevision();
  act(() => updateChallenge("final", revision, c => ({ ...c, draft: "saved" })));
  act(() => setStorageScope("11111111-1111-1111-1111-111111111111"));
  act(() => setStorageScope(""));
  act(() => saveChallengeFeedback("final", revision, 0, "saved", null));
  act(() => updateChallenge("final", revision, c => ({ ...c, draft: "leak" })));
  expect(getSnapshot().sessions[0].speakingChallenge?.draft).toBe("saved");
});
it("shows uncertainty as unverified and hides suggested grammar corrections", async () => {
  api.request.mockResolvedValue({ outcome: "unclear", confidence: "low", errors: [], suggestedCorrection: "Do not display this as a correction.", explanation: "Please check the words that were recognized.", example: null, assessedSkillIds: [lesson.id] });
  await enter();
  await userEvent.click(screen.getByRole("button", { name: "Type instead" }));
  await userEvent.type(screen.getByLabelText("Your answer"), "uncertain words");
  await userEvent.click(screen.getByRole("button", { name: "Check my response" }));
  expect(await screen.findByText(/Uncertain text is not counted as a grammar error/)).toBeInTheDocument();
  expect(screen.queryByText("Do not display this as a correction.")).not.toBeInTheDocument();
});
it("allows finishing during a pending assessment and ignores its later response", async () => {
  let resolve!: (value: null) => void;
  api.request.mockImplementation(() => new Promise<null>(r => { resolve = r; }));
  await enter();
  await userEvent.click(screen.getByRole("button", { name: "Type instead" }));
  await userEvent.type(screen.getByLabelText("Your answer"), "My response.");
  await userEvent.click(screen.getByRole("button", { name: "Check my response" }));
  expect(screen.getByText("Checking your confirmed words…")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Finish lesson" }));
  const completed = getSnapshot().sessions[0];
  await act(async () => resolve(null));
  expect(getSnapshot().sessions[0]).toEqual(completed);
  expect(completed.status).toBe("completed");
});
