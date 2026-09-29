import {
  resolveSiteContent,
  resolveSiteContentToday,
} from "./site-content-source";
import type { SiteContent, SiteEvent } from "./site-content-schema";

export type DisplayConference = {
  name: string;
  location: string;
  date: string;
  href: string;
  role?: string;
};

export type ClassifiedConferences = Record<
  "upcoming" | "recent",
  DisplayConference[]
>;

/**
 * The active request's site content, or the build-time default.
 *
 * The static build reads this with no request override in effect, so it sees
 * the packaged default and bakes it. The request-time renderer sets an override
 * (see `site-content-source.ts`) so the same call returns the content it read
 * from S3, without any reader having to know which caller it is serving.
 */
export function getSiteContent(): SiteContent {
  return resolveSiteContent();
}

/** The active request's events, classified into upcoming and recent. */
export function getConferences(): ClassifiedConferences {
  return classifyEvents(getSiteContent().events, resolveSiteContentToday());
}

export function formatIsoDate(value: string): string {
  return dateParts(value).full;
}

function classifyEvents(
  events: SiteEvent[],
  today: string,
): ClassifiedConferences {
  const projected = events.map((event) => ({
    event,
    isPast:
      event.status === "past" ||
      (event.status !== "upcoming" && event.endsOn < today),
    display: {
      name: event.name,
      location: `${event.city}, ${event.country}`,
      date: formatEventRange(event.startsOn, event.endsOn),
      href: event.url,
      ...(event.role ? { role: event.role } : {}),
    } satisfies DisplayConference,
  }));

  return {
    upcoming: projected
      .filter(({ isPast }) => !isPast)
      .sort((left, right) => left.event.startsOn.localeCompare(right.event.startsOn))
      .map(({ display }) => display),
    recent: projected
      .filter(({ isPast }) => isPast)
      .sort((left, right) => right.event.endsOn.localeCompare(left.event.endsOn))
      .map(({ display }) => display),
  };
}

function formatEventRange(startsOn: string, endsOn: string): string {
  const start = dateParts(startsOn);
  const end = dateParts(endsOn);
  if (startsOn === endsOn) return start.full;
  if (start.year === end.year && start.month === end.month) {
    return `${start.month} ${start.day}–${end.day}, ${start.year}`;
  }
  if (start.year === end.year) {
    return `${start.month} ${start.day}–${end.month} ${end.day}, ${start.year}`;
  }
  return `${start.full}–${end.full}`;
}

function dateParts(value: string) {
  const parsed = new Date(`${value}T00:00:00Z`);
  const month = new Intl.DateTimeFormat("en-US", {
    month: "long",
    timeZone: "UTC",
  }).format(parsed);
  const day = parsed.getUTCDate();
  const year = parsed.getUTCFullYear();
  return { day, full: `${month} ${day}, ${year}`, month, year };
}
