import { redirect } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  auctionLots,
  auditLog,
  countries,
  drafts,
  leagueMembers,
  leagues,
  profiles,
  realPlayers,
} from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import {
  addMember,
  manualAwardLot,
  pauseDraft,
  removeMember,
  resetDraft,
  resumeDraft,
  updateDraftSettings,
  voidLot,
} from "./actions";
import Link from "next/link";
import { notInArray } from "drizzle-orm";

export const dynamic = "force-dynamic";

export const metadata = { title: "Draft admin · FiFantasy" };

export default async function DraftAdminPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const [league] = await db.select().from(leagues).limit(1);
  if (!league) return <p>No league.</p>;
  const [d] = await db
    .select()
    .from(drafts)
    .where(eq(drafts.leagueId, league.id))
    .limit(1);
  if (!d) return <p>No draft.</p>;

  const members = await db
    .select({
      profileId: leagueMembers.profileId,
      displayName: profiles.displayName,
      teamEmoji: profiles.teamEmoji,
      teamName: profiles.teamName,
      nominationOrder: leagueMembers.nominationOrder,
    })
    .from(leagueMembers)
    .innerJoin(profiles, eq(profiles.id, leagueMembers.profileId))
    .where(eq(leagueMembers.leagueId, league.id))
    .orderBy(asc(leagueMembers.nominationOrder));

  // Profiles that exist but aren't in the league — candidates to re-add.
  const memberIds = members.map((m) => m.profileId);
  const availableProfiles =
    memberIds.length > 0
      ? await db
          .select({
            id: profiles.id,
            displayName: profiles.displayName,
            teamEmoji: profiles.teamEmoji,
            teamName: profiles.teamName,
          })
          .from(profiles)
          .where(notInArray(profiles.id, memberIds))
          .orderBy(asc(profiles.displayName))
      : await db
          .select({
            id: profiles.id,
            displayName: profiles.displayName,
            teamEmoji: profiles.teamEmoji,
            teamName: profiles.teamName,
          })
          .from(profiles)
          .orderBy(asc(profiles.displayName));

  let currentLot:
    | (typeof auctionLots.$inferSelect & {
        playerName: string;
        countryName: string;
      })
    | null = null;
  if (d.currentLotId) {
    const [row] = await db
      .select({
        lot: auctionLots,
        playerName: realPlayers.displayName,
        countryName: countries.name,
      })
      .from(auctionLots)
      .innerJoin(realPlayers, eq(realPlayers.id, auctionLots.realPlayerId))
      .innerJoin(countries, eq(countries.id, realPlayers.countryId))
      .where(eq(auctionLots.id, d.currentLotId))
      .limit(1);
    if (row) {
      currentLot = {
        ...row.lot,
        playerName: row.playerName,
        countryName: row.countryName,
      };
    }
  }

  const recentAudit = await db
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.createdAt))
    .limit(15);

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Draft admin
        </h1>
        <p className="text-sm text-muted-foreground">
          Draft <code className="text-xs">{d.id.slice(0, 8)}</code> · status{" "}
          <strong>{d.status}</strong>
          {d.status === "paused" && d.pausedAt && (
            <> · paused at {new Date(d.pausedAt).toLocaleTimeString()}</>
          )}
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Every action below is logged to <code>audit_log</code>. For 4
          friends, that&apos;s the dispute-resolution mechanism.
        </p>
      </div>

      <Section title="Draft settings">
        {d.status === "scheduled" ? (
          <form
            action={updateDraftSettings}
            className="grid gap-3 sm:grid-cols-2"
          >
            <input type="hidden" name="draft_id" value={d.id} />
            <label className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-1">
                Budget per manager (credits)
              </span>
              <input
                type="number"
                name="budget"
                min={50}
                max={10000}
                defaultValue={d.budgetPerManager}
                required
                className="rounded-md border border-input bg-background px-3 py-1.5 tabular-nums"
              />
            </label>
            <label className="flex flex-col">
              <span className="text-xs text-muted-foreground mb-1">
                Roster size (players)
              </span>
              <input
                type="number"
                name="roster_size"
                min={11}
                max={30}
                defaultValue={d.rosterSize}
                required
                className="rounded-md border border-input bg-background px-3 py-1.5 tabular-nums"
              />
            </label>
            <fieldset className="sm:col-span-2 border border-border rounded-md p-3">
              <legend className="text-xs text-muted-foreground px-1">
                Position quotas (must sum to roster size)
              </legend>
              <div className="grid grid-cols-4 gap-2">
                {(["gk", "def", "mid", "fwd"] as const).map((k) => {
                  const reqs = d.rosterRequirements as Record<string, number>;
                  return (
                    <label key={k} className="flex flex-col">
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {k}
                      </span>
                      <input
                        type="number"
                        name={`req_${k}`}
                        min={0}
                        max={20}
                        defaultValue={reqs[k.toUpperCase()] ?? 0}
                        required
                        className="rounded-md border border-input bg-background px-2 py-1 tabular-nums text-sm"
                      />
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <div className="sm:col-span-2 flex justify-end">
              <button type="submit" className={btn("emerald")}>
                Save settings
              </button>
            </div>
          </form>
        ) : (
          <div className="text-sm text-muted-foreground space-y-1">
            <p>
              Settings are locked once the draft leaves{" "}
              <code>scheduled</code> state.
            </p>
            <ul className="text-xs space-y-0.5">
              <li>
                · Budget per manager: <strong>{d.budgetPerManager}</strong> cr
              </li>
              <li>
                · Roster size: <strong>{d.rosterSize}</strong> players
              </li>
              <li>
                · Quotas:{" "}
                <code>
                  {JSON.stringify(d.rosterRequirements)}
                </code>
              </li>
            </ul>
          </div>
        )}
      </Section>

      <Section title="Pause / Resume">
        <div className="flex gap-2">
          <form action={pauseDraft}>
            <input type="hidden" name="draft_id" value={d.id} />
            <button
              type="submit"
              disabled={d.status !== "live"}
              className={btn("amber")}
            >
              Pause draft
            </button>
          </form>
          <form action={resumeDraft}>
            <input type="hidden" name="draft_id" value={d.id} />
            <button
              type="submit"
              disabled={d.status !== "paused"}
              className={btn("emerald")}
            >
              Resume draft
            </button>
          </form>
        </div>
      </Section>

      {currentLot && (
        <>
          <Section title="Current lot controls">
            <p className="text-sm text-muted-foreground">
              <strong>{currentLot.playerName}</strong> ({currentLot.countryName}){" "}
              · current bid {currentLot.currentBid} · status{" "}
              <code>{currentLot.status}</code>
            </p>
          </Section>

          <Section title="Void current lot">
            <form action={voidLot} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="lot_id" value={currentLot.id} />
              <label className="flex flex-col flex-1 min-w-[12rem]">
                <span className="text-xs text-muted-foreground mb-1">
                  Reason (audit-logged)
                </span>
                <input
                  type="text"
                  name="reason"
                  placeholder="misclick / disconnect / etc."
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                />
              </label>
              <button type="submit" className={btn("rose")}>
                Void
              </button>
            </form>
            <p className="text-xs text-muted-foreground mt-2">
              Returns the player to the pool. No budget or roster change.
              Current nominator picks again.
            </p>
          </Section>

          <Section title="Manual award (use sparingly)">
            <form
              action={manualAwardLot}
              className="grid sm:grid-cols-[1fr_auto_auto] gap-2 items-end"
            >
              <input type="hidden" name="lot_id" value={currentLot.id} />
              <label className="flex flex-col">
                <span className="text-xs text-muted-foreground mb-1">
                  Award to
                </span>
                <select
                  name="winner_id"
                  className="rounded-md border border-input bg-background px-3 py-1.5 text-sm"
                  required
                >
                  {members.map((m) => (
                    <option key={m.profileId} value={m.profileId}>
                      {m.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col">
                <span className="text-xs text-muted-foreground mb-1">
                  Price
                </span>
                <input
                  type="number"
                  name="amount"
                  defaultValue={currentLot.currentBid}
                  min={1}
                  className="rounded-md border border-input bg-background px-3 py-1.5 w-24 tabular-nums text-sm"
                />
              </label>
              <button type="submit" className={btn("amber")}>
                Force-award
              </button>
            </form>
            <p className="text-xs text-muted-foreground mt-2">
              Sets the lot as sold to the chosen manager at the chosen price.
              Roster + budget update via trigger. Use when the timer broke,
              a disconnect cost someone fairly, or you need to unstick the draft.
            </p>
          </Section>
        </>
      )}

      <Section title="League members">
        {d.status !== "scheduled" && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mb-3">
            Membership is locked because the draft is{" "}
            <code>{d.status}</code>. Reset the draft below if you really need
            to change membership.
          </p>
        )}

        {members.length === 0 ? (
          <p className="text-sm text-muted-foreground italic">
            No members in the league yet.
          </p>
        ) : (
          <div className="space-y-2">
            {members.map((m) => (
              <div
                key={m.profileId}
                className="flex items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2"
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-lg shrink-0 ring-1 ring-border">
                    {m.teamEmoji ?? "👤"}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">
                      {m.displayName}
                      <span className="ml-1.5 text-xs text-muted-foreground font-normal">
                        #{m.nominationOrder}
                      </span>
                    </p>
                    {m.teamName && (
                      <p className="text-xs text-muted-foreground truncate">
                        {m.teamName}
                      </p>
                    )}
                  </div>
                </div>
                <form action={removeMember}>
                  <input
                    type="hidden"
                    name="profile_id"
                    value={m.profileId}
                  />
                  <button
                    type="submit"
                    disabled={d.status !== "scheduled"}
                    title={
                      d.status === "scheduled"
                        ? `Remove ${m.displayName} from the league`
                        : "Locked while draft is running"
                    }
                    className="group rounded-full w-8 h-8 flex items-center justify-center border border-border bg-background text-muted-foreground transition-all hover:border-rose-500/50 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 hover:scale-110 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:bg-background disabled:hover:border-border disabled:hover:text-muted-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40"
                  >
                    <span className="text-lg leading-none transition-transform group-hover:rotate-90">
                      ×
                    </span>
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        {availableProfiles.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
              Available to add ({availableProfiles.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {availableProfiles.map((p) => (
                <form key={p.id} action={addMember}>
                  <input type="hidden" name="profile_id" value={p.id} />
                  <button
                    type="submit"
                    disabled={d.status !== "scheduled"}
                    className="group inline-flex items-center gap-2 rounded-full border border-border bg-background px-3 py-1.5 text-sm transition-all hover:border-emerald-500/50 hover:bg-emerald-500/10 hover:text-emerald-600 dark:hover:text-emerald-400 hover:scale-105 active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/40"
                  >
                    <span>{p.teamEmoji ?? "👤"}</span>
                    <span>{p.displayName}</span>
                    <span className="text-lg leading-none transition-transform group-hover:rotate-90">
                      +
                    </span>
                  </button>
                </form>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              These profiles exist but aren&apos;t in the league. Click + to
              add them back; they get the next nomination order.
            </p>
          </div>
        )}
      </Section>

      <Section title="Reset draft (destructive)">
        <form action={resetDraft} className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="draft_id" value={d.id} />
          <label className="flex flex-col">
            <span className="text-xs text-muted-foreground mb-1">
              Type RESET to confirm
            </span>
            <input
              type="text"
              name="confirm"
              placeholder="RESET"
              className="rounded-md border border-input bg-background px-3 py-1.5 text-sm w-32"
            />
          </label>
          <button type="submit" className={btn("rose")}>
            Reset everything
          </button>
        </form>
        <p className="text-xs text-muted-foreground mt-2">
          Wipes all lots, bids, proxies, budgets, and auction-acquired rosters
          for this league. Sets the draft back to <code>scheduled</code>.
          Use this only for dry-runs.
        </p>
      </Section>

      <Section title="Recent audit log">
        {recentAudit.length === 0 ? (
          <p className="text-sm text-muted-foreground">No admin actions yet.</p>
        ) : (
          <div className="rounded-lg border border-border overflow-x-auto">
            <table className="w-full min-w-[480px] text-xs">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-2 py-1.5">When</th>
                  <th className="text-left px-2 py-1.5">Action</th>
                  <th className="text-left px-2 py-1.5">Entity</th>
                </tr>
              </thead>
              <tbody>
                {recentAudit.map((a) => (
                  <tr key={a.id} className="border-t border-border">
                    <td className="px-2 py-1.5 tabular-nums">
                      {new Date(a.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1.5">{a.action}</td>
                    <td className="px-2 py-1.5 text-muted-foreground">
                      {a.entity}{" "}
                      {a.entityId && (
                        <code className="text-[10px]">
                          {a.entityId.slice(0, 8)}
                        </code>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Link
        href="/draft"
        className="inline-block text-sm text-muted-foreground hover:text-foreground transition"
      >
        ← Back to draft
      </Link>
    </div>
  );
}

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-4 space-y-2">
      <h2 className="text-xs uppercase tracking-widest text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

function btn(tone: "amber" | "rose" | "emerald") {
  const styles: Record<typeof tone, string> = {
    amber:
      "bg-amber-500 hover:bg-amber-400 text-white focus-visible:ring-amber-400/50 shadow-amber-500/20",
    rose:
      "bg-rose-500 hover:bg-rose-400 text-white focus-visible:ring-rose-400/50 shadow-rose-500/20",
    emerald:
      "bg-emerald-500 hover:bg-emerald-400 text-white focus-visible:ring-emerald-400/50 shadow-emerald-500/20",
  };
  return `rounded-md px-3 py-1.5 text-sm font-semibold transition-all hover:scale-[1.02] hover:shadow-lg active:scale-95 focus:outline-none focus-visible:ring-2 disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-none ${styles[tone]}`;
}
