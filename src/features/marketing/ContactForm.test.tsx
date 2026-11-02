import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ContactForm } from "./ContactForm";

afterEach(cleanup);

it("does not pretend to send messages when the mailbox is unconfigured", () => {
  render(<ContactForm email={null} />);
  expect(screen.getByRole("button", { name: "Prepare email" })).toBeDisabled();
  expect(screen.getByText(/mailbox is being confirmed/)).toBeInTheDocument();
});

it("bounds feedback and explains that the learner reviews and sends the email", () => {
  render(<ContactForm email="help@example.com" />);
  expect(screen.getByRole("button", { name: "Prepare email" })).toBeEnabled();
  const message = screen.getByRole("textbox", { name: "Message" });
  expect(message).toHaveAttribute("maxlength", "500");
  fireEvent.change(message, { target: { value: "A lesson suggestion" } });
  expect(screen.getByText(/19 \/ 500/)).toBeInTheDocument();
  expect(screen.getByText(/review and send it there/)).toBeInTheDocument();
});
