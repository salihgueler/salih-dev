import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import fallbackContent from "./site-content.default.json";
import {
  parseSiteContent,
  type SiteEvent,
} from "./site-content-schema";

const sourcePath = process.env.SITE_CONTENT_PATH;
const rawContent: unknown = sourcePath
  ? JSON.parse(readFileSync(resolve(process.cwd(), sourcePath), "utf8"))
  : fallbackContent;

export const siteContent = parseSiteContent(rawContent);

export type DisplayConference = {
  name: string;
  location: string;
  date: string;
  href: string;
  role?: string;
};

export const conferences = classifyEvents(
  siteContent.events,
  process.env.SITE_CONTENT_TODAY ?? new Date().toISOString().slice(0, 10),
);

export function formatIsoDate(value: string): string {
  return dateParts(value).full;
}

function classifyEvents(events: SiteEvent[], today: string) {
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
