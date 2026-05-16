"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { changePassword, updateProfile } from "./actions";

type InitialProfile = {
  handle: string;
  displayName: string;
  teamName: string | null;
  teamEmoji: string | null;
};

export default function AccountForms({
  initialProfile,
}: {
  initialProfile: InitialProfile;
}) {
  return (
    <div className="space-y-8">
      <ProfileForm initial={initialProfile} />
      <PasswordForm />
    </div>
  );
}

function ProfileForm({ initial }: { initial: InitialProfile }) {
  const router = useRouter();
  const [handle, setHandle] = useState(initial.handle);
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [teamName, setTeamName] = useState(initial.teamName ?? "");
  const [teamEmoji, setTeamEmoji] = useState(initial.teamEmoji ?? "");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { kind: "ok" | "error"; msg: string } | null
  >(null);

  const dirty =
    handle !== initial.handle ||
    displayName !== initial.displayName ||
    teamName !== (initial.teamName ?? "") ||
    teamEmoji !== (initial.teamEmoji ?? "");

  function handleSave() {
    setFeedback(null);
    const fd = new FormData();
    fd.append("handle", handle);
    fd.append("display_name", displayName);
    fd.append("team_name", teamName);
    fd.append("team_emoji", teamEmoji);
    startTransition(() => {
      updateProfile(fd)
        .then(() => {
          setFeedback({ kind: "ok", msg: "Saved." });
          router.refresh();
        })
        .catch((e) =>
          setFeedback({ kind: "error", msg: String(e.message ?? e) })
        );
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Profile
        </h2>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Display name *" hint="Shown in the draft room and on your /team page.">
          <input
            type="text"
            value={displayName}
            disabled={isPending}
            maxLength={40}
            onChange={(e) => setDisplayName(e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Handle" hint="lowercase letters, numbers, _, -. Public.">
          <input
            type="text"
            value={handle}
            disabled={isPending}
            maxLength={32}
            onChange={(e) => setHandle(e.target.value)}
            className={`${inputCls} font-mono`}
          />
        </Field>

        <Field label="Team name" hint="Optional; appears next to your name.">
          <input
            type="text"
            value={teamName}
            disabled={isPending}
            maxLength={40}
            placeholder="e.g. The Inevitables"
            onChange={(e) => setTeamName(e.target.value)}
            className={inputCls}
          />
        </Field>

        <Field label="Team emoji" hint="Single emoji, used everywhere as your avatar.">
          <input
            type="text"
            value={teamEmoji}
            disabled={isPending}
            maxLength={8}
            placeholder="⚡"
            onChange={(e) => setTeamEmoji(e.target.value)}
            className={`${inputCls} text-center text-lg`}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <button
          type="button"
          disabled={isPending || !dirty || !displayName.trim()}
          onClick={handleSave}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 text-sm font-semibold transition-all hover:scale-[1.03] hover:shadow-md hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
        >
          {isPending ? "Saving…" : "Save profile"}
        </button>
        {dirty && !isPending && (
          <button
            type="button"
            onClick={() => {
              setHandle(initial.handle);
              setDisplayName(initial.displayName);
              setTeamName(initial.teamName ?? "");
              setTeamEmoji(initial.teamEmoji ?? "");
              setFeedback(null);
            }}
            className="text-xs text-muted-foreground hover:text-foreground transition"
          >
            Discard changes
          </button>
        )}
        {feedback && (
          <p
            className={`text-xs rounded-md px-2.5 py-1 ${
              feedback.kind === "ok"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive border border-destructive/30"
            }`}
          >
            {feedback.msg}
          </p>
        )}
      </div>

      {/* Preview */}
      <div className="rounded-md border border-border bg-background p-3 flex items-center gap-3">
        <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-2xl ring-2 ring-border">
          {teamEmoji || "👤"}
        </div>
        <div className="min-w-0">
          <p className="font-medium truncate">
            {displayName || <span className="text-muted-foreground">No display name</span>}
          </p>
          <p className="text-xs text-muted-foreground truncate">
            {teamName || <span className="italic">no team name</span>} ·{" "}
            <span className="font-mono">@{handle || "—"}</span>
          </p>
        </div>
      </div>
    </section>
  );
}

function PasswordForm() {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isPending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<
    { kind: "ok" | "error"; msg: string } | null
  >(null);

  const valid =
    newPassword.length >= 8 &&
    newPassword === confirmPassword;

  function handleChange() {
    setFeedback(null);
    const fd = new FormData();
    fd.append("new_password", newPassword);
    fd.append("confirm_password", confirmPassword);
    startTransition(() => {
      changePassword(fd)
        .then(() => {
          setFeedback({ kind: "ok", msg: "Password updated." });
          setNewPassword("");
          setConfirmPassword("");
        })
        .catch((e) =>
          setFeedback({ kind: "error", msg: String(e.message ?? e) })
        );
    });
  }

  return (
    <section className="rounded-lg border border-border bg-card p-5 space-y-4">
      <div>
        <h2 className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          Password
        </h2>
        <p className="text-xs text-muted-foreground mt-1">
          At least 8 characters. You stay signed in after changing.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="New password">
          <input
            type="password"
            value={newPassword}
            disabled={isPending}
            autoComplete="new-password"
            minLength={8}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="At least 8 characters"
            className={inputCls}
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            value={confirmPassword}
            disabled={isPending}
            autoComplete="new-password"
            minLength={8}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="Same as above"
            className={inputCls}
          />
        </Field>
      </div>

      <div className="flex items-center gap-3 pt-2 border-t border-border">
        <button
          type="button"
          disabled={!valid || isPending}
          onClick={handleChange}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-1.5 text-sm font-semibold transition-all hover:scale-[1.03] hover:shadow-md hover:shadow-emerald-500/30 active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/50"
        >
          {isPending ? "Updating…" : "Update password"}
        </button>
        {newPassword && newPassword.length < 8 && (
          <p className="text-xs text-muted-foreground">
            {8 - newPassword.length} more character
            {8 - newPassword.length === 1 ? "" : "s"} needed
          </p>
        )}
        {newPassword &&
          confirmPassword &&
          newPassword !== confirmPassword && (
            <p className="text-xs text-destructive">passwords don&apos;t match</p>
          )}
        {feedback && (
          <p
            className={`text-xs rounded-md px-2.5 py-1 ${
              feedback.kind === "ok"
                ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                : "bg-destructive/10 text-destructive border border-destructive/30"
            }`}
          >
            {feedback.msg}
          </p>
        )}
      </div>
    </section>
  );
}

const inputCls =
  "w-full rounded-md border border-input bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && (
        <span className="block text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}
