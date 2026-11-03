import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { LoginForm } from "./login-form";
import { loginMessages } from "./messages";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const actions = vi.hoisted(() => ({
  signIn: vi.fn(),
  signUp: vi.fn(),
  signInWithForm: vi.fn(),
  signUpWithForm: vi.fn(),
}));
vi.mock("./actions", () => actions);
vi.mock("@/components/toast", () => ({ toastResult: vi.fn() }));

beforeEach(() => vi.clearAllMocks());

describe("LoginForm", () => {
  it("asks for an email and a password, and checks them before calling the server", async () => {
    render(<LoginForm />);
    expect(screen.getByLabelText("Email")).toHaveFocus();
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent(loginMessages.noEmail);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(screen.getByRole("alert")).toHaveTextContent(loginMessages.empty);
    expect(actions.signIn).not.toHaveBeenCalled();
  });

  it("signs in and goes on to the next page", async () => {
    actions.signIn.mockResolvedValue({ ok: true, data: { redirectTo: "/jobs" } });
    render(<LoginForm next="/jobs" />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(actions.signIn).toHaveBeenCalledWith({ email: "asha@example.com", password: "correct horse battery", remember: true, next: "/jobs" });
    expect(replace).toHaveBeenCalledWith("/jobs");
  });

  it("shows the server's error, and clears it when typing again", async () => {
    actions.signIn.mockResolvedValue({ ok: false, error: loginMessages.wrong });
    render(<LoginForm />);
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "nope");
    await userEvent.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(loginMessages.wrong);
    await userEvent.type(screen.getByLabelText("Password"), "x");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("creates an account with a name, and asks for the invite code only when needed", async () => {
    actions.signUp.mockResolvedValue({ ok: true, data: { redirectTo: "/" } });
    const { rerender } = render(<LoginForm mode="signup" />);
    expect(screen.queryByLabelText("Invite code")).toBeNull();
    rerender(<LoginForm mode="signup" inviteRequired />);
    await userEvent.type(screen.getByLabelText("Your name"), "Asha Rao");
    await userEvent.type(screen.getByLabelText("Email"), "asha@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "correct horse battery");
    await userEvent.type(screen.getByLabelText("Invite code"), "team-2026");
    await userEvent.click(screen.getByRole("button", { name: "Create account" }));
    expect(actions.signUp).toHaveBeenCalledWith({ name: "Asha Rao", email: "asha@example.com", password: "correct horse battery", invite: "team-2026" });
    expect(replace).toHaveBeenCalledWith("/");
  });
});
