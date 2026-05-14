import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import {
  countries,
  playerRatings,
  realPlayers,
  transfermarktPlayers,
} from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

type Params = Promise<{ id: string }>;

export default async function PlayerDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  const [row] = await db
    .select({
      id: realPlayers.id,
      fullName: realPlayers.fullName,
      displayName: realPlayers.displayName,
      position: realPlayers.position,
      shirtNumber: realPlayers.shirtNumber,
      dob: realPlayers.dob,
      club: realPlayers.club,
      photoUrl: realPlayers.photoUrl,
      countryCode: countries.code,
      countryName: countries.name,
      flagUrl: countries.flagUrl,
    })
    .from(realPlayers)
    .innerJoin(countries, eq(realPlayers.countryId, countries.id))
    .where(eq(realPlayers.id, id))
    .limit(1);

  if (!row) notFound();

  const [latestRating] = await db
    .select()
    .from(playerRatings)
    .where(eq(playerRatings.realPlayerId, id))
    .orderBy(desc(playerRatings.asOf))
    .limit(1);

  // Pull the TM record if we matched one, for richer detail (market value,
  // photo, etc.).
  let tm: typeof transfermarktPlayers.$inferSelect | null = null;
  if (latestRating?.inputs) {
    const inputs = latestRating.inputs as Record<string, unknown>;
    const match = inputs.match as
      | { tmPlayerId?: number | null }
      | undefined;
    if (match?.tmPlayerId) {
      [tm] =
        (await db
          .select()
          .from(transfermarktPlayers)
          .where(eq(transfermarktPlayers.tmPlayerId, match.tmPlayerId))
          .limit(1)) ?? [];
    }
  }

  const photo = tm?.imageUrl ?? row.photoUrl;
  const rating = latestRating ? Number(latestRating.rating) : null;
  const inputs = latestRating?.inputs as
    | {
        layer1?: {
          age: number | null;
          ageAdjustment: number;
          positionBaseline: number;
          score: number;
        };
        layer2?: {
          score: number | null;
          marketValueEur: number | null;
          logValue: number | null;
          zScore: number | null;
        };
        match?: {
          tmPlayerId: number | null;
          tmName: string | null;
          quality: "high" | "medium" | "low" | "none";
          nameSimilarity: number | null;
        };
        blend?: {
          weights: { layer1: number; layer2: number };
          preNorm: number;
        };
        final?: { afterPositionNormalization: number };
      }
    | undefined;

  return (
    <div className="space-y-8">
      <div className="flex items-start gap-6">
        {photo ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={photo}
            alt={row.displayName}
            className="w-24 h-24 rounded-full object-cover border border-border"
          />
        ) : (
          <div className="w-24 h-24 rounded-full bg-muted flex items-center justify-center text-2xl text-muted-foreground">
            {row.displayName[0]}
          </div>
        )}

        <div className="flex-1 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">
            {row.fullName}
          </h1>
          <p className="text-sm text-muted-foreground flex items-center gap-1.5">
            {row.flagUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.flagUrl} alt="" className="w-4 h-4" />
            )}
            {row.countryName} · {row.position}
            {row.shirtNumber !== null ? ` · #${row.shirtNumber}` : ""}
            {row.club ? ` · ${row.club}` : ""}
          </p>
          {row.dob && (
            <p className="text-xs text-muted-foreground">DOB: {row.dob}</p>
          )}
        </div>

        {rating !== null && (
          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Rating
            </p>
            <p className="text-4xl font-semibold tabular-nums">
              {rating.toFixed(1)}
            </p>
          </div>
        )}
      </div>

      {/* Rating breakdown */}
      {inputs && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">
            Rating breakdown
          </h2>
          <div className="rounded-lg border border-border bg-card p-4 space-y-3 text-sm">
            {inputs.layer1 && (
              <Row
                label="Layer 1 · deterministic"
                value={inputs.layer1.score.toFixed(1)}
                detail={`base ${inputs.layer1.positionBaseline} ${
                  inputs.layer1.ageAdjustment >= 0 ? "+" : ""
                }${inputs.layer1.ageAdjustment} (age ${
                  inputs.layer1.age ?? "?"
                })`}
              />
            )}
            {inputs.layer2 && (
              <Row
                label="Layer 2 · market value"
                value={
                  inputs.layer2.score !== null
                    ? inputs.layer2.score.toFixed(1)
                    : "—"
                }
                detail={
                  inputs.layer2.marketValueEur
                    ? `€${(inputs.layer2.marketValueEur / 1_000_000).toFixed(
                        1
                      )}M · z=${inputs.layer2.zScore?.toFixed(2) ?? "?"}`
                    : "no Transfermarkt match"
                }
              />
            )}
            {inputs.match && (
              <Row
                label="TM match"
                value={inputs.match.quality}
                detail={
                  inputs.match.tmName
                    ? `${inputs.match.tmName} · sim=${
                        inputs.match.nameSimilarity?.toFixed(2) ?? "?"
                      }`
                    : "—"
                }
              />
            )}
            {inputs.blend && (
              <Row
                label="Blend"
                value={inputs.blend.preNorm.toFixed(1)}
                detail={`weights: L1 ${inputs.blend.weights.layer1} / L2 ${inputs.blend.weights.layer2}`}
              />
            )}
            {inputs.final && (
              <Row
                label="After position-normalize"
                value={inputs.final.afterPositionNormalization.toFixed(1)}
                detail="final rating"
                bold
              />
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            Layer 1 is deterministic (position + age curve). Layer 2 is
            log-scale Transfermarkt market value, position-normalized. Blend
            weights depend on TM match quality. Final pass normalizes within
            position.
          </p>
        </section>
      )}

      <Link
        href="/players"
        className="text-sm text-muted-foreground hover:text-foreground transition"
      >
        ← All players
      </Link>
    </div>
  );
}

function Row({
  label,
  value,
  detail,
  bold,
}: {
  label: string;
  value: string;
  detail: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <p className={bold ? "font-medium" : ""}>{label}</p>
        <p className="text-xs text-muted-foreground">{detail}</p>
      </div>
      <p className={`tabular-nums ${bold ? "text-lg font-semibold" : ""}`}>
        {value}
      </p>
    </div>
  );
}
