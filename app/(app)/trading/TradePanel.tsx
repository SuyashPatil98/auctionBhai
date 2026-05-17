"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  acceptTrade,
  proposeTrade,
  rejectTrade,
  withdrawTrade,
} from "./actions";

export type MemberSummary = {
  profileId: string;
  displayName: string;
  teamEmoji: string | null;
};

export type MyPlayer = {
  realPlayerId: string;
  displayName: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  acquiredAmount: number | null;
};

export type TheirPlayer = MyPlayer & {
  ownerProfileId: string;
};

export type TradeRow = {
  id: string;
  proposerId: string;
  recipientId: string;
  proposerName: string;
  recipientName: string;
  proposerPlayerName: string;
  proposerPlayerPosition: "GK" | "DEF" | "MID" | "FWD";
  recipientPlayerName: string;
  recipientPlayerPosition: "GK" | "DEF" | "MID" | "FWD";
  creditFromProposer: number;
  status: "pending" | "accepted" | "rejected" | "withdrawn" | "expired";
  message: string | null;
  proposedAt: string;
};

export default function TradePanel({
  available,
  members,
  myProfileId,
  myPlayers,
  theirPlayers,
  incoming,
  outgoing,
  recentDecided,
  acceptedThisWindow,
}: {
  available: boolean;
  members: MemberSummary[];
  myProfileId: string;
  myPlayers: MyPlayer[];
  theirPlayers: TheirPlayer[];
  incoming: TradeRow[];
  outgoing: TradeRow[];
  recentDecided: TradeRow[];
  acceptedThisWindow: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [showPropose, setShowPropose] = useState(false);

  function refresh() {
    router.refresh();
  }

  function handleAccept(t: TradeRow) {
    if (
      !confirm(
        `Accept trade: receive ${t.proposerPlayerName} (${t.proposerPlayerPosition}) ` +
          `in exchange for ${t.recipientPlayerName} (${t.recipientPlayerPosition})` +
          (t.creditFromProposer > 0
            ? ` + ${t.creditFromProposer} cr from ${t.proposerName}?`
            : t.creditFromProposer < 0
            ? ` and pay ${-t.creditFromProposer} cr to ${t.proposerName}?`
            : "?")
      )
    ) {
      return;
    }
    setError(null);
    startTransition(() => {
      acceptTrade(t.id)
        .then(refresh)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleReject(t: TradeRow) {
    const reason = prompt("Optional reason for rejecting:") ?? undefined;
    setError(null);
    startTransition(() => {
      rejectTrade(t.id, reason)
        .then(refresh)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  function handleWithdraw(t: TradeRow) {
    if (!confirm("Withdraw this trade proposal?")) return;
    setError(null);
    startTransition(() => {
      withdrawTrade(t.id)
        .then(refresh)
        .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    });
  }

  if (!available && incoming.length + outgoing.length + recentDecided.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/50 p-4">
        <h3 className="text-sm font-semibold">Trade with manager</h3>
        <p className="text-xs text-muted-foreground mt-1">
          Trading window is closed. Propose direct trades during the next
          Tuesday window — up to 2 accepted trades per manager per window.
        </p>
      </div>
    );
  }

  return (
    <section className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-sm font-semibold">Trade with manager</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Position-for-position swap with optional credit balance.
            Mutual accept. Cap: 2 accepted trades per manager per window
            (you&apos;ve accepted {acceptedThisWindow} so far).
          </p>
        </div>
        {available && (
          <button
            type="button"
            onClick={() => setShowPropose((v) => !v)}
            className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1 text-xs font-semibold transition"
          >
            {showPropose ? "Cancel propose" : "+ Propose trade"}
          </button>
        )}
      </div>

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {available && showPropose && (
        <ProposeForm
          members={members.filter((m) => m.profileId !== myProfileId)}
          myPlayers={myPlayers}
          theirPlayers={theirPlayers}
          isPending={isPending}
          onSubmitted={() => {
            setShowPropose(false);
            refresh();
          }}
          onError={setError}
          startTransition={startTransition}
        />
      )}

      {incoming.length > 0 && (
        <Block title={`Incoming · ${incoming.length}`}>
          {incoming.map((t) => (
            <TradeCard
              key={t.id}
              t={t}
              myProfileId={myProfileId}
              isPending={isPending}
              onAccept={() => handleAccept(t)}
              onReject={() => handleReject(t)}
              onWithdraw={() => handleWithdraw(t)}
            />
          ))}
        </Block>
      )}

      {outgoing.length > 0 && (
        <Block title={`Outgoing · ${outgoing.length}`}>
          {outgoing.map((t) => (
            <TradeCard
              key={t.id}
              t={t}
              myProfileId={myProfileId}
              isPending={isPending}
              onAccept={() => handleAccept(t)}
              onReject={() => handleReject(t)}
              onWithdraw={() => handleWithdraw(t)}
            />
          ))}
        </Block>
      )}

      {recentDecided.length > 0 && (
        <details className="text-xs">
          <summary className="cursor-pointer text-muted-foreground hover:text-foreground transition">
            Decided · last {recentDecided.length}
          </summary>
          <div className="mt-2 space-y-1.5">
            {recentDecided.map((t) => (
              <TradeCard
                key={t.id}
                t={t}
                myProfileId={myProfileId}
                isPending={false}
                onAccept={() => {}}
                onReject={() => {}}
                onWithdraw={() => {}}
                readonly
              />
            ))}
          </div>
        </details>
      )}

      {incoming.length + outgoing.length === 0 &&
        recentDecided.length === 0 &&
        !showPropose && (
          <p className="text-xs text-muted-foreground italic">
            No trades yet this window.
          </p>
        )}
    </section>
  );
}

// ----------------------------------------------------------------------------

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function TradeCard({
  t,
  myProfileId,
  isPending,
  onAccept,
  onReject,
  onWithdraw,
  readonly,
}: {
  t: TradeRow;
  myProfileId: string;
  isPending: boolean;
  onAccept: () => void;
  onReject: () => void;
  onWithdraw: () => void;
  readonly?: boolean;
}) {
  const amIRecipient = t.recipientId === myProfileId;
  const amIProposer = t.proposerId === myProfileId;
  const statusColor =
    t.status === "accepted"
      ? "text-emerald-600 dark:text-emerald-400"
      : t.status === "rejected"
      ? "text-destructive"
      : t.status === "withdrawn"
      ? "text-muted-foreground"
      : "text-amber-600 dark:text-amber-400";
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 space-y-1">
      <div className="flex items-center justify-between gap-2 flex-wrap text-xs">
        <div className="flex items-center gap-1.5">
          <strong>{t.proposerName}</strong>
          <span className="text-muted-foreground">→</span>
          <strong>{t.recipientName}</strong>
          <span className={`uppercase tracking-wider text-[10px] ${statusColor}`}>
            · {t.status}
          </span>
        </div>
        <span className="text-[10px] text-muted-foreground tabular-nums">
          {new Date(t.proposedAt).toLocaleString()}
        </span>
      </div>
      <div className="text-sm flex items-center gap-2 flex-wrap">
        <span className="font-medium">{t.proposerPlayerName}</span>
        <span className="text-[10px] uppercase rounded bg-muted px-1.5 py-0.5">
          {t.proposerPlayerPosition}
        </span>
        {t.creditFromProposer !== 0 && (
          <span className="text-xs text-muted-foreground">
            {t.creditFromProposer > 0
              ? `+ ${t.creditFromProposer} cr`
              : `(${-t.creditFromProposer} cr from recipient)`}
          </span>
        )}
        <span className="text-muted-foreground">↔</span>
        <span className="font-medium">{t.recipientPlayerName}</span>
        <span className="text-[10px] uppercase rounded bg-muted px-1.5 py-0.5">
          {t.recipientPlayerPosition}
        </span>
      </div>
      {t.message && (
        <p className="text-[11px] text-muted-foreground italic">
          “{t.message}”
        </p>
      )}
      {!readonly && t.status === "pending" && (
        <div className="flex items-center gap-2 pt-1">
          {amIRecipient && (
            <>
              <button
                type="button"
                disabled={isPending}
                onClick={onAccept}
                className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-2.5 py-1 text-xs font-semibold transition disabled:opacity-50"
              >
                Accept
              </button>
              <button
                type="button"
                disabled={isPending}
                onClick={onReject}
                className="rounded-md border border-border bg-card hover:bg-muted px-2.5 py-1 text-xs transition disabled:opacity-50"
              >
                Reject
              </button>
            </>
          )}
          {amIProposer && (
            <button
              type="button"
              disabled={isPending}
              onClick={onWithdraw}
              className="rounded-md border border-border bg-card hover:bg-muted px-2.5 py-1 text-xs transition disabled:opacity-50"
            >
              Withdraw
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function ProposeForm({
  members,
  myPlayers,
  theirPlayers,
  isPending,
  onSubmitted,
  onError,
  startTransition,
}: {
  members: MemberSummary[];
  myPlayers: MyPlayer[];
  theirPlayers: TheirPlayer[];
  isPending: boolean;
  onSubmitted: () => void;
  onError: (m: string | null) => void;
  startTransition: React.TransitionStartFunction;
}) {
  const [recipientId, setRecipientId] = useState<string>(
    members[0]?.profileId ?? ""
  );
  const [myPlayerId, setMyPlayerId] = useState<string>("");
  const [theirPlayerId, setTheirPlayerId] = useState<string>("");
  const [credit, setCredit] = useState<number>(0);
  const [message, setMessage] = useState<string>("");

  const mineSorted = useMemo(() => {
    return [...myPlayers].sort((a, b) =>
      a.position === b.position
        ? a.displayName.localeCompare(b.displayName)
        : a.position.localeCompare(b.position)
    );
  }, [myPlayers]);

  const myPos = myPlayers.find((p) => p.realPlayerId === myPlayerId)?.position;

  const theirsForPos = useMemo(() => {
    return theirPlayers
      .filter(
        (p) =>
          p.ownerProfileId === recipientId &&
          (myPos === undefined || p.position === myPos)
      )
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [theirPlayers, recipientId, myPos]);

  function handleSubmit() {
    onError(null);
    if (!recipientId || !myPlayerId || !theirPlayerId) {
      onError("pick a recipient, a player to offer, and a player to receive");
      return;
    }
    startTransition(() => {
      proposeTrade({
        recipientId,
        myPlayerId,
        theirPlayerId,
        creditFromProposer: credit,
        message: message.trim() || undefined,
      })
        .then(onSubmitted)
        .catch((e) => onError(e instanceof Error ? e.message : String(e)));
    });
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">Recipient</span>
          <select
            value={recipientId}
            onChange={(e) => {
              setRecipientId(e.target.value);
              setTheirPlayerId("");
            }}
            className="rounded-md border border-input bg-background px-2 py-1.5"
          >
            {members.map((m) => (
              <option key={m.profileId} value={m.profileId}>
                {m.teamEmoji ?? "👤"} {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">
            Credit transfer (+ = you pay, − = you receive)
          </span>
          <input
            type="number"
            min={-5000}
            max={5000}
            value={credit}
            onChange={(e) => setCredit(parseInt(e.target.value, 10) || 0)}
            className="rounded-md border border-input bg-background px-2 py-1.5 tabular-nums"
          />
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">
            Your player (offering)
          </span>
          <select
            value={myPlayerId}
            onChange={(e) => {
              setMyPlayerId(e.target.value);
              setTheirPlayerId("");
            }}
            className="rounded-md border border-input bg-background px-2 py-1.5"
          >
            <option value="">— pick a player —</option>
            {mineSorted.map((p) => (
              <option key={p.realPlayerId} value={p.realPlayerId}>
                {p.position} · {p.displayName}
                {p.acquiredAmount !== null && ` (${p.acquiredAmount}cr)`}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col text-xs">
          <span className="text-muted-foreground mb-1">
            Their player (asking for)
            {myPos && (
              <span className="text-[10px] ml-1">
                — must be {myPos}
              </span>
            )}
          </span>
          <select
            value={theirPlayerId}
            onChange={(e) => setTheirPlayerId(e.target.value)}
            disabled={!myPlayerId}
            className="rounded-md border border-input bg-background px-2 py-1.5 disabled:opacity-50"
          >
            <option value="">
              {myPlayerId ? "— pick a player —" : "pick yours first"}
            </option>
            {theirsForPos.map((p) => (
              <option key={p.realPlayerId} value={p.realPlayerId}>
                {p.position} · {p.displayName}
                {p.acquiredAmount !== null && ` (${p.acquiredAmount}cr)`}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="flex flex-col text-xs">
        <span className="text-muted-foreground mb-1">
          Optional message (visible to recipient)
        </span>
        <input
          type="text"
          maxLength={200}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="“Mbappé for Bellingham, you know it makes sense”"
          className="rounded-md border border-input bg-background px-2 py-1.5"
        />
      </label>
      <div className="flex items-center justify-end gap-2 pt-1">
        <button
          type="button"
          disabled={isPending || !myPlayerId || !theirPlayerId || !recipientId}
          onClick={handleSubmit}
          className="rounded-md bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 text-xs font-semibold transition disabled:opacity-50"
        >
          {isPending ? "Sending…" : "Send proposal"}
        </button>
      </div>
    </div>
  );
}
