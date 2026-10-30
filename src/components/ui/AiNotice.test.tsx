import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiNotice } from "./AiNotice";

describe("AiNotice", () => {
  it("tells the learner their voice/text goes to OpenAI and links to the privacy page", () => {
    render(<AiNotice what="voice-and-text" />);
    expect(screen.getByTestId("ai-notice").textContent).toMatch(/sent to OpenAI/);
    expect(screen.getByRole("link", { name: /privacy details/i }).getAttribute("href")).toBe("/privacy");
  });

  it("covers written answers too", () => {
    render(<AiNotice what="writing" />);
    expect(screen.getByTestId("ai-notice").textContent).toMatch(/writing is sent to OpenAI/);
  });
});
