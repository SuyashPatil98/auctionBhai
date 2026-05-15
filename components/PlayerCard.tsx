import Link from "next/link";

/**
 * FIFA-style player card. CSS-only, no images beyond what we already have
 * in the DB. Used wherever we want a visual block instead of a table row:
 * /players (grid view), /team, /draft current-lot hero, /players/[id] hero.
 *
 * Variants:
 *   - "full" (default): big hero, ~280×360. /players/[id], /draft.
 *   - "grid": medium, ~200×260. /players grid + /team rows.
 *   - "mini": compact horizontal, ~360×100. Roster lists, embedded contexts.
 *
 * The color palette is driven by `tier` (auction price tier), which already
 * encodes "how good is this player" in our model. Position adds a subtle
 * accent line on the corner. Country flag floats top-right.
 */

export type PlayerCardData = {
  id: string;
  displayName: string;
  fullName?: string;
  position: "GK" | "DEF" | "MID" | "FWD";
  rating?: number | null;
  price?: number | null;
  tier?: string | null; // "superstar" | "star" | "starter" | "rotation" | "depth"
  countryName: string;
  countryCode?: string | null;
  flagUrl?: string | null;
  club?: string | null;
  photoUrl?: string | null;
  shirtNumber?: number | null;
};

type Variant = "full" | "grid" | "mini";

const TIER_GRADIENT: Record<string, string> = {
  superstar:
    "bg-gradient-to-br from-rose-500 via-rose-400 to-amber-400 text-rose-950",
  star: "bg-gradient-to-br from-amber-500 via-amber-400 to-yellow-300 text-amber-950",
  starter:
    "bg-gradient-to-br from-emerald-600 via-emerald-500 to-teal-400 text-emerald-950",
  rotation:
    "bg-gradient-to-br from-sky-600 via-sky-500 to-cyan-400 text-sky-950",
  depth: "bg-gradient-to-br from-slate-600 via-slate-500 to-zinc-400 text-zinc-50",
};

const TIER_RING: Record<string, string> = {
  superstar: "ring-rose-400/40",
  star: "ring-amber-400/40",
  starter: "ring-emerald-400/40",
  rotation: "ring-sky-400/40",
  depth: "ring-slate-400/40",
};

const POSITION_TONE: Record<string, string> = {
  GK: "bg-amber-950/70 text-amber-100",
  DEF: "bg-sky-950/70 text-sky-100",
  MID: "bg-emerald-950/70 text-emerald-100",
  FWD: "bg-rose-950/70 text-rose-100",
};

function fallbackGradient() {
  // Active but unpriced (no rating yet) — neutral
  return "bg-gradient-to-br from-zinc-700 via-zinc-600 to-zinc-500 text-zinc-50";
}

export function PlayerCard({
  player,
  variant = "full",
  href,
}: {
  player: PlayerCardData;
  variant?: Variant;
  href?: string;
}) {
  const gradient = player.tier
    ? TIER_GRADIENT[player.tier] ?? fallbackGradient()
    : fallbackGradient();
  const ring = player.tier
    ? TIER_RING[player.tier] ?? "ring-zinc-400/40"
    : "ring-zinc-400/40";

  const body =
    variant === "mini" ? (
      <MiniBody player={player} gradient={gradient} ring={ring} />
    ) : variant === "grid" ? (
      <GridBody player={player} gradient={gradient} ring={ring} />
    ) : (
      <FullBody player={player} gradient={gradient} ring={ring} />
    );

  const linkHref = href ?? `/players/${player.id}`;
  return (
    <Link
      href={linkHref}
      className="block transition-transform hover:-translate-y-0.5 hover:shadow-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-foreground rounded-2xl"
    >
      {body}
    </Link>
  );
}

// ============================================================================
// FULL — hero card
// ============================================================================

function FullBody({
  player,
  gradient,
  ring,
}: {
  player: PlayerCardData;
  gradient: string;
  ring: string;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-2xl ${gradient} p-5 shadow-md ring-1 ${ring} aspect-[5/7] flex flex-col`}
    >
      {/* Top row: rating + flag + tier */}
      <div className="flex items-start justify-between gap-2">
        <div className="text-left">
          <div className="text-5xl font-black leading-none tabular-nums tracking-tight">
            {player.rating !== null && player.rating !== undefined
              ? Math.round(player.rating)
              : "—"}
          </div>
          <div
            className={`mt-1 inline-block rounded px-1.5 py-0.5 text-[10px] uppercase tracking-widest font-semibold ${POSITION_TONE[player.position] ?? "bg-black/40 text-white"}`}
          >
            {player.position}
          </div>
          {player.tier && (
            <div className="mt-1 text-[10px] uppercase tracking-widest opacity-80 font-medium">
              {player.tier}
            </div>
          )}
        </div>
        <div className="text-right">
          {player.flagUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.flagUrl}
              alt=""
              className="w-10 h-10 rounded-sm shadow-sm ring-1 ring-black/10"
            />
          ) : (
            <div className="text-[10px] font-semibold opacity-70">
              {player.countryCode ?? player.countryName.slice(0, 3).toUpperCase()}
            </div>
          )}
        </div>
      </div>

      {/* Center: portrait */}
      <div className="flex-1 flex items-center justify-center my-3">
        {player.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.photoUrl}
            alt={player.displayName}
            className="w-32 h-32 rounded-full object-cover ring-2 ring-white/40 shadow-md"
          />
        ) : (
          <div className="w-32 h-32 rounded-full bg-black/15 flex items-center justify-center text-5xl font-black ring-2 ring-white/30">
            {player.displayName[0]}
          </div>
        )}
      </div>

      {/* Bottom: name + meta */}
      <div className="text-center">
        <p className="text-lg font-bold leading-tight uppercase tracking-wider">
          {player.displayName}
        </p>
        <p className="text-xs opacity-80 mt-1 flex items-center justify-center gap-1.5">
          {player.club && (
            <>
              <span className="truncate max-w-[140px]">{player.club}</span>
              <span className="opacity-50">·</span>
            </>
          )}
          <span>{player.countryName}</span>
        </p>
        {player.price !== null && player.price !== undefined && (
          <div className="mt-3 inline-flex items-baseline gap-1 rounded-full bg-black/20 px-3 py-1 text-sm font-semibold">
            <span>{player.price}</span>
            <span className="text-[10px] uppercase tracking-widest opacity-70">
              cr
            </span>
          </div>
        )}
      </div>

      {/* Position accent strip */}
      <div
        className={`absolute bottom-0 left-0 right-0 h-1 ${
          player.position === "GK"
            ? "bg-amber-400"
            : player.position === "DEF"
            ? "bg-sky-400"
            : player.position === "MID"
            ? "bg-emerald-400"
            : "bg-rose-400"
        }`}
      />
    </article>
  );
}

// ============================================================================
// GRID — medium card for /players + /team grids
// ============================================================================

function GridBody({
  player,
  gradient,
  ring,
}: {
  player: PlayerCardData;
  gradient: string;
  ring: string;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-2xl ${gradient} p-3 shadow-md ring-1 ${ring} aspect-[5/7] flex flex-col`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-3xl font-black leading-none tabular-nums">
            {player.rating !== null && player.rating !== undefined
              ? Math.round(player.rating)
              : "—"}
          </div>
          <div
            className={`mt-1 inline-block rounded px-1 py-0.5 text-[9px] uppercase tracking-wider font-semibold ${POSITION_TONE[player.position] ?? "bg-black/40 text-white"}`}
          >
            {player.position}
          </div>
        </div>
        <div>
          {player.flagUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.flagUrl}
              alt=""
              className="w-6 h-6 rounded-sm ring-1 ring-black/10"
            />
          ) : null}
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center my-2">
        {player.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.photoUrl}
            alt={player.displayName}
            className="w-20 h-20 rounded-full object-cover ring-2 ring-white/40"
          />
        ) : (
          <div className="w-20 h-20 rounded-full bg-black/15 flex items-center justify-center text-3xl font-black ring-2 ring-white/30">
            {player.displayName[0]}
          </div>
        )}
      </div>

      <div className="text-center">
        <p className="text-sm font-bold leading-tight uppercase tracking-wide truncate">
          {player.displayName}
        </p>
        <p className="text-[10px] opacity-80 mt-0.5 truncate">
          {player.countryName}
        </p>
        {player.price !== null && player.price !== undefined && (
          <div className="mt-1.5 inline-flex items-baseline gap-0.5 rounded-full bg-black/20 px-2 py-0.5 text-xs font-semibold">
            {player.price}
            <span className="text-[8px] uppercase tracking-widest opacity-70 ml-0.5">
              cr
            </span>
          </div>
        )}
      </div>
    </article>
  );
}

// ============================================================================
// MINI — horizontal compact row
// ============================================================================

function MiniBody({
  player,
  gradient,
  ring,
}: {
  player: PlayerCardData;
  gradient: string;
  ring: string;
}) {
  return (
    <article
      className={`relative overflow-hidden rounded-xl ${gradient} p-2.5 shadow-sm ring-1 ${ring} flex items-center gap-3`}
    >
      {player.photoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={player.photoUrl}
          alt={player.displayName}
          className="w-14 h-14 rounded-full object-cover ring-2 ring-white/40 shrink-0"
        />
      ) : (
        <div className="w-14 h-14 rounded-full bg-black/15 flex items-center justify-center text-xl font-black ring-2 ring-white/30 shrink-0">
          {player.displayName[0]}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-2xl font-black tabular-nums leading-none">
            {player.rating !== null && player.rating !== undefined
              ? Math.round(player.rating)
              : "—"}
          </span>
          <span
            className={`rounded px-1 py-0.5 text-[9px] uppercase font-semibold tracking-wider ${POSITION_TONE[player.position] ?? "bg-black/40 text-white"}`}
          >
            {player.position}
          </span>
        </div>
        <p className="text-sm font-bold mt-1 truncate">{player.displayName}</p>
        <p className="text-[10px] opacity-80 truncate">
          {player.club && `${player.club} · `}
          {player.countryName}
        </p>
      </div>
      <div className="text-right shrink-0">
        {player.price !== null && player.price !== undefined && (
          <div className="rounded bg-black/20 px-2 py-0.5 text-xs font-bold">
            {player.price}cr
          </div>
        )}
        {player.flagUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={player.flagUrl}
            alt=""
            className="w-5 h-5 mt-1 rounded-sm ring-1 ring-black/10 inline-block"
          />
        )}
      </div>
    </article>
  );
}
