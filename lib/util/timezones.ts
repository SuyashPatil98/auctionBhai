/**
 * Curated IANA timezone list for the /account picker.
 *
 * The full IANA registry is ~600 zones — overkill for a 4-friend app
 * spread across IN / UK / and the occasional traveller. We surface a
 * useful subset alphabetised by city, plus "auto" which renders in
 * whatever the user's browser reports.
 *
 * Validation against this list is enforced server-side in
 * app/(app)/account/actions.ts. Sending an unknown string returns an
 * error rather than silently storing garbage.
 */

export type TimezoneChoice = {
  /** IANA identifier. Empty string = auto (browser-detected). */
  value: string;
  /** Human label shown in the dropdown. */
  label: string;
};

export const TIMEZONE_CHOICES: TimezoneChoice[] = [
  { value: "", label: "Auto (browser)" },

  // India
  { value: "Asia/Kolkata", label: "India — Kolkata / Mumbai (IST, +05:30)" },

  // UK / Europe
  { value: "Europe/London", label: "United Kingdom — London (GMT/BST)" },
  { value: "Europe/Dublin", label: "Ireland — Dublin (GMT/IST)" },
  { value: "Europe/Paris", label: "France — Paris (CET/CEST)" },
  { value: "Europe/Berlin", label: "Germany — Berlin (CET/CEST)" },
  { value: "Europe/Madrid", label: "Spain — Madrid (CET/CEST)" },
  { value: "Europe/Lisbon", label: "Portugal — Lisbon (WET/WEST)" },

  // Americas
  { value: "America/New_York", label: "USA — New York (EST/EDT)" },
  { value: "America/Chicago", label: "USA — Chicago (CST/CDT)" },
  { value: "America/Denver", label: "USA — Denver (MST/MDT)" },
  { value: "America/Los_Angeles", label: "USA — Los Angeles (PST/PDT)" },
  { value: "America/Toronto", label: "Canada — Toronto (EST/EDT)" },
  { value: "America/Mexico_City", label: "Mexico — Mexico City (CST/CDT)" },
  { value: "America/Sao_Paulo", label: "Brazil — São Paulo (BRT)" },
  { value: "America/Buenos_Aires", label: "Argentina — Buenos Aires (ART)" },

  // Middle East / Africa
  { value: "Asia/Dubai", label: "UAE — Dubai (GST, +04:00)" },
  { value: "Africa/Lagos", label: "Nigeria — Lagos (WAT, +01:00)" },
  { value: "Africa/Johannesburg", label: "South Africa — Johannesburg (SAST)" },

  // Asia-Pacific
  { value: "Asia/Singapore", label: "Singapore (SGT, +08:00)" },
  { value: "Asia/Hong_Kong", label: "Hong Kong (HKT, +08:00)" },
  { value: "Asia/Tokyo", label: "Japan — Tokyo (JST, +09:00)" },
  { value: "Asia/Seoul", label: "South Korea — Seoul (KST, +09:00)" },
  { value: "Australia/Sydney", label: "Australia — Sydney (AEST/AEDT)" },
  { value: "Australia/Perth", label: "Australia — Perth (AWST, +08:00)" },
  { value: "Pacific/Auckland", label: "New Zealand — Auckland (NZST/NZDT)" },

  // Anchor
  { value: "UTC", label: "UTC (no offset)" },
];

/** True if value is in our known list (empty string allowed). */
export function isKnownTimezone(value: string): boolean {
  return TIMEZONE_CHOICES.some((c) => c.value === value);
}
